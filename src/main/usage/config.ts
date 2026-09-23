import { isIP } from 'node:net';
import { builtinOAuth, defaultConnection, type UsageConnection, type UsageCredential } from '../../shared/usage';
import { invalid } from './errors';
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function pointer(value: unknown, path: string | undefined): unknown {
    if (!path)
        return undefined;
    if (!path.startsWith('/'))
        return undefined;
    let current = value;
    for (const raw of path.slice(1).split('/')) {
        const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (blockedKeys.has(key) || !current || typeof current !== 'object' || !Object.hasOwn(current, key))
            return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}
export function validateConnection(input: unknown): UsageConnection {
    if (!input || typeof input !== 'object')
        invalid('配置无效 / Invalid configuration');
    const raw = input as UsageConnection;
    if (!['codex', 'antigravity', 'personal-gateway'].includes(raw.providerId))
        invalid('未知平台 / Unknown provider');
    const base = defaultConnection(raw.providerId);
    const c: UsageConnection = { ...base, ...raw, gateway: { ...base.gateway, ...raw.gateway,
            paths: { ...base.gateway.paths, ...raw.gateway?.paths }, custom: { ...base.gateway.custom, ...raw.gateway?.custom } }, oauth: { ...base.oauth, ...raw.oauth } };
    const pick = <T extends object>(value: T, keys: string[]): T => Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key))) as T;
    c.gateway = pick(c.gateway, ['deploymentProvider', 'deploymentProviderName', 'protocol', 'baseUrl', 'modelsBaseUrl', 'allowPrivate', 'auth', 'headerName', 'paths', 'period', 'budget', 'periods', 'custom']);
    c.gateway.paths = pick(c.gateway.paths, Object.keys(base.gateway.paths));
    c.gateway.custom = pick(c.gateway.custom, ['path', 'method', 'body', 'mappings']);
    if (Array.isArray(c.gateway.custom.mappings))
        c.gateway.custom.mappings = c.gateway.custom.mappings.map(m => m && pick(m, ['id', 'label', 'kind', 'unit', 'currency', 'remaining', 'used', 'limit', 'usedPercent', 'resetsAt', 'expiresAt', 'timeFormat', 'multiplier']));
    c.oauth = pick(c.oauth, Object.keys(base.oauth));
    // Older saved custom registrations keep their identity. Empty legacy profiles migrate to one-click login.
    c.oauth.useBuiltin = raw.oauth?.useBuiltin ?? !raw.oauth?.clientId;
    if (c.oauth.useBuiltin) c.oauth = builtinOAuth(c.providerId);
    // Persist only defined configuration fields; never accept caller-supplied secrets or arbitrary properties.
    const result: UsageConnection = { id: String(c.id || ''), revision: Number(c.revision), providerId: c.providerId,
        displayName: String(c.displayName || '').trim(), enabled: c.enabled === true, intervalMinutes: Number(c.intervalMinutes),
        order: Number(c.order) || 0, pinnedMetricIds: Array.isArray(c.pinnedMetricIds) ? c.pinnedMetricIds.filter(x => typeof x === 'string').slice(0, 100) : [],
        featuredMetricId: typeof c.featuredMetricId === 'string' ? c.featuredMetricId.slice(0, 256) || undefined : undefined,
        credentialMode: c.credentialMode, gateway: c.gateway, oauth: c.oauth,
        accountId: c.accountId ? String(c.accountId).slice(0, 256) : undefined, projectId: c.projectId ? String(c.projectId).slice(0, 256) : undefined };
    if (!result.displayName || result.displayName.length > 64)
        invalid('名称需为 1–64 字符 / Name: 1–64 characters');
    if (result.id && !/^[a-zA-Z0-9-]{1,80}$/.test(result.id))
        invalid('Invalid ID');
    if (!Number.isInteger(result.revision) || result.revision < 0)
        invalid('Invalid revision');
    if (![0, 1, 5, 15, 30].includes(result.intervalMinutes))
        invalid('Invalid refresh interval');
    if (!['oauth-owned', 'api-key', 'imported'].includes(result.credentialMode))
        invalid('Invalid credential mode');
    if (!Number.isFinite(result.order) || typeof c.gateway.allowPrivate !== 'boolean')
        invalid('Invalid configuration');
    if (JSON.stringify(result.gateway).length > 16000)
        invalid('网关配置过大 / Gateway configuration too large');
    if (c.providerId === 'personal-gateway') {
        const g = c.gateway;
        if (!['volcengine', 'custom'].includes(g.deploymentProvider) || !['gateway-usage-v1', 'new-api', 'sub2api', 'custom-json'].includes(g.protocol))
            invalid('Invalid gateway template');
        let url: URL;
        try {
            url = new URL(g.baseUrl);
        }
        catch {
            return invalid('填写完整用量服务 URL / Enter a full usage URL');
        }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
            invalid('服务地址必须为无凭据、查询参数的 HTTP(S) URL');
        if (url.protocol === 'http:' && !g.allowPrivate)
            invalid('HTTP 仅允许显式启用的本地/私有服务');
        if (g.modelsBaseUrl) {
            let models: URL;
            try {
                models = new URL(g.modelsBaseUrl);
            }
            catch {
                return invalid('模型目录 URL 无效 / Invalid catalog URL');
            }
            if (!['https:', 'http:'].includes(models.protocol) || models.username || models.password || models.search || models.hash || models.protocol === 'http:' && !g.allowPrivate)
                invalid('Invalid catalog URL');
        }
        if (!['bearer', 'header', 'none'].includes(g.auth))
            invalid('Invalid authentication');
        if (g.auth === 'header' && (!/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(g.headerName || '') || /^(host|cookie|origin|connection|content-length|transfer-encoding)$/i.test(g.headerName!)))
            invalid('Invalid API key header');
        if (!['today', 'week', 'month'].includes(g.period))
            invalid('Invalid period');
        if (g.budget !== undefined && (!Number.isFinite(g.budget) || g.budget <= 0))
            invalid('预算必须大于 0 / Budget must be positive');
        if (g.periods !== undefined) {
            if (!Array.isArray(g.periods) || !g.periods.length || g.periods.length > 3 || new Set(g.periods.map(p => p?.period)).size !== g.periods.length)
                invalid('请选择 1–3 个不同统计周期 / Select 1–3 distinct periods');
            g.periods = g.periods.map(p => {
                if (!p || !['today', 'week', 'month'].includes(p.period) || p.budget !== undefined && (!Number.isFinite(p.budget) || p.budget <= 0))
                    invalid('周期或预算无效 / Invalid period or budget');
                return { period: p.period, ...(p.budget !== undefined ? { budget: p.budget } : {}) };
            });
        }
        for (const p of [...Object.values(g.paths), g.custom.path]) {
            if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.includes('\\') || p.length > 1024)
                invalid('接口路径必须为同主机相对路径');
        }
        if (!['GET', 'POST'].includes(g.custom.method))
            invalid('Invalid method');
        try {
            JSON.parse(g.custom.body);
        }
        catch {
            invalid('POST body 必须为 JSON');
        }
        if (!Array.isArray(g.custom.mappings) || g.custom.mappings.length < 1 || g.custom.mappings.length > 30)
            invalid('需要 1–30 项字段映射');
        for (const m of g.custom.mappings) {
            if (!m || typeof m.id !== 'string' || !m.id || typeof m.label !== 'string' || m.label.length > 100)
                invalid('Invalid metric mapping');
            if (!['quota', 'balance', 'usage'].includes(m.kind) || !['percent', 'currency', 'credit', 'token', 'request'].includes(m.unit))
                invalid('Invalid metric unit');
            if (m.multiplier !== undefined && (!Number.isFinite(m.multiplier) || m.multiplier <= 0))
                invalid('Invalid multiplier');
            for (const p of [m.remaining, m.used, m.limit, m.usedPercent, m.resetsAt, m.expiresAt])
                if (p !== undefined && (typeof p !== 'string' || !p.startsWith('/') || p.length > 256))
                    invalid('字段路径使用 JSON Pointer');
            if (m.timeFormat && !['iso', 'unix-seconds', 'unix-ms'].includes(m.timeFormat))
                invalid('Invalid time format');
            if (m.id.length > 100 || m.currency !== undefined && (typeof m.currency !== 'string' || !/^[A-Z]{3}$/.test(m.currency)))
                invalid('Invalid metric ID or currency');
        }
        if (new Set(g.custom.mappings.map(m => m.id)).size !== g.custom.mappings.length)
            invalid('额度 ID 不能重复 / Duplicate metric ID');
    }
    if (typeof c.oauth.clientId !== 'string' || c.oauth.clientId.length > 300 || typeof c.oauth.scopes !== 'string' || c.oauth.scopes.length > 1500)
        invalid('Invalid OAuth client');
    if (!Number.isInteger(c.oauth.callbackPort) || c.oauth.callbackPort < 0 || c.oauth.callbackPort > 65535)
        invalid('Invalid callback port');
    if (!['127.0.0.1', 'localhost'].includes(c.oauth.callbackHost) || !/^\/[a-zA-Z0-9/_-]{1,100}$/.test(c.oauth.callbackPath))
        invalid('Invalid callback');
    return result;
}
export function parseCredential(value: unknown): UsageCredential {
    if (!value || typeof value !== 'object')
        return {};
    const raw = value as Record<string, unknown>;
    const result: UsageCredential = {};
    for (const key of ['apiKey', 'modelsApiKey', 'accessToken', 'refreshToken', 'clientSecret', 'identity', 'email', 'name'] as const) {
        if (raw[key] !== undefined) {
            if (typeof raw[key] !== 'string' || raw[key].length > 16000)
                invalid('Invalid credential');
            result[key] = raw[key];
        }
    }
    if (typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt))
        result.expiresAt = raw.expiresAt;
    return result;
}
export function addressClass(address: string): 'public' | 'private' | 'blocked' {
    const a = address.replace(/^\[|\]$/g, '').toLowerCase();
    if (a.startsWith('::ffff:'))
        return addressClass(a.slice(7));
    if (isIP(a) === 4) {
        const [x, y] = a.split('.').map(Number);
        if (x === 0 || x === 169 && y === 254 || x >= 224)
            return 'blocked';
        if (x === 127 || x === 10 || x === 172 && y >= 16 && y <= 31 || x === 192 && y === 168 || x === 100 && y >= 64 && y <= 127)
            return 'private';
        return 'public';
    }
    if (isIP(a) === 6) {
        if (a === '::' || a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb') || a.startsWith('ff') || a.startsWith('::ffff:'))
            return 'blocked';
        if (a === '::1' || a.startsWith('fc') || a.startsWith('fd'))
            return 'private';
        // Permit only global unicast, excluding transition schemes that embed another IP.
        return /^[23]/.test(a) && !a.startsWith('2002:') && !a.startsWith('2001:0:') ? 'public' : 'blocked';
    }
    return 'blocked';
}
