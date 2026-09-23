import type { UsageConnection, UsageCredential, UsageMetric } from '../../shared/usage';
import { type RequestJson, requestJson } from './httpClient';
import { UsageError, safeError } from './errors';
import { antigravityModels, antigravitySummary, codexMetrics, gatewayCredit, mappedMetric, metric, nextBudgetReset, number, timestamp } from './normalize';
export type QueryResult = {
    metrics: UsageMetric[];
    planName?: string;
    mock?: boolean;
    failedPrefixes?: string[];
    partialError?: string;
    retryAt?: number;
};
function combinedFailure(results: PromiseSettledResult<unknown>[]): UsageError {
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => safeError(r.reason));
    const retryAt = Math.max(0, ...errors.map(e => e.retryAt || 0));
    if (retryAt) return new UsageError('http-429', '限流等待中 / Rate limit cooldown', 'rate-limited', retryAt);
    return errors.find(e => e.state === 'auth-required') || errors[0] || new UsageError('schema', '用量响应不兼容 / Unsupported usage schema', 'unsupported');
}
export function gatewayUrl(base: string, path: string): string {
    // Paths are relative to the configured deployment prefix, never silently remove /v1.
    const url = new URL(base.replace(/\/$/, '') + path);
    if (url.origin !== new URL(base).origin)
        throw new UsageError('destination', '接口必须位于配置的服务主机');
    return url.toString();
}
export async function queryUsage(c: UsageConnection, credential: UsageCredential, signal: AbortSignal, request: RequestJson = requestJson): Promise<QueryResult> {
    if (c.providerId !== 'personal-gateway' && !credential.accessToken)
        throw new UsageError('auth', '请先授权登录 / Sign in first', 'auth-required');
    const bearer = { Authorization: `Bearer ${credential.accessToken}` };
    if (c.providerId === 'codex') {
        const data = await request('https://chatgpt.com/backend-api/wham/usage', { headers: { ...bearer, ...(c.accountId ? { 'ChatGPT-Account-Id': c.accountId } : {}) }, signal });
        return { metrics: codexMetrics(data), planName: typeof data.plan_type === 'string' ? data.plan_type : undefined };
    }
    if (c.providerId === 'antigravity') {
        const base = 'https://cloudcode-pa.googleapis.com/';
        const post = (path: string, body: unknown) => request(base + path, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json', 'User-Agent': 'antigravity/1.20.5 windows/amd64' }, body: JSON.stringify(body), signal });
        const meta = await post('v1internal:loadCodeAssist', { metadata: { ideName: 'antigravity', ideType: 'ANTIGRAVITY', ideVersion: '1.20.5', platform: 'WINDOWS_AMD64', pluginType: 'GEMINI', updateChannel: 'stable' }, mode: 'FULL_ELIGIBILITY_CHECK', ...(c.projectId ? { cloudaicompanionProject: c.projectId } : {}) });
        const project = c.projectId || (typeof meta.cloudaicompanionProject === 'string' ? meta.cloudaicompanionProject : meta.cloudaicompanionProject?.id);
        const body = project ? { project } : {};
        const responses = await Promise.allSettled([
            post('v1internal:fetchAvailableModels', body).then(antigravityModels),
            post('v1internal:retrieveUserQuotaSummary', body).then(antigravitySummary)
        ]);
        const metrics: UsageMetric[] = [], failedPrefixes: string[] = [];
        responses.forEach((r, index) => r.status === 'fulfilled' ? metrics.push(...r.value) : failedPrefixes.push(index ? 'pool:' : 'model:'));
        if (responses.every(r => r.status === 'rejected'))
            throw combinedFailure(responses);
        for (const credit of meta.paidTier?.availableCredits || []) {
            const amount = number(credit.creditAmount);
            if (amount !== null)
                metrics.push(metric(`credit:${credit.creditType}`, credit.creditType || 'Credit', { kind: 'balance', unit: 'credit', remaining: String(amount) }));
        }
        const retryAt = Math.max(0, ...responses.map(r => r.status === 'rejected' ? safeError(r.reason).retryAt || 0 : 0)) || undefined;
        return { metrics, retryAt, planName: meta.paidTier?.id || meta.currentTier?.id, failedPrefixes, partialError: failedPrefixes.length ? '部分额度未更新 / Some quota requests failed' : undefined };
    }
    const g = c.gateway;
    if (g.protocol === 'gateway-usage-v1' && g.periods?.length) {
        const results = await Promise.allSettled(g.periods.map(p => queryUsage({ ...c, gateway: { ...g, periods: undefined, period: p.period, budget: p.budget } }, credential, signal, request)));
        if (results.every(r => r.status === 'rejected')) throw combinedFailure(results);
        const metrics: UsageMetric[] = [], failedPrefixes: string[] = [], errors: string[] = [];
        let retryAt = 0, mock = false;
        results.forEach((r, i) => {
            const prefix = `${g.periods![i].period}:`;
            if (r.status === 'rejected') { const error = safeError(r.reason); failedPrefixes.push(prefix); errors.push(error.message); retryAt = Math.max(retryAt, error.retryAt || 0); }
            else {
                metrics.push(...r.value.metrics.map(m => ({ ...m, id: prefix + m.id })));
                failedPrefixes.push(...(r.value.failedPrefixes || []).map(p => prefix + p));
                if (r.value.partialError) errors.push(r.value.partialError);
                retryAt = Math.max(retryAt, r.value.retryAt || 0); mock ||= Boolean(r.value.mock);
            }
        });
        return { metrics, failedPrefixes, partialError: errors.length ? [...new Set(errors)].join('; ') : undefined, retryAt: retryAt || undefined, mock };
    }
    if (g.auth !== 'none' && !credential.apiKey)
        throw new UsageError('auth', '请填写 API Key / API key required', 'auth-required');
    const headers: Record<string, string> = g.auth === 'bearer' ? { Authorization: `Bearer ${credential.apiKey}` } : g.auth === 'header' ? { [g.headerName!]: credential.apiKey! } : {};
    const get = (path: string) => request(gatewayUrl(g.baseUrl, path), { headers, signal, allowPrivate: g.allowPrivate });
    if (g.protocol === 'custom-json') {
        const data = await request(gatewayUrl(g.baseUrl, g.custom.path), { method: g.custom.method, headers: { ...headers, 'Content-Type': 'application/json' }, body: g.custom.method === 'POST' ? g.custom.body : undefined, signal, allowPrivate: g.allowPrivate });
        return { metrics: g.custom.mappings.map(m => mappedMetric(data, m)), mock: data.mock === true };
    }
    if (g.protocol === 'sub2api') {
        const data = await get(g.paths.usage);
        const metrics: UsageMetric[] = [];
        const rawUnit = data.unit || data.quota?.unit;
        const unit = ['USD', 'CNY', 'EUR', 'GBP'].includes(rawUnit) ? 'currency' : rawUnit === 'token' ? 'token' : 'credit';
        const currency = unit === 'currency' ? rawUnit : undefined;
        if (data.balance !== undefined)
            metrics.push(mappedMetric(data, { id: 'balance', label: '账户余额 / Account balance', kind: 'balance', unit, currency, remaining: '/balance' }));
        if (data.quota) {
            const q = mappedMetric(data, { id: 'quota', label: 'Key 额度 / Key quota', kind: 'quota', unit, currency, remaining: '/quota/remaining', used: '/quota/used', limit: '/quota/limit' });
            q.unlimited = data.quota.unlimited === true;
            metrics.push(q);
        }
        else if (data.remaining !== undefined)
            metrics.push(mappedMetric(data, { id: 'remaining', label: '剩余额度 / Remaining', kind: 'quota', unit, currency, remaining: '/remaining' }));
        for (const period of ['today', 'total']) {
            for (const [field, unit] of [['requests', 'request'], ['total_tokens', 'token']] as const) {
                if (number(data.usage?.[period]?.[field]) !== null)
                    metrics.push(mappedMetric(data, { id: `${period}:${field}`, label: `${period} · ${field}`, kind: 'usage', unit, used: `/usage/${period}/${field}` }));
            }
            if (currency && number(data.usage?.[period]?.cost) !== null)
                metrics.push(mappedMetric(data, { id: `${period}:cost`, label: `${period} · cost`, kind: 'usage', unit: 'currency', currency, used: `/usage/${period}/cost` }));
        }
        if (!rawUnit)
            for (const m of metrics.filter(m => m.unit === 'credit')) {
                m.note = '接口未声明单位，显示原始数值 / Raw value; unit not supplied';
                m.completeness = 'partial';
            }
        if (!metrics.length)
            throw new UsageError('schema', '当前接口未返回可识别用量字段 / Usage fields missing', 'unsupported');
        return { metrics, planName: data.planName, mock: data.mock === true };
    }
    if (g.protocol === 'new-api') {
        const [subscription, usage, token] = await Promise.allSettled([get(g.paths.subscription), get(g.paths.usage), get(g.paths.token)]);
        const metrics: UsageMetric[] = [];
        let partialError: string | undefined;
        if (subscription.status === 'fulfilled' && usage.status === 'fulfilled') {
            const limit = number(subscription.value.hard_limit_usd), used = number(usage.value.total_usage);
            if (limit !== null && used !== null)
                metrics.push(mappedMetric({ limit, used: used / 100, access_until: subscription.value.access_until }, { id: 'billing', label: '账单额度 / Billing quota (USD)', kind: 'quota', unit: 'currency', currency: 'USD', limit: '/limit', used: '/used', expiresAt: '/access_until', timeFormat: 'unix-seconds' }));
        }
        if (token.status === 'fulfilled' && token.value.success !== false && token.value.data) {
            const m = mappedMetric(token.value.data, { id: 'key', label: 'Key 额度（原始单位）/ Key quota (raw units)', kind: 'quota', unit: 'credit', remaining: '/total_available', used: '/total_used', limit: '/total_granted', expiresAt: '/expires_at', timeFormat: 'unix-seconds' });
            m.unlimited = token.value.data.unlimited_quota === true;
            metrics.push(m);
        }
        if (!metrics.length) {
            throw combinedFailure([subscription, usage, token]);
        }
        if ([subscription, usage, token].some(r => r.status === 'rejected'))
            partialError = '部分账单接口不可用 / Some billing endpoints unavailable';
        const retryAt = Math.max(0, ...[subscription, usage, token].map(r => r.status === 'rejected' ? safeError(r.reason).retryAt || 0 : 0)) || undefined;
        const failedPrefixes = [...(subscription.status === 'rejected' || usage.status === 'rejected' ? ['billing'] : []), ...(token.status === 'rejected' ? ['key'] : [])];
        return { metrics, partialError, retryAt, failedPrefixes };
    }
    const periodPath = (path: string) => `${path}${path.includes('?') ? '&' : '?'}window=${g.period}`;
    const summary = await get(periodPath(g.paths.summary));
    if (!summary.data || number(summary.data.total_tokens) === null)
        throw new UsageError('schema', '用量汇总契约不兼容 / Invalid usage summary', 'unsupported');
    const metrics = [metric('tokens', `Tokens · ${g.period}`, { kind: 'usage', unit: 'token', used: String(summary.data.total_tokens), sourceAsOf: typeof summary.as_of === 'number' ? timestamp(summary.as_of, 'unix-seconds') : timestamp(summary.as_of) })];
    let partialError: string | undefined, retryAt: number | undefined, mock = summary.mock === true;
    if (g.budget !== undefined) {
        try {
            // A distinct catalog never inherits the usage service's credential.
            const catalog = g.modelsBaseUrl ? request(gatewayUrl(g.modelsBaseUrl, g.paths.models), { headers: credential.modelsApiKey ? { Authorization: `Bearer ${credential.modelsApiKey}` } : {}, signal, allowPrivate: g.allowPrivate }) : get(g.paths.models);
            const responses = await Promise.allSettled([catalog, get(periodPath(g.paths.byModel))]);
            if (responses.some(r => r.status === 'rejected')) throw combinedFailure(responses);
            const [models, byModel] = responses.map(r => (r as PromiseFulfilledResult<any>).value);
            if (!Array.isArray(models.data) || !Array.isArray(byModel.data))
                throw new UsageError('schema', 'Credit 元数据不完整 / Missing credit metadata');
            const estimate = gatewayCredit(byModel.data, models.data);
            const remaining = estimate.complete ? g.budget - estimate.used : null;
            metrics.push(metric('budget', `自设预算 / Budget · ${g.period}`, { kind: 'budget', unit: 'credit', limit: String(g.budget),
                used: String(estimate.used), remaining: remaining === null ? null : String(remaining), remainingPercent: remaining === null ? null : Math.max(0, Math.min(100, remaining / g.budget * 100)),
                resetsAt: nextBudgetReset(g.period, Date.now()), resetBasis: 'budget-calendar', authority: 'estimated', completeness: estimate.complete ? 'complete' : 'partial',
                note: !estimate.complete ? '缺计量系数，已知部分估算 / Partial estimate' : estimate.estimated ? '按当前系数估算 / Current rate estimate' : '按历史系数估算 / Historical rate estimate' }));
            mock ||= models.mock === true || byModel.mock === true;
        }
        catch (e) {
            partialError = safeError(e).message;
            retryAt = safeError(e).retryAt;
        }
    }
    return { metrics, partialError, retryAt, mock, failedPrefixes: partialError ? ['budget'] : [] };
}
