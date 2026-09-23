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
// The card keeps only the four server windows: Claude / Gemini × 5-hour / weekly.
// Other buckets and per-model rows (high/low variants, concrete model names) are not time
// windows; listing them would stretch the card into a long model list, so they never enter it.
const antigravityWindows = [
    { family: 'claude', span: '5h', label: 'Claude · 5h', ids: ['3p-5h', 'claude:5h'] },
    { family: 'claude', span: 'weekly', label: 'Claude · Weekly', ids: ['3p-weekly', 'claude:weekly'] },
    { family: 'gemini', span: '5h', label: 'Gemini · 5h', ids: ['gemini-5h', 'gemini:5h'] },
    { family: 'gemini', span: 'weekly', label: 'Gemini · Weekly', ids: ['gemini-weekly', 'gemini:weekly'] }
] as const;
export function antigravitySummary(data: any, now = Date.now()): UsageMetric[] {
    const buckets: Array<{ id: unknown; fraction: unknown; resetTime: unknown }> = [];
    if (Array.isArray(data.groups))
        for (const g of data.groups)
            if (Array.isArray(g?.buckets))
                buckets.push(...g.buckets.map((b: any) => ({ id: b?.bucketId, fraction: b?.remainingFraction, resetTime: b?.resetTime })));
    if (!buckets.length)
        throw new UsageError('schema', '未返回额度窗口 / Missing quota windows', 'unsupported');
    return antigravityWindows.map(window => {
        const bucket = buckets.find(b => window.ids.includes(b.id as never));
        const fraction = number(bucket?.fraction);
        const valid = fraction !== null && fraction >= 0 && fraction <= 1;
        return quota(`window:${window.family}:${window.span}`, window.label, valid ? fraction * 100 : null, bucket ? timestamp(bucket.resetTime) : null, now);
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
