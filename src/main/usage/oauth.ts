import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { builtinOAuth, type UsageConnection, type UsageCredential } from '../../shared/usage';
import { builtinClientSecret } from './oauthClients';
import { requestJson, type RequestJson } from './httpClient';
import { UsageError, safeError } from './errors';
export type OAuthSession = {
    id: string;
    owner: string;
    connection: UsageConnection;
    state: string;
    verifier: string;
    redirect: string;
    expiresAt: number;
    status: 'authorizing' | 'exchanging' | 'ready-to-save' | 'failed' | 'cancelled';
    credential?: UsageCredential;
    identityLabel?: string;
    error?: string;
    server?: Server;
    timer?: NodeJS.Timeout;
    authUrl: string;
    consumed?: boolean;
};
export function pkceChallenge(verifier: string): string { return createHash('sha256').update(verifier).digest('base64url'); }
const endpoints = {
    codex: { authorize: 'https://auth.openai.com/oauth/authorize', token: 'https://auth.openai.com/oauth/token' },
    antigravity: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token' }
};
export function identityFromToken(token: string): {
    identity?: string;
    accountId?: string;
    email?: string;
    name?: string;
} {
    // Identity hint only. Authentication is provided by successful exchange at the pinned official token endpoint.
    try {
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 512) : undefined;
        return { identity: text(claims.sub), email: text(claims.email) || text(claims['https://api.openai.com/profile']?.email), name: text(claims.name) || text(claims['https://api.openai.com/profile']?.name), accountId: text(claims['https://api.openai.com/auth']?.chatgpt_account_id) };
    }
    catch {
        return {};
    }
}
function tokenCredential(body: any, previous: UsageCredential = {}): UsageCredential {
    if (typeof body.access_token !== 'string' || !body.access_token)
        throw new UsageError('oauth-token', '未取得 access token / Token exchange failed', 'auth-required');
    const profile = identityFromToken(body.id_token || ''), access = identityFromToken(body.access_token);
    const identity = profile.identity || access.identity || previous.identity;
    if (previous.identity && identity && previous.identity !== identity)
        throw new UsageError('identity-changed', '授权身份改变，请重新绑定 / Identity changed', 'auth-required');
    return { accessToken: body.access_token, refreshToken: body.refresh_token || previous.refreshToken,
        expiresAt: Date.now() + (typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600) * 1000,
        identity, email: profile.email || access.email || previous.email, name: profile.name || access.name || previous.name, clientSecret: previous.clientSecret };
}
export class OAuthService {
    private sessions = new Map<string, OAuthSession>();
    constructor(private request: RequestJson = requestJson) { }
    async start(owner: string, connection: UsageConnection, clientSecret?: string, returnTo?: string): Promise<ReturnType<OAuthService['publicSession']>> {
        if (connection.oauth.useBuiltin || connection.oauth.useBuiltin !== false && !connection.oauth.clientId) {
            connection = { ...connection, oauth: builtinOAuth(connection.providerId) };
            clientSecret = builtinClientSecret(connection.providerId);
        }
        if (connection.providerId === 'personal-gateway' || !connection.oauth.clientId)
            throw new UsageError('oauth-client', '自定义登录配置无效，请恢复内置浏览器登录 / Restore built-in browser sign-in');
        if (this.sessions.size >= 10)
            throw new UsageError('oauth-busy', '授权会话过多 / Too many login sessions');
        for (const session of this.sessions.values())
            if (session.owner === owner && session.connection.id === connection.id && session.connection.providerId === connection.providerId)
                this.cancel(session.id, owner);
        const session: OAuthSession = { id: randomUUID(), owner, connection: structuredClone(connection), state: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'), redirect: '',
            expiresAt: Date.now() + 600000, status: 'authorizing', authUrl: '', credential: { clientSecret } };
        const server = createServer((req, res) => {
            void (async () => {
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Referrer-Policy', 'no-referrer');
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                const url = new URL(req.url || '/', session.redirect);
                if (req.method !== 'GET' || req.headers.host !== new URL(session.redirect).host || url.origin !== new URL(session.redirect).origin || url.pathname !== connection.oauth.callbackPath || url.searchParams.get('state') !== session.state || Date.now() > session.expiresAt || session.consumed || session.status !== 'authorizing') {
                    res.writeHead(400);
                    res.end('Invalid or expired authorization callback.');
                    return;
                }
                session.consumed = true;
                if (url.searchParams.has('error')) {
                    session.status = 'failed';
                    session.error = '授权被拒绝 / Authorization denied';
                    if (returnTo) { res.writeHead(303, { Location: `${returnTo}&oauth=${session.id}` }); res.end(); }
                    else res.end('Authorization denied. Return to Pet settings.');
                    this.stopListener(session);
                    return;
                }
                const code = url.searchParams.get('code');
                if (!code || code.length > 8192) {
                    session.status = 'failed';
                    session.error = '缺少授权码 / Missing code';
                    res.writeHead(400);
                    res.end('Missing code.');
                    this.stopListener(session);
                    return;
                }
                session.status = 'exchanging';
                if (returnTo) { res.writeHead(303, { Location: `${returnTo}&oauth=${session.id}` }); res.end(); }
                else res.end('已收到授权，请返回 Pet 设置页。 Authorization received. Return to Pet settings.');
                this.stopListener(session);
                try {
                    const fields: Record<string, string> = { grant_type: 'authorization_code', client_id: connection.oauth.clientId, redirect_uri: session.redirect, code, code_verifier: session.verifier };
                    if (clientSecret)
                        fields.client_secret = clientSecret;
                    const data = await this.request(endpoints[connection.providerId as 'codex' | 'antigravity'].token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
                    if (session.status !== 'exchanging' || Date.now() > session.expiresAt)
                        return;
                    session.credential = tokenCredential(data, session.credential);
                    if (connection.providerId === 'antigravity' && (!session.credential.identity || !session.credential.email))
                        session.credential = await this.enrichIdentity(connection, session.credential);
                    if (session.status !== 'exchanging') return;
                    session.identityLabel = session.credential.email || session.credential.name || session.credential.identity;
                    if (!session.credential.identity)
                        throw new UsageError('oauth-identity', '未取得可确认的账号身份 / Account identity unavailable', 'auth-required');
                    if (!session.credential.refreshToken)
                        throw new UsageError('oauth-refresh-missing', '未取得 refresh token，请重新同意离线授权 / Offline access missing', 'auth-required');
                    // Never inherit the previous user's workspace when logging into another account.
                    session.connection.accountId = connection.providerId === 'codex' ? identityFromToken(data.access_token).accountId || identityFromToken(data.id_token || '').accountId : undefined;
                    session.connection.credentialMode = 'oauth-owned';
                    session.status = 'ready-to-save';
                }
                catch (e) {
                    if (session.status === 'exchanging') {
                        session.status = 'failed';
                        session.error = safeError(e).message;
                        session.credential = undefined;
                    }
                }
                finally {
                    session.verifier = '';
                    session.state = '';
                }
            })().catch(() => { if (!res.writableEnded) {
                res.writeHead(500);
                res.end('Authorization failed.');
            } });
        });
        server.requestTimeout = 10000;
        server.headersTimeout = 10000;
        const listen = (port: number) => new Promise<void>((resolve, reject) => {
            const failed = (error: NodeJS.ErrnoException) => { server.removeListener('listening', ready); reject(error); };
            const ready = () => { server.removeListener('error', failed); resolve(); };
            server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
        });
        try {
            try { await listen(connection.oauth.callbackPort); }
            catch (e) {
                if (!connection.oauth.useBuiltin || connection.providerId !== 'codex' || (e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
                await listen(1457);
            }
        } catch { throw new UsageError('callback-port', '登录回调端口被占用，请结束其他登录流程后重试 / Callback port occupied; finish other sign-in attempts and retry'); }
        session.server = server;
        session.redirect = `http://${connection.oauth.callbackHost}:${(server.address() as AddressInfo).port}${connection.oauth.callbackPath}`;
        const auth = new URL(endpoints[connection.providerId].authorize);
        const fields: Record<string, string> = { client_id: connection.oauth.clientId, response_type: 'code', redirect_uri: session.redirect, scope: connection.oauth.scopes,
            state: session.state, code_challenge: pkceChallenge(session.verifier), code_challenge_method: 'S256' };
        if (connection.providerId === 'antigravity') {
            fields.access_type = 'offline';
            fields.prompt = 'consent select_account';
        }
        else {
            fields.id_token_add_organizations = 'true';
            fields.codex_cli_simplified_flow = 'true';
            fields.codex_streamlined_login = 'true';
            fields.originator = connection.oauth.useBuiltin ? 'Codex Desktop' : 'pet';
        }
        for (const [key, value] of Object.entries(fields))
            auth.searchParams.set(key, value);
        session.authUrl = auth.toString();
        if (connection.providerId === 'codex' && connection.oauth.useBuiltin) {
            const hosted = new URL('https://chatgpt.com/codex/desktop-auth');
            hosted.searchParams.set('authorize_url', session.authUrl);
            hosted.searchParams.set('codex_streamlined_login', 'true');
            hosted.searchParams.set('no_universal_links', '1');
            session.authUrl = hosted.toString();
        }
        session.timer = setTimeout(() => this.cancel(session.id, owner), 600000);
        this.sessions.set(session.id, session);
        return this.publicSession(session);
    }
    publicSession(s: OAuthSession) { return { id: s.id, status: s.status, authUrl: s.status === 'authorizing' ? s.authUrl : undefined, expiresAt: s.expiresAt, error: s.error, accountId: s.connection.accountId, identityLabel: s.identityLabel, displayName: s.connection.displayName }; }
    get(id: string, owner: string): OAuthSession { const s = this.sessions.get(id); if (!s || s.owner !== owner || s.expiresAt <= Date.now())
        throw new UsageError('oauth-session', '授权会话已失效 / Login session expired'); return s; }
    cancel(id: string, owner: string): void { const s = this.sessions.get(id); if (!s || s.owner !== owner)
        return; s.status = 'cancelled'; s.credential = undefined; s.verifier = ''; s.state = ''; clearTimeout(s.timer); this.stopListener(s); this.sessions.delete(id); }
    private stopListener(s: OAuthSession): void { s.server?.close(); s.server?.closeIdleConnections(); s.server = undefined; }
    close(): void { for (const s of this.sessions.values())
        this.cancel(s.id, s.owner); }
    async enrichIdentity(c: UsageConnection, credential: UsageCredential): Promise<UsageCredential> {
        if (c.providerId !== 'antigravity') {
            const profile = identityFromToken(credential.accessToken || '');
            return { ...credential, identity: credential.identity || profile.identity, email: credential.email || profile.email, name: credential.name || profile.name };
        }
        const profile = await this.request('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${credential.accessToken}` } });
        if (typeof profile.sub !== 'string' || !profile.sub || credential.identity && profile.sub !== credential.identity)
            throw new UsageError('identity-changed', '授权身份改变，请重新登录 / Identity changed', 'auth-required');
        return { ...credential, identity: profile.sub, email: typeof profile.email === 'string' ? profile.email.slice(0, 512) : credential.email, name: typeof profile.name === 'string' ? profile.name.slice(0, 512) : credential.name };
    }
    async refresh(c: UsageConnection, credential: UsageCredential): Promise<UsageCredential> {
        if (!credential.refreshToken || c.providerId === 'personal-gateway')
            throw new UsageError('oauth-refresh', '请重新授权 / Sign in again', 'auth-required');
        const profile = c.oauth.useBuiltin ? builtinOAuth(c.providerId) : c.oauth;
        const fields: Record<string, string> = { grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: credential.refreshToken };
        const secret = c.oauth.useBuiltin ? builtinClientSecret(c.providerId) : credential.clientSecret;
        if (secret) fields.client_secret = secret;
        try {
            const body = await this.request(endpoints[c.providerId].token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
            const next = tokenCredential(body, credential);
            const workspace = identityFromToken(body.access_token).accountId || identityFromToken(body.id_token || '').accountId;
            if (c.providerId === 'codex' && c.accountId && workspace && workspace !== c.accountId)
                throw new UsageError('identity-changed', '授权工作区改变，请重新登录 / Workspace changed', 'auth-required');
            if (c.providerId === 'antigravity' && !identityFromToken(body.id_token || body.access_token).identity) {
                return await this.enrichIdentity(c, next);
            }
            return next;
        }
        catch (e) {
            const err = safeError(e);
            if (err.code === 'http-400' || err.state === 'auth-required')
                throw new UsageError('oauth-revoked', '授权已失效，请重新授权 / Authorization expired', 'auth-required');
            throw err;
        }
    }
}
