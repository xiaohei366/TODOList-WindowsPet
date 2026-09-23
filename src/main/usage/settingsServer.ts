import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { defaultConnection, defaultGateway } from '../../shared/usage';
import { parseCredential, validateConnection } from './config';
import { safeError, UsageError } from './errors';
import type { UsageService } from './service';
import html from './web/index.html?raw';
import css from './web/settings.css?raw';
import js from './web/settings.js?raw';
async function body(req: IncomingMessage): Promise<any> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const data of req) {
        size += data.length;
        if (size > 65536)
            throw new UsageError('body-size', '请求体过大 / Request too large');
        chunks.push(data);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
    catch {
        throw new UsageError('json', '无效 JSON / Invalid JSON');
    }
}
function json(res: ServerResponse, status: number, data: unknown): void { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
type BrowserSession = {
    csrf: string;
    lastUse: number;
};
export class UsageSettingsServer {
    private server?: Server;
    private port = 0;
    private codes = new Map<string, number>();
    private sessions = new Map<string, BrowserSession>();
    private cookieName = `pet_usage_${randomBytes(8).toString('hex')}`;
    constructor(private service: UsageService, private openAuthorization?: (url: string) => Promise<void>) { }
    async start(): Promise<void> {
        this.server = createServer((req, res) => {
            void this.handle(req, res).catch(e => {
                const err = safeError(e);
                json(res, err.code === 'conflict' ? 409 : err.code === 'session' ? 401 : 400, { ok: false, error: { code: err.code, message: err.message } });
            });
        });
        this.server.requestTimeout = 15000;
        this.server.headersTimeout = 15000;
        await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve); });
        this.port = (this.server.address() as AddressInfo).port;
    }
    url(language: string): string {
        const now = Date.now();
        for (const [code, expiry] of this.codes)
            if (expiry < now)
                this.codes.delete(code);
        if (this.codes.size > 20)
            this.codes.clear();
        const code = randomBytes(32).toString('base64url');
        this.codes.set(code, now + 60000);
        return `http://127.0.0.1:${this.port}/settings/ai-usage#code=${code}&lang=${language}`;
    }
    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const origin = `http://127.0.0.1:${this.port}`;
        if (req.headers.host !== `127.0.0.1:${this.port}`) {
            json(res, 403, { ok: false });
            return;
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        const url = new URL(req.url || '/', origin);
        const assets: Record<string, [
            string,
            string
        ]> = { '/settings/ai-usage': ['text/html', html], '/settings/settings.css': ['text/css', css], '/settings/settings.js': ['text/javascript', js] };
        if (req.method === 'GET' && assets[url.pathname]) {
            res.writeHead(200, { 'Content-Type': `${assets[url.pathname][0]}; charset=utf-8`, 'Cache-Control': 'no-store' });
            res.end(assets[url.pathname][1]);
            return;
        }
        if (!url.pathname.startsWith('/api/usage/')) {
            json(res, 404, { ok: false });
            return;
        }
        if (req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
            json(res, 403, { ok: false });
            return;
        }
        const mutating = req.method !== 'GET';
        if (mutating && (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json'))) {
            json(res, 403, { ok: false });
            return;
        }
        for (const [key, session] of this.sessions)
            if (Date.now() - session.lastUse > 1800000)
                this.sessions.delete(key);
        if (url.pathname === '/api/usage/session/exchange' && req.method === 'POST') {
            const input = await body(req);
            const expiry = this.codes.get(input.code);
            this.codes.delete(input.code);
            if (!expiry || expiry < Date.now() || this.sessions.size > 20)
                throw new UsageError('session', '请从 Pet 面板齿轮重新打开 / Reopen from Pet settings');
            const key = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
            this.sessions.set(key, { csrf, lastUse: Date.now() });
            res.setHeader('Set-Cookie', `${this.cookieName}=${key}; HttpOnly; SameSite=Strict; Path=/api/usage/`);
            json(res, 200, { ok: true, data: { csrf } });
            return;
        }
        const key = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${this.cookieName}=`))?.slice(this.cookieName.length + 1) || '';
        const session = this.sessions.get(key);
        if (!session)
            throw new UsageError('session', '会话已失效，请从 Pet 齿轮重新打开 / Reopen from Pet settings');
        if (mutating && req.headers['x-csrf-token'] !== session.csrf) {
            json(res, 403, { ok: false });
            return;
        }
        session.lastUse = Date.now();
        let result: unknown;
        const id = url.pathname.split('/')[4];
        if (url.pathname === '/api/usage/session' && req.method === 'GET')
            result = { csrf: session.csrf };
        else if (url.pathname === '/api/usage/providers' && req.method === 'GET')
            result = ['codex', 'antigravity', 'personal-gateway'].map(p => defaultConnection(p as any));
        else if (url.pathname === '/api/usage/gateway-templates' && req.method === 'GET')
            result = defaultGateway;
        else if (url.pathname === '/api/usage/connections' && req.method === 'GET')
            result = this.service.list();
        else if (url.pathname === '/api/usage/connections' && req.method === 'POST') {
            const input = await body(req);
            result = await this.service.save(input.connection, parseCredential(input.credential));
            this.service.refresh((result as {
                id: string;
            }).id);
        }
        else if (url.pathname.startsWith('/api/usage/connections/') && url.pathname.endsWith('/enable') && req.method === 'POST') {
            await this.service.enable(id);
            result = this.service.list().find(c => c.id === id);
        }
        else if (url.pathname.startsWith('/api/usage/connections/') && req.method === 'DELETE') {
            await this.service.delete(id);
            result = true;
        }
        else if (url.pathname === '/api/usage/snapshots' && req.method === 'GET')
            result = this.service.snapshots();
        else if (url.pathname === '/api/usage/test' && req.method === 'POST') {
            const input = await body(req);
            result = await this.service.test(input.connection, parseCredential(input.credential));
        }
        else if (url.pathname === '/api/usage/refresh' && req.method === 'POST') {
            const input = await body(req);
            this.service.refresh(typeof input.id === 'string' ? input.id : undefined);
            result = { accepted: true };
        }
        else if (url.pathname === '/api/usage/oauth/start' && req.method === 'POST') {
            const input = await body(req);
            const credential = parseCredential(input.credential);
            const returnTo = input.navigation === 'same-tab' ? `${origin}/settings/ai-usage#lang=${input.language === 'en-US' ? 'en-US' : 'zh-CN'}` : undefined;
            const flow = await this.service.oauth.start(key, validateConnection(input.connection), credential.clientSecret, returnTo);
            let browserOpened = false;
            if (!returnTo && flow.authUrl && this.openAuthorization) {
                try { await this.openAuthorization(flow.authUrl); browserOpened = true; } catch { /* Keep the link usable when the OS opener fails. */ }
            }
            result = { ...flow, browserOpened };
        }
        else if (url.pathname.startsWith('/api/usage/oauth/') && id) {
            const flow = this.service.oauth.get(id, key);
            if (req.method === 'GET') {
                result = { ...this.service.oauth.publicSession(flow), requiresConfirmation: false };
            }
            else if (req.method === 'POST' && url.pathname.endsWith('/test')) {
                if (flow.status !== 'ready-to-save' || !flow.credential)
                    throw new UsageError('oauth-incomplete', '授权未完成 / Authorization incomplete');
                result = await this.service.test(flow.connection, flow.credential);
            }
            else if (req.method === 'POST' && url.pathname.endsWith('/cancel')) {
                this.service.oauth.cancel(id, key);
                result = true;
            }
            else if (req.method === 'POST' && url.pathname.endsWith('/complete')) {
                if (flow.status !== 'ready-to-save' || !flow.credential)
                    throw new UsageError('oauth-incomplete', '授权未完成 / Authorization incomplete');
                result = await this.service.saveAuthorized(flow.connection, flow.credential);
                this.service.oauth.cancel(id, key);
                this.service.refresh((result as {
                    id: string;
                }).id);
            }
            else {
                json(res, 404, { ok: false });
                return;
            }
        }
        else {
            json(res, 404, { ok: false });
            return;
        }
        json(res, 200, { ok: true, data: result });
    }
    async close(): Promise<void> { this.codes.clear(); this.sessions.clear(); this.server?.closeAllConnections(); await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve()); }
}
