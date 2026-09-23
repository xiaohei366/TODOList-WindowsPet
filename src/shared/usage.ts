export type UsageProvider = 'codex' | 'antigravity' | 'personal-gateway';
export type GatewayProtocol = 'gateway-usage-v1' | 'new-api' | 'sub2api' | 'custom-json';
export type UsageState = 'unconfigured' | 'ok' | 'partial' | 'auth-required' | 'forbidden' | 'unsupported' | 'rate-limited' | 'error' | 'paused';
export type MetricMapping = {
    id: string;
    label: string;
    kind: 'quota' | 'balance' | 'usage';
    unit: 'percent' | 'currency' | 'credit' | 'token' | 'request';
    currency?: string;
    remaining?: string;
    used?: string;
    limit?: string;
    usedPercent?: string;
    resetsAt?: string;
    expiresAt?: string;
    timeFormat?: 'iso' | 'unix-seconds' | 'unix-ms';
    multiplier?: number;
};
export type GatewayConfig = {
    deploymentProvider: 'volcengine' | 'custom';
    deploymentProviderName?: string;
    protocol: GatewayProtocol;
    baseUrl: string;
    modelsBaseUrl?: string;
    allowPrivate: boolean;
    auth: 'bearer' | 'header' | 'none';
    headerName?: string;
    paths: {
        summary: string;
        byModel: string;
        models: string;
        subscription: string;
        usage: string;
        token: string;
    };
    period: 'today' | 'week' | 'month';
    budget?: number;
    periods?: { period: 'today' | 'week' | 'month'; budget?: number }[];
    custom: {
        path: string;
        method: 'GET' | 'POST';
        body: string;
        mappings: MetricMapping[];
    };
};
export type OAuthProfile = {
    useBuiltin?: boolean;
    clientId: string;
    scopes: string;
    callbackPort: number;
    callbackHost: '127.0.0.1' | 'localhost';
    callbackPath: string;
};
// Public desktop client metadata, matching the browser flow in the reference client.
export function builtinOAuth(provider: UsageProvider): OAuthProfile {
    return {
        useBuiltin: true,
        clientId: provider === 'codex' ? 'app_EMoamEEZ73f0CkXaXp7hrann' : '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
        scopes: provider === 'codex' ? 'openid profile email offline_access api.connectors.read api.connectors.invoke' : 'openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs https://www.googleapis.com/auth/aicode',
        callbackPort: provider === 'codex' ? 1455 : 0,
        callbackHost: 'localhost',
        callbackPath: provider === 'codex' ? '/auth/callback' : '/oauth-callback'
    };
}
export type UsageAccount = { email?: string; name?: string; subject?: string; workspaceId?: string };
export type UsageConnection = {
    id: string;
    revision: number;
    displayName: string;
    providerId: UsageProvider;
    enabled: boolean;
    intervalMinutes: number;
    order: number;
    pinnedMetricIds: string[];
    featuredMetricId?: string;
    credentialMode: 'oauth-owned' | 'imported' | 'api-key';
    gateway: GatewayConfig;
    oauth: OAuthProfile;
    accountId?: string;
    projectId?: string;
    hasCredential?: boolean;
    /** Read-only identity derived from the credential, independent of the editable alias. */
    account?: UsageAccount;
};
export type UsageMetric = {
    id: string;
    label: string;
    kind: 'quota' | 'balance' | 'usage' | 'budget' | 'reset-credit';
    unit: 'percent' | 'currency' | 'credit' | 'token' | 'request' | 'count';
    currency?: string;
    remaining: string | null;
    used: string | null;
    limit: string | null;
    remainingPercent: number | null;
    unlimited: boolean;
    resetsAt: string | null;
    expiresAt: string | null;
    resetBasis: 'provider' | 'relative' | 'budget-calendar' | 'unknown';
    authority: 'provider' | 'user-budget' | 'estimated';
    completeness: 'complete' | 'partial' | 'unknown';
    observedAt: string;
    sourceAsOf: string | null;
    freshness: 'fresh' | 'stale';
    note?: string;
};
export type UsageSnapshot = {
    connectionId: string;
    configRevision: number;
    displayName: string;
    providerId: UsageProvider;
    account?: UsageAccount;
    state: UsageState;
    refreshing: boolean;
    metrics: UsageMetric[];
    featuredMetricId?: string;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    nextRefreshAt: string | null;
    planName?: string;
    error?: string;
    errorCode?: string;
    mock?: boolean;
    staleAfterMs?: number;
    retryAt?: string;
};
export type UsageCredential = {
    apiKey?: string;
    modelsApiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    clientSecret?: string;
    identity?: string;
    email?: string;
    name?: string;
};
export const defaultGateway: GatewayConfig = {
    deploymentProvider: 'volcengine', protocol: 'gateway-usage-v1', baseUrl: '', allowPrivate: false,
    auth: 'bearer', paths: { summary: '/v1/usage/summary', byModel: '/v1/usage/by-model', models: '/v1/models',
        subscription: '/v1/dashboard/billing/subscription', usage: '/v1/dashboard/billing/usage', token: '/api/usage/token/' },
    period: 'month', custom: { path: '/me/quota', method: 'GET', body: '{}', mappings: [
            { id: 'balance', label: '余额 / Balance', kind: 'balance', unit: 'currency', currency: 'USD', remaining: '/data/balance' }
        ] }
};
export function defaultConnection(providerId: UsageProvider = 'personal-gateway'): UsageConnection {
    return { id: '', revision: 0, providerId, displayName: providerId === 'personal-gateway' ? '我的网关' : providerId,
        enabled: true, intervalMinutes: 5, order: 0, pinnedMetricIds: [], credentialMode: providerId === 'personal-gateway' ? 'api-key' : 'oauth-owned',
        gateway: structuredClone(defaultGateway), oauth: builtinOAuth(providerId) };
}
