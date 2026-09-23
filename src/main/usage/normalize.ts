import type { MetricMapping, UsageMetric } from '../../shared/usage';
import { pointer } from './config';
import { UsageError } from './errors';
export function number(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean' || typeof value === 'object')
        return null;
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;
}
export function timestamp(value: unknown, format: 'iso' | 'unix-seconds' | 'unix-ms' = 'iso'): string | null {
    const n = format === 'iso' ? typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? Date.parse(value) : NaN : (number(value) ?? NaN) * (format === 'unix-seconds' ? 1000 : 1);
    return Number.isFinite(n) && n > 0 && n < 8640000000000000 ? new Date(n).toISOString() : null;
}
export function metric(id: string, label: string, extra: Partial<UsageMetric> = {}, now = Date.now()): UsageMetric {
    return { id, label, kind: 'quota', unit: 'percent', remaining: null, used: null, limit: null, remainingPercent: null,
        unlimited: false, resetsAt: null, expiresAt: null, resetBasis: 'unknown', authority: 'provider', completeness: 'complete',
        observedAt: new Date(now).toISOString(), sourceAsOf: null, freshness: 'fresh', ...extra };
}
export function quota(id: string, label: string, remainingPercent: unknown, resetsAt: string | null, now = Date.now()): UsageMetric {
    const pct = number(remainingPercent);
    const valid = pct !== null && pct >= 0 && pct <= 100;
    return metric(id, label, { remainingPercent: valid ? pct : null, remaining: valid ? String(pct) : null,
        resetsAt, resetBasis: resetsAt ? 'provider' : 'unknown', completeness: valid ? 'complete' : 'unknown' }, now);
}
export function codexMetrics(data: any, now = Date.now()): UsageMetric[] {
    const result: UsageMetric[] = [];
    for (const [pool, title] of [['rate_limit', 'Codex'], ['code_review_rate_limit', 'Code review']]) {
        for (const key of ['primary_window', 'secondary_window']) {
            const w = data[pool]?.[key];
            if (!w)
                continue;
            const seconds = number(w.limit_window_seconds);
            const used = number(w.used_percent);
            const relative = number(w.reset_after_seconds);
            const reset = timestamp(w.reset_at, 'unix-seconds') || (relative !== null && relative >= 0 ? timestamp(now + relative * 1000, 'unix-ms') : null);
            const m = quota(`${pool}:${key}`, `${title} · ${seconds ? seconds >= 86400 ? `${seconds / 86400}d` : `${seconds / 3600}h` : key}`, used === null ? null : 100 - used, reset, now);
            if (!w.reset_at && reset)
                m.resetBasis = 'relative';
            result.push(m);
        }
    }
    const count = number(data.rate_limit_reset_credits?.available_count);
    if (count !== null)
        result.push(metric('reset-credit', '重置次数 / Reset credits', { kind: 'reset-credit', unit: 'count', remaining: String(count) }, now));
    if (!result.length)
        throw new UsageError('schema', '未返回额度窗口 / No quota windows', 'unsupported');
    return result;
}
export function antigravityModels(data: any): UsageMetric[] {
    if (!data.models || typeof data.models !== 'object')
        throw new UsageError('schema', '未返回模型额度 / Missing model quota', 'unsupported');
    return Object.entries(data.models).filter(([, raw]) => (raw as any)?.quotaInfo).map(([id, raw]) => {
        const value = raw as any;
        const fraction = number(value.quotaInfo.remainingFraction);
        return quota(`model:${id}`, value.displayName || id, fraction === null ? null : fraction * 100, timestamp(value.quotaInfo.resetTime));
    });
}
export function antigravitySummary(data: any): UsageMetric[] {
    if (!Array.isArray(data.groups))
        throw new UsageError('schema', '汇总额度不兼容 / Invalid quota summary', 'unsupported');
    return data.groups.flatMap((g: any, i: number) => {
        if (!Array.isArray(g.buckets))
            throw new UsageError('schema', '汇总额度不兼容', 'unsupported');
        return g.buckets.map((b: any) => {
            if (!b.bucketId)
                throw new UsageError('schema', 'Missing bucket ID', 'unsupported');
            const fraction = number(b.remainingFraction);
            return quota(`pool:${g.groupId || i}:${b.bucketId}`, b.displayName || b.bucketId, fraction === null ? null : fraction * 100, timestamp(b.resetTime));
        });
    });
}
export function mappedMetric(data: unknown, map: MetricMapping): UsageMetric {
    const get = (p?: string) => { const n = number(pointer(data, p)); return n === null ? null : number(n * (map.multiplier ?? 1)); };
    const used = get(map.used), limit = get(map.limit), direct = get(map.remaining);
    const remaining = direct ?? (used !== null && limit !== null ? limit - used : null);
    const usedPercent = number(pointer(data, map.usedPercent));
    const pct = usedPercent !== null ? 100 - usedPercent : limit !== null && limit > 0 && remaining !== null ? remaining / limit * 100 : null;
    const m = metric(map.id, map.label, { kind: map.kind, unit: map.unit, currency: map.currency,
        remaining: remaining === null ? null : String(remaining), used: used === null ? null : String(used), limit: limit === null ? null : String(limit),
        remainingPercent: pct !== null && pct >= 0 && pct <= 100 ? pct : null,
        resetsAt: timestamp(pointer(data, map.resetsAt), map.timeFormat), expiresAt: timestamp(pointer(data, map.expiresAt), map.timeFormat),
        completeness: remaining === null && used === null && usedPercent === null ? 'unknown' : 'complete' });
    if (m.resetsAt)
        m.resetBasis = 'provider';
    return m;
}
export function nextBudgetReset(period: 'today' | 'week' | 'month', now: number): string {
    const local = new Date(now + 8 * 3600000);
    const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return new Date((period === 'month' ? Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) : day + (period === 'week' ? 7 - ((local.getUTCDay() + 6) % 7) : 1) * 86400000) - 8 * 3600000).toISOString();
}
export function gatewayCredit(rows: any[], models: any[]): {
    used: number;
    complete: boolean;
    estimated: boolean;
} {
    let used = 0, complete = true, estimated = false;
    for (const row of rows) {
        const model = models.find(m => m.id === row.model);
        const days = Array.isArray(row.daily) && row.daily.length ? row.daily : [{ total_tokens: row.total_tokens }];
        for (const day of days) {
            const history = Array.isArray(model?.credit_history) ? [...model.credit_history].filter(h => typeof h.from === 'string').sort((a, b) => a.from.localeCompare(b.from)) : [];
            const historical = day.date ? history.filter(h => h.from <= day.date).at(-1) : null;
            const coefficient = number(history.length && day.date ? historical?.credit : model?.credit);
            const tokens = number(day.total_tokens);
            if (coefficient === null || coefficient < 0 || tokens === null || tokens < 0) {
                complete = false;
                continue;
            }
            if (!history.length || !day.date)
                estimated = true;
            used += tokens * coefficient / 1000000;
        }
    }
    return { used, complete, estimated };
}
