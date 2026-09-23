import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtinOAuth, defaultConnection } from '../src/shared/usage';
import { addressClass, pointer, validateConnection } from '../src/main/usage/config';
import { antigravitySummary, codexMetrics, gatewayCredit, mappedMetric, metric, nextBudgetReset } from '../src/main/usage/normalize';
import { gatewayUrl, queryUsage } from '../src/main/usage/adapters';
import { requestJson, retryAfter } from '../src/main/usage/httpClient';
import { OAuthService, pkceChallenge } from '../src/main/usage/oauth';
import { UsageStore } from '../src/main/usage/store';
import { UsageService } from '../src/main/usage/service';
import { UsageSettingsServer } from '../src/main/usage/settingsServer';
import { UsageError } from '../src/main/usage/errors';
import { buildAiMenuItems } from '../src/main/usage/aiMenu';
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { vi.useRealTimers(); for (const fn of cleanup.splice(0).reverse())
    await fn(); });
const codec = { available: () => true, encrypt: (s: string) => Buffer.from(Buffer.from(s).map(n => n ^ 91)), decrypt: (b: Buffer) => Buffer.from(Buffer.from(b).map(n => n ^ 91)).toString() };
async function store() { const root = await mkdtemp(join(tmpdir(), 'pet-usage-')); cleanup.push(() => rm(root, { recursive: true, force: true })); return { root, store: new UsageStore(root, codec) }; }
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const jwt = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub, email: `${sub}@example.test`, 'https://api.openai.com/auth': { chatgpt_account_id: 'org-one' } })).toString('base64url')}.signature`;
describe('quota semantics and replaceable gateway contracts', () => {
    it('uses actual Codex windows, preserves unknowns and distinguishes reset credits', () => {
        const rows = codexMetrics({ rate_limit: { primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_at: 1900000000 }, secondary_window: { used_percent: 120 } }, rate_limit_reset_credits: { available_count: 2 } });
        expect(rows[0]).toMatchObject({ remainingPercent: 63, resetsAt: new Date(1900000000000).toISOString(), label: 'Codex · 5h' });
        expect(rows[1].remainingPercent).toBeNull();
        expect(rows[2].kind).toBe('reset-credit');
        expect(codexMetrics({ rate_limit: { primary_window: { used_percent: 0 } } })).toHaveLength(1);
    });
    it('keeps arbitrary Antigravity buckets separate', () => {
        expect(antigravitySummary({ groups: [{ buckets: [{ bucketId: 'new-pool', remainingFraction: .25, resetTime: '2099-01-01T00:00:00Z' }] }] })[0]).toMatchObject({ remainingPercent: 25, id: 'pool:0:new-pool' });
        expect(() => antigravitySummary({ bad: true })).toThrow();
    });
    it('computes historical Credit and leaves unknown model budget incomplete', () => {
        const models = [{ id: 'a', credit: 4, credit_history: [{ from: '2026-09-01', credit: 1 }, { from: '2026-09-15', credit: 2 }] }];
        const rows = [{ model: 'a', cached_tokens: 999, daily: [{ date: '2026-09-10', total_tokens: 1000000 }, { date: '2026-09-16', total_tokens: 1000000 }] }];
        expect(gatewayCredit(rows, models)).toEqual({ used: 3, complete: true, estimated: false });
        expect(gatewayCredit([...rows, { model: 'unknown', total_tokens: 10 }], models)).toMatchObject({ used: 3, complete: false });
        expect(nextBudgetReset('month', Date.parse('2024-02-29T15:59:59Z'))).toBe('2024-02-29T16:00:00.000Z');
        expect(nextBudgetReset('week', Date.parse('2026-09-20T15:59:00Z'))).toBe('2026-09-20T16:00:00.000Z');
    });
    it('maps a different provider without fabricating resets or zero balances', () => {
        const m = mappedMetric({ data: { balance: '8.2', expiry: 1900000000 } }, { id: 'b', label: 'Balance', unit: 'currency', currency: 'USD', kind: 'balance', remaining: '/data/balance', expiresAt: '/data/expiry', timeFormat: 'unix-seconds' });
        expect(m.remaining).toBe('8.2');
        expect(m.resetsAt).toBeNull();
        expect(m.expiresAt).toBeTruthy();
        expect(mappedMetric({}, { id: 'x', label: 'x', unit: 'credit', kind: 'quota', remaining: '/missing' })).toMatchObject({ remaining: null, completeness: 'unknown' });
        expect(pointer({}, '/__proto__/toString')).toBeUndefined();
        expect(gatewayUrl('https://example.test/custom/v1', '/usage')).toBe('https://example.test/custom/v1/usage');
    });
    it('keeps billing dollars and raw Key quota separate', async () => {
        const c = defaultConnection();
        c.gateway.protocol = 'new-api';
        c.gateway.baseUrl = 'https://example.test';
        const response = await queryUsage(c, { apiKey: 'test' }, new AbortController().signal, async (url) => url.includes('subscription') ? { hard_limit_usd: 10, access_until: 1900000000 } : url.includes('/token') ? { data: { unlimited_quota: true, total_available: 999 } } : { total_usage: 150 });
        expect(response.metrics[0]).toMatchObject({ used: '1.5', remaining: '8.5', currency: 'USD', resetsAt: null });
        expect(response.metrics[0].expiresAt).toBeTruthy();
        expect(response.metrics[1]).toMatchObject({ unlimited: true, unit: 'credit' });
    });
    it('recognizes Sub2API currency and token-only responses', async () => {
        const c = defaultConnection();
        c.gateway.protocol = 'sub2api';
        c.gateway.baseUrl = 'https://example.test';
        const result = await queryUsage(c, { apiKey: 'test' }, new AbortController().signal, async () => ({ quota: { unit: 'USD', remaining: 7 }, usage: { today: { total_tokens: 200 } } }));
        expect(result.metrics[0]).toMatchObject({ currency: 'USD', remaining: '7' });
        expect(result.metrics[1]).toMatchObject({ unit: 'token', used: '200' });
    });
    it('strips arbitrary config properties and supports an extensible AI submenu', () => {
        const c = defaultConnection('codex');
        (c.oauth as any).clientSecret = 'secret';
        (c.gateway.custom.mappings[0] as any).apiKey = 'secret';
        expect(JSON.stringify(validateConnection(c))).not.toContain('secret');
        expect(buildAiMenuItems([{ id: 'usage.open', label: 'menu.aiUsage', run: () => { } }, { id: 'future', label: 'menu.aiRelated', run: () => { } }], key => key).map(x => x.id)).toEqual(['usage.open', 'future']);
    });
});
describe('bounded HTTP and loopback security', () => {
    it('blocks private and metadata destinations by default and never follows redirects', async () => {
        let hits = 0;
        const origin = await listen(createServer((_req, res) => { hits++; res.writeHead(302, { Location: 'http://127.0.0.1:1/secret' }); res.end(); }));
        await expect(requestJson(origin)).rejects.toMatchObject({ code: 'destination' });
        expect(hits).toBe(0);
        await expect(requestJson(origin, { allowPrivate: true })).rejects.toMatchObject({ code: 'http-302' });
        expect(hits).toBe(1);
        expect(addressClass('169.254.169.254')).toBe('blocked');
        expect(addressClass('::ffff:127.0.0.1')).toBe('private');
    });
    it('handles bounded JSON, rejects oversized bodies and honors Retry-After', async () => {
        const origin = await listen(createServer((req, res) => {
            if (req.url === '/large')
                res.end(JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }));
            else if (req.url === '/limit') {
                res.writeHead(429, { 'Retry-After': '120' });
                res.end('sensitive upstream body');
            }
            else
                res.end('{"value":42}');
        }));
        expect(await requestJson(origin, { allowPrivate: true })).toEqual({ value: 42 });
        await expect(requestJson(origin + '/large', { allowPrivate: true })).rejects.toMatchObject({ code: 'too-large' });
        await expect(requestJson(origin + '/limit', { allowPrivate: true })).rejects.toMatchObject({ state: 'rate-limited' });
        expect(retryAfter('120', 1000)).toBe(121000);
        expect(retryAfter('Thu, 01 Jan 1970 00:03:00 GMT', 1000)).toBe(180000);
    });
    it('caps all endpoint requests at three concurrently', async () => {
        let concurrent = 0, peak = 0;
        const origin = await listen(createServer((_req, res) => { peak = Math.max(peak, ++concurrent); setTimeout(() => { concurrent--; res.end('{}'); }, 25); }));
        await Promise.all(Array.from({ length: 9 }, () => requestJson(origin, { allowPrivate: true })));
        expect(peak).toBe(3);
    });
    it('requires single-use pairing, exact Origin and CSRF; never returns tokens', async () => {
        const { store: disk } = await store();
        const service = new UsageService(disk, () => { });
        cleanup.push(() => service.close());
        const server = new UsageSettingsServer(service);
        await server.start();
        cleanup.push(() => server.close());
        const link = new URL(server.url('zh-CN')), origin = link.origin, code = new URLSearchParams(link.hash.slice(1)).get('code');
        const exchange = await fetch(origin + '/api/usage/session/exchange', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        const cookie = exchange.headers.get('set-cookie')!.split(';')[0];
        const csrf = (await exchange.json()).data.csrf;
        const mutation = (data: unknown, token = csrf, source = origin) => fetch(origin + '/api/usage/connections', { method: 'POST', headers: { Cookie: cookie, Origin: source, 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(data) });
        expect((await mutation({}, '', origin)).status).toBe(403);
        expect((await mutation({}, csrf, 'https://evil.example')).status).toBe(403);
        const c = defaultConnection('codex');
        c.enabled = false;
        const saved = await mutation({ connection: c, credential: { accessToken: 'private-token' } });
        expect(saved.status).toBe(200);
        expect(await saved.text()).not.toContain('private-token');
        const replay = await fetch(origin + '/api/usage/session/exchange', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        expect(replay.status).toBe(401);
        const html = await fetch(origin + '/settings/ai-usage');
        expect(await html.text()).toContain('/settings/settings.js');
        const script = await fetch(origin + '/settings/settings.js');
        expect(script.status).toBe(200);
    });
});
describe('independent OAuth', () => {
    it('redirects the same tab back to settings while token exchange completes, including denied sign-in', async () => {
        const oauth = new OAuthService(async () => ({ access_token: jwt('redirect-user'), refresh_token: 'fixture-refresh' }));
        cleanup.push(() => oauth.close());
        const c = defaultConnection('antigravity'); c.oauth.useBuiltin = false; c.oauth.callbackPort = 0;
        const destination = 'http://127.0.0.1:19999/settings/ai-usage#lang=zh-CN';
        const started = await oauth.start('owner', c, undefined, destination), flow = oauth.get(started.id, 'owner');
        const callback = await fetch(flow.redirect + '?state=' + flow.state + '&code=fixture', { redirect: 'manual' });
        expect(callback.status).toBe(303);
        expect(callback.headers.get('location')).toBe(destination + '&oauth=' + flow.id);
        expect(callback.headers.get('location')).not.toMatch(/fixture-refresh|redirect-user/);
        await vi.waitFor(() => expect(flow.status).toBe('ready-to-save'));
        const denied = await oauth.start('owner', c, undefined, destination), cancelled = oauth.get(denied.id, 'owner');
        const rejection = await fetch(cancelled.redirect + '?state=' + cancelled.state + '&error=access_denied', { redirect: 'manual' });
        expect(rejection.status).toBe(303); expect(cancelled.status).toBe('failed');
    });
    it('ships browser login defaults and migrates empty legacy profiles without discarding custom clients', () => {
        for (const provider of ['codex','antigravity'] as const) {
            const c = defaultConnection(provider);
            expect(c.oauth).toMatchObject({ useBuiltin: true, callbackHost: 'localhost' });
            expect(c.oauth.clientId).toBeTruthy();
            const legacy = { ...c, oauth: { ...c.oauth, useBuiltin: undefined, clientId: '' } };
            expect(validateConnection(legacy).oauth).toEqual(builtinOAuth(provider));
            expect(validateConnection({ ...legacy, oauth: { ...legacy.oauth, clientId: 'custom-registration' } }).oauth).toMatchObject({ useBuiltin: false, clientId: 'custom-registration' });
        }
    });
    it('returns same-tab authorization and callback URLs without launching a second browser tab', async () => {
        const { store: disk } = await store();
        const oauth = new OAuthService(async () => ({ access_token: jwt('browser-user'), refresh_token: 'refresh-browser', expires_in: 3600 }));
        const service = new UsageService(disk, () => {}, async () => ({ metrics: [] }), oauth);
        cleanup.push(() => service.close());
        const opener = vi.fn(async (_url: string) => {});
        const server = new UsageSettingsServer(service, opener); await server.start(); cleanup.push(() => server.close());
        const link = new URL(server.url('zh-CN')), origin = link.origin;
        const exchange = await fetch(origin + '/api/usage/session/exchange', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: new URLSearchParams(link.hash.slice(1)).get('code') }) });
        const cookie = exchange.headers.get('set-cookie')!.split(';')[0], csrf = (await exchange.json()).data.csrf;
        const post = (path: string, data: unknown) => fetch(origin + '/api/usage/' + path, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(data) });
        const response = await post('oauth/start', { navigation: 'same-tab', language: 'zh-CN', connection: { providerId: 'antigravity', displayName: 'Browser login' } });
        expect(response.status).toBe(200);
        const result = await response.json(); const flow = result.data;
        expect(flow.browserOpened).toBe(false); expect(opener).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toMatch(/GOCSPX|client_secret|refresh-browser/);
        const auth = new URL(flow.authUrl);
        expect(auth.hostname).toBe('accounts.google.com'); expect(auth.searchParams.get('client_id')).toBe(builtinOAuth('antigravity').clientId);
        expect(auth.searchParams.get('scope')).toContain('/auth/aicode');
        const callback = new URL(auth.searchParams.get('redirect_uri')!); callback.searchParams.set('state', auth.searchParams.get('state')!); callback.searchParams.set('code', 'fixture');
        const returned = await fetch(callback, { redirect: 'manual' });
        expect(returned.status).toBe(303);
        expect(returned.headers.get('location')).toBe(origin + '/settings/ai-usage#lang=zh-CN&oauth=' + flow.id);
        await vi.waitFor(async () => {
            const status = await fetch(origin + '/api/usage/oauth/' + flow.id, { headers: { Cookie: cookie } }).then(r => r.json());
            expect(status.data).toMatchObject({ status: 'ready-to-save', requiresConfirmation: false });
        });
        const saved = await post('oauth/' + flow.id + '/complete', {});
        expect(saved.status).toBe(200); expect(service.list()[0].hasCredential).toBe(true);
    });
    it('wraps built-in Codex login in the desktop browser authorization page', async () => {
        const oauth = new OAuthService(); cleanup.push(() => oauth.close());
        const flow = await oauth.start('browser', defaultConnection('codex'));
        const hosted = new URL(flow.authUrl!);
        expect(hosted.origin + hosted.pathname).toBe('https://chatgpt.com/codex/desktop-auth');
        const authorize = new URL(hosted.searchParams.get('authorize_url')!);
        expect(authorize.searchParams.get('client_id')).toBe(builtinOAuth('codex').clientId);
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:(1455|1457)\/auth\/callback$/);
    });
    it('rejects wrong state, exchanges a one-use code with PKCE, and binds identity', async () => {
        const request = vi.fn(async () => ({ access_token: jwt('user-one'), id_token: jwt('user-one'), refresh_token: 'refresh-one', expires_in: 3600 }));
        const oauth = new OAuthService(request);
        cleanup.push(() => oauth.close());
        const c = defaultConnection('codex');
        c.oauth.clientId = 'test-client';
        c.oauth.useBuiltin = false;
        c.oauth.callbackPort = 0;
        const publicFlow = await oauth.start('browser-one', c);
        const flow = oauth.get(publicFlow.id, 'browser-one');
        expect(new URL(publicFlow.authUrl!).searchParams.get('code_challenge')).toBe(pkceChallenge(flow.verifier));
        expect(() => oauth.get(flow.id, 'other-browser')).toThrow();
        expect((await fetch(flow.redirect + '?state=bad&code=bad')).status).toBe(400);
        expect(request).not.toHaveBeenCalled();
        expect((await fetch(flow.redirect + `?state=${flow.state}&code=valid`)).status).toBe(200);
        await vi.waitFor(() => expect(flow.status).toBe('ready-to-save'));
        expect(flow.connection.accountId).toBe('org-one');
        expect(flow.credential?.refreshToken).toBe('refresh-one');
        expect(JSON.stringify(oauth.publicSession(flow))).not.toContain('refresh-one');
        expect(oauth.publicSession(flow).identityLabel).toBe('user-one@example.test');
        expect(request).toHaveBeenCalledTimes(1);
        const call = (request.mock.calls as unknown as Array<[
            string,
            {
                body: string;
            }
        ]>)[0];
        expect(new URLSearchParams(call[1].body).get('grant_type')).toBe('authorization_code');
        expect(new URLSearchParams(call[1].body).get('code_verifier')).toBeTruthy();
    });
    it('does not accept an access-only login as independent OAuth', async () => {
        const oauth = new OAuthService(async () => ({ access_token: jwt('one') }));
        cleanup.push(() => oauth.close());
        const c = defaultConnection('codex');
        c.oauth.clientId = 'test';
        c.oauth.useBuiltin = false;
        c.oauth.callbackPort = 0;
        const result = await oauth.start('owner', c), flow = oauth.get(result.id, 'owner');
        await fetch(flow.redirect + `?state=${flow.state}&code=valid`);
        await vi.waitFor(() => expect(flow.status).toBe('failed'));
        expect(flow.credential).toBeUndefined();
        expect(flow.error).toContain('refresh token');
    });
    it('rotates refresh tokens, keeps omitted refresh tokens, rejects identity changes', async () => {
        const c = defaultConnection('codex');
        const previous = { accessToken: jwt('one'), refreshToken: 'old', identity: 'one', clientSecret: 'secret' };
        const oauth = new OAuthService(async () => ({ access_token: jwt('one'), refresh_token: 'new', expires_in: 3600 }));
        expect(await oauth.refresh(c, previous)).toMatchObject({ refreshToken: 'new', identity: 'one', clientSecret: 'secret' });
        expect(await new OAuthService(async () => ({ access_token: jwt('one') })).refresh(c, previous)).toMatchObject({ refreshToken: 'old' });
        await expect(new OAuthService(async () => ({ access_token: jwt('two') })).refresh(c, previous)).rejects.toMatchObject({ state: 'auth-required' });
        await expect(new OAuthService(async () => { throw new UsageError('http-400', 'private error'); }).refresh(c, previous)).rejects.toMatchObject({ code: 'oauth-revoked' });
    });
});
describe('persistence and scheduling', () => {
    it('preserves partial endpoint rate limits and cached results across restart in manual mode', async () => {
        const { root, store: disk } = await store();
        const retryAt = Date.now() + 120000;
        const c = defaultConnection('antigravity'); c.intervalMinutes = 0;
        const upstream = vi.fn(async (url: string) => {
            if (url.includes('loadCodeAssist')) return { currentTier: { id: 'pro' } };
            if (url.includes('fetchAvailableModels')) return { models: { one: { quotaInfo: { remainingFraction: .5 } } } };
            throw new UsageError('http-429', 'Rate limited', 'rate-limited', retryAt);
        });
        const service = new UsageService(disk, () => {}, (c, s, signal) => queryUsage(c, s, signal, upstream));
        const saved = await service.save(c, { accessToken: 'test' }); service.refresh(saved.id);
        await vi.waitFor(() => expect(service.snapshots()[0].state).toBe('partial'));
        await service.close();
        const query = vi.fn(async () => ({ metrics: [] }));
        const restarted = new UsageService(new UsageStore(root, codec), () => {}, query);
        cleanup.push(() => restarted.close()); await restarted.init();
        restarted.refresh(saved.id);
        expect(query).not.toHaveBeenCalled();
        expect(restarted.snapshots()[0]).toMatchObject({ retryAt: new Date(retryAt).toISOString(), nextRefreshAt: null });
        expect(restarted.snapshots()[0].metrics[0]).toMatchObject({ freshness: 'stale', remainingPercent: 50 });
    });
    it('retains queued manual login retries after the provider concurrency limit clears', async () => {
        const { store: disk } = await store();
        const resolvers: Array<(result: any) => void> = [];
        const query = vi.fn(() => new Promise<any>(resolve => resolvers.push(resolve)));
        const service = new UsageService(disk, () => {}, query); cleanup.push(() => service.close());
        await service.init();
        for (let i = 0; i < 3; i++) {
            const c = defaultConnection('codex'); c.intervalMinutes = 0;
            const saved = await service.save(c, { accessToken: 'test' }); disk.snapshots[saved.id].state = 'auth-required';
        }
        service.refresh(); expect(query).toHaveBeenCalledTimes(2);
        resolvers[0]({ metrics: [metric('quota', 'Quota')] });
        await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3), { timeout: 2000 });
        resolvers[1]({ metrics: [] }); resolvers[2]({ metrics: [] });
    });
    it('honors a later Retry-After when every endpoint fails', async () => {
        const c = defaultConnection(); c.gateway.baseUrl = 'https://example.test'; c.gateway.protocol = 'new-api';
        const retryAt = Date.now() + 120000;
        await expect(queryUsage(c, { apiKey: 'test' }, new AbortController().signal, async url => {
            if (url.includes('/token')) throw new UsageError('http-429', 'Rate limited', 'rate-limited', retryAt);
            throw new UsageError('http-500', 'Failure');
        })).rejects.toMatchObject({ retryAt, state: 'rate-limited' });
    });
    it('encrypts credentials, restores state, preserves quota on rename, and clears credentials on destination change', async () => {
        const { root, store: disk } = await store();
        const service = new UsageService(disk, () => { });
        cleanup.push(() => service.close());
        const c = defaultConnection();
        c.gateway.baseUrl = 'https://one.example';
        c.enabled = false;
        const saved = await service.save(c, { apiKey: 'private-api-key' });
        disk.snapshots[saved.id].metrics = [metric('one', 'One', { remaining: '5' })];
        const renamed = await service.save({ ...saved, displayName: 'My custom gateway' });
        expect(disk.snapshots[saved.id].metrics[0].remaining).toBe('5');
        const text = await readFile(join(root, 'state.json'), 'utf8');
        expect(text).not.toContain('private-api-key');
        const restored = new UsageStore(root, codec);
        await restored.load();
        expect(restored.credential(saved.id).apiKey).toBe('private-api-key');
        await service.save({ ...renamed, gateway: { ...renamed.gateway, baseUrl: 'https://two.example' } });
        expect(disk.credential(saved.id).apiKey).toBeUndefined();
    });
    it('does not write plaintext when encryption is unavailable', async () => {
        const { root } = await store();
        const disk = new UsageStore(root, { ...codec, available: () => false });
        disk.setCredential('id', { apiKey: 'secret' });
        await expect(disk.save()).rejects.toMatchObject({ code: 'encryption' });
        await expect(readFile(join(root, 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
    it('deduplicates refresh and drops deleted account results', async () => {
        const { store: disk } = await store();
        let done!: (value: any) => void;
        const query = vi.fn(() => new Promise<any>(resolve => done = resolve));
        const service = new UsageService(disk, () => { }, query);
        cleanup.push(() => service.close());
        const c = await service.save(defaultConnection('codex'), { accessToken: 'test' });
        service.refresh(c.id);
        service.refresh(c.id);
        expect(query).toHaveBeenCalledTimes(1);
        await service.delete(c.id);
        done({ metrics: [metric('late', 'Late')] });
        await tick();
        expect(service.list()).toHaveLength(0);
        expect(disk.snapshots[c.id]).toBeUndefined();
    });
    it('keeps failed Antigravity summary stale while updating model quota', async () => {
        const { store: disk } = await store();
        const service = new UsageService(disk, () => { }, async () => ({ metrics: [metric('model:new', 'New')], failedPrefixes: ['pool:'], partialError: 'summary unavailable' }));
        cleanup.push(() => service.close());
        const c = await service.save(defaultConnection('antigravity'), { accessToken: 'test' });
        disk.snapshots[c.id].metrics = [metric('pool:old', 'Old', { remaining: '25' })];
        service.refresh(c.id);
        await vi.waitFor(() => expect(service.snapshots()[0].refreshing).toBe(false));
        expect(service.snapshots()[0].metrics).toHaveLength(2);
        expect(service.snapshots()[0].metrics[1]).toMatchObject({ freshness: 'stale', remaining: '25' });
    });
    it('does not bypass Retry-After by clicking refresh or renaming', async () => {
        const { store: disk } = await store();
        const query = vi.fn(async () => { throw new UsageError('http-429', 'Rate limited', 'rate-limited', Date.now() + 120000); });
        const service = new UsageService(disk, () => { }, query);
        cleanup.push(() => service.close());
        const c = await service.save(defaultConnection('codex'), { accessToken: 'test' });
        service.refresh(c.id);
        await vi.waitFor(() => expect(service.snapshots()[0].state).toBe('rate-limited'));
        service.refresh(c.id);
        await service.save({ ...c, displayName: 'Rename' });
        service.refresh(c.id);
        expect(query).toHaveBeenCalledTimes(1);
    });
});
