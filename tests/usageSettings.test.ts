import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { defaultConnection } from '../src/shared/usage';
import { metric } from '../src/main/usage/normalize';
const { JSDOM } = createRequire(import.meta.url)('jsdom');

describe('browser sign-in settings flow', () => {
    it.each([true, false])('saves an Antigravity model independently of enabled=%s and offers explicit resume', async enabled => {
        const dom = new JSDOM(readFileSync('src/main/usage/web/index.html', 'utf8'), { url: 'http://127.0.0.1:1234/settings/ai-usage#code=test', runScripts: 'outside-only' });
        let c = { ...defaultConnection('antigravity'), id: 'google', revision: 1, enabled };
        let modelBody: unknown, fullSave = false;
        const fetch = vi.fn(async (url: string, options?: { body?: string; method?: string }) => {
            const path = url.replace('/api/usage/', ''); let data: unknown;
            if (path === 'session/exchange') data = { csrf: 'csrf' };
            else if (path === 'providers') data = [defaultConnection(), defaultConnection('antigravity')];
            else if (path === 'connections') { fullSave ||= options?.method === 'POST'; data = [c]; }
            else if (path === 'snapshots') data = [{ connectionId: c.id, state: c.enabled ? 'ok' : 'paused', metrics: [metric('model:a', 'Gemini'), metric('model:b', 'Claude')] }];
            else if (path === 'connections/google/featured') { modelBody = JSON.parse(options!.body!); c = { ...c, revision: 2, featuredMetricId: 'model:b' }; data = c; }
            else if (path === 'connections/google/enable') { c = { ...c, enabled: true, revision: 3 }; data = c; }
            else if (path === 'refresh') data = {};
            else throw new Error(path);
            return { ok: true, json: async () => ({ ok: true, data }) };
        });
        Object.assign(dom.window, { fetch, structuredClone });
        try {
            dom.window.eval(readFileSync('src/main/usage/web/settings.js', 'utf8'));
            const doc = dom.window.document;
            await vi.waitFor(() => expect(doc.querySelectorAll('#featured-metric option')).toHaveLength(3));
            const picker = doc.querySelector('#featured-metric') as HTMLSelectElement;
            picker.value = 'model:b'; picker.dispatchEvent(new dom.window.Event('change'));
            await vi.waitFor(() => expect(doc.querySelector('#model-feedback')!.textContent).toContain('已更新'));
            expect(modelBody).toEqual({ metricId: 'model:b' }); expect(fullSave).toBe(false);
            expect(c.enabled).toBe(enabled); expect((doc.querySelector('#enabled') as HTMLInputElement).checked).toBe(enabled);
            if (!enabled) expect(doc.querySelector('#refresh')!.textContent).toBe('恢复并刷新');
            (doc.querySelector('#refresh') as HTMLButtonElement).click();
            await vi.waitFor(() => expect(c.enabled).toBe(true));
            expect(picker.value).toBe('model:b');
        } finally { await new Promise(resolve => setTimeout(resolve, 0)); dom.window.close(); }
    });
    it('renders test feedback below its button, keeps it during refresh and saves all selected periods', async () => {
        const dom = new JSDOM(readFileSync('src/main/usage/web/index.html', 'utf8'), { url:'http://127.0.0.1:1234/settings/ai-usage#code=test', runScripts:'outside-only' });
        const c = { ...defaultConnection(), id:'gateway', revision:1 }; c.gateway.baseUrl = 'https://example.test';
        let posted: any;
        const fetch = vi.fn(async (url: string, options?: { body?: string; method?: string }) => {
            const path = url.replace('/api/usage/', '');
            let data: unknown;
            if (path === 'session/exchange') data = { csrf:'csrf' };
            else if (path === 'providers') data = [defaultConnection(),defaultConnection('codex'),defaultConnection('antigravity')];
            else if (path === 'connections' && options?.method === 'POST') { posted = JSON.parse(options.body!); data = c; }
            else if (path === 'connections') data = [c];
            else if (path === 'snapshots') data = [{ connectionId:'gateway', metrics:[metric('cached','Background usage',{remaining:'1'})] }];
            else if (path === 'test') data = { metrics:[metric('tested','Test usage',{remaining:'50'})], partialError:'Monthly endpoint unavailable' };
            else if (path === 'refresh') data = { accepted:true };
            else throw new Error(path);
            return { ok:true, json:async()=>({ok:true,data}) };
        });
        Object.assign(dom.window,{fetch,structuredClone});
        try {
            dom.window.eval(readFileSync('src/main/usage/web/settings.js','utf8'));
            const doc = dom.window.document;
            await vi.waitFor(()=>expect(doc.querySelectorAll('.period-row')).toHaveLength(1));
            (doc.querySelector('#add-period') as HTMLButtonElement).click(); (doc.querySelector('#add-period') as HTMLButtonElement).click();
            expect(doc.querySelectorAll('.period-row')).toHaveLength(3);
            (doc.querySelector('.period-budget') as HTMLInputElement).value = '100';
            (doc.querySelector('#test') as HTMLButtonElement).click();
            await vi.waitFor(()=>expect(doc.querySelector('#test-results')!.textContent).toContain('Test usage'));
            expect(doc.querySelector('#test-results')!.textContent).toContain('Monthly endpoint unavailable');
            expect(doc.querySelector('#test')!.compareDocumentPosition(doc.querySelector('#test-feedback')!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(doc.querySelector('#message')!.textContent).not.toContain('查询完成');
            (doc.querySelector('#refresh') as HTMLButtonElement).click();
            await vi.waitFor(()=>expect(doc.querySelector('#results')!.textContent).toContain('Background usage'));
            expect(doc.querySelector('#test-results')!.textContent).toContain('Test usage');
            doc.querySelector('#form')!.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
            await vi.waitFor(()=>expect(posted.connection.gateway.periods).toEqual([{period:'month',budget:100},{period:'today'},{period:'week'}]));
            await vi.waitFor(()=>expect(doc.querySelector('#message')!.textContent).toContain('已保存'));
        } finally { await new Promise(resolve=>setTimeout(resolve,0)); dom.window.close(); }
    });
    it.each(['codex', 'antigravity'] as const)('adds %s beside an existing Codex account and displays both identities', async provider => {
        let dom = new JSDOM(readFileSync('src/main/usage/web/index.html', 'utf8'), { url: 'http://127.0.0.1:1234/settings/ai-usage#code=test', runScripts: 'outside-only' });
        const first = { ...defaultConnection('codex'), id: 'alice-id', revision: 1, hasCredential: true, account: { email: 'alice@example.test', workspaceId: 'workspace-alice' } };
        const second = { ...defaultConnection(provider), id: 'bob-id', revision: 1, hasCredential: true, account: { email: 'bob@example.test' } };
        let connected = false;
        const fetch = vi.fn(async (url: string, options?: { body?: string }) => {
            const path = url.replace('/api/usage/', '');
            let data: unknown;
            if (path === 'session/exchange' || path === 'session') data = { csrf: 'csrf' };
            else if (path === 'providers') data = [defaultConnection('personal-gateway'), defaultConnection('codex'), defaultConnection('antigravity')];
            else if (path === 'connections') data = connected ? [first, second] : [first];
            else if (path === 'snapshots') data = [];
            else if (path === 'oauth/start') {
                const input = JSON.parse(options!.body!);
                expect(input.connection).toMatchObject({ id: '', revision: 0, providerId: provider });
                expect(input.connection.accountId).toBeUndefined();
                data = { id: 'new-login', authUrl: 'http://127.0.0.1:1234/settings/ai-usage#fixture-login', browserOpened: true };
            } else if (path === 'oauth/new-login') data = { id: 'new-login', status: 'ready-to-save', identityLabel: 'bob@example.test' };
            else if (path === 'oauth/new-login/complete') { connected = true; data = second; }
            else throw new Error('Unexpected path ' + path);
            return { ok: true, json: async () => ({ ok: true, data }) };
        });
        Object.assign(dom.window, { fetch, structuredClone });
        try {
            dom.window.eval(readFileSync('src/main/usage/web/settings.js', 'utf8'));
            let doc = dom.window.document;
            await vi.waitFor(() => expect(doc.querySelector('#account-identity')!.textContent).toContain('alice@example.test'));
            expect(doc.querySelector('#accounts')!.textContent).toContain('workspace-alice');
            if (provider === 'codex') (doc.querySelector('#add-same') as HTMLButtonElement).click();
            else {
                const select = doc.querySelector('#provider') as HTMLSelectElement;
                select.value = provider; select.dispatchEvent(new dom.window.Event('change'));
            }
            expect(doc.querySelector('#accounts')!.textContent).toContain('alice@example.test');
            (doc.querySelector('#authorize') as HTMLButtonElement).click();
            await vi.waitFor(() => expect(dom.window.sessionStorage.getItem('pet-usage-flow')).toBe('new-login'));
            expect(connected).toBe(false);
            await new Promise(resolve => setTimeout(resolve, 0)); dom.window.close();
            dom = new JSDOM(readFileSync('src/main/usage/web/index.html', 'utf8'), { url: 'http://127.0.0.1:1234/settings/ai-usage#oauth=new-login', runScripts: 'outside-only' });
            Object.assign(dom.window, { fetch, structuredClone });
            dom.window.eval(readFileSync('src/main/usage/web/settings.js', 'utf8')); doc = dom.window.document;
            await vi.waitFor(() => expect(doc.querySelectorAll('#accounts button')).toHaveLength(2));
            expect(doc.querySelector('#account-identity')!.textContent).toContain('bob@example.test');
            expect(doc.querySelector('#accounts')!.textContent).toContain('alice@example.test');
            expect(doc.querySelector('#login-title')!.textContent).toBe('账号连接成功');
            (doc.querySelector('#login-back') as HTMLButtonElement).click();
            (doc.querySelector('#accounts button') as HTMLButtonElement).click();
            expect(doc.querySelector('#account-identity')!.textContent).toContain('alice@example.test');
        } finally { await new Promise(resolve => setTimeout(resolve, 0)); dom.window.close(); }
    });
    it.each(['codex', 'antigravity'] as const)('connects %s without client fields or a second save click', async provider => {
        const html = readFileSync('src/main/usage/web/index.html', 'utf8');
        const script = readFileSync('src/main/usage/web/settings.js', 'utf8');
        let dom = new JSDOM(html, { url: 'http://127.0.0.1:1234/settings/ai-usage#code=test', runScripts: 'outside-only' });
        const c = defaultConnection(provider), saved = { ...c, id: 'saved-account', hasCredential: true };
        let connected = false;
        const fetch = vi.fn(async (url: string, options?: { body?: string }) => {
            const path = url.replace('/api/usage/', '');
            let data: unknown;
            if (path === 'session/exchange' || path === 'session') data = { csrf: 'test-csrf' };
            else if (path === 'providers') data = [defaultConnection('personal-gateway'), defaultConnection('codex'), defaultConnection('antigravity')];
            else if (path === 'connections') data = connected ? [saved] : [];
            else if (path === 'snapshots') data = [];
            else if (path === 'oauth/start') {
                const input = JSON.parse(options!.body!);
                expect(input.connection.oauth.useBuiltin).toBe(true); expect(input.navigation).toBe('same-tab');
                expect(input.credential).toEqual({});
                data = { id: 'flow', status: 'authorizing', browserOpened: true, authUrl: 'http://127.0.0.1:1234/settings/ai-usage#fixture-login' };
            } else if (path === 'oauth/flow') data = { id: 'flow', status: 'ready-to-save', identityLabel: 'test@example.test', requiresConfirmation: false };
            else if (path === 'oauth/flow/complete') { connected = true; data = saved; }
            else throw new Error('Unexpected request: ' + path);
            return { ok: true, json: async () => ({ ok: true, data }) };
        });
        Object.assign(dom.window, { fetch, structuredClone });
        try {
            dom.window.eval(script);
            let doc = dom.window.document;
            await vi.waitFor(() => expect((doc.querySelector('#name') as HTMLInputElement).value).toBeTruthy());
            const select = doc.querySelector('#provider') as HTMLSelectElement;
            select.value = provider; select.dispatchEvent(new dom.window.Event('change'));
            expect((doc.querySelector('#oauth-advanced') as HTMLDetailsElement).open).toBe(false);
            expect((doc.querySelector('#custom-oauth') as HTMLElement).hidden).toBe(true);
            (doc.querySelector('#authorize') as HTMLButtonElement).click();
            await vi.waitFor(() => expect(dom.window.sessionStorage.getItem('pet-usage-flow')).toBe('flow'));
            expect(connected).toBe(false);
            await new Promise(resolve => setTimeout(resolve, 0)); dom.window.close();
            dom = new JSDOM(readFileSync('src/main/usage/web/index.html', 'utf8'), { url: 'http://127.0.0.1:1234/settings/ai-usage#oauth=flow', runScripts: 'outside-only' });
            Object.assign(dom.window, { fetch, structuredClone });
            dom.window.eval(readFileSync('src/main/usage/web/settings.js', 'utf8')); doc = dom.window.document;
            await vi.waitFor(() => expect(connected).toBe(true));
            await vi.waitFor(() => expect(doc.querySelector('#message')!.textContent).toContain('登录成功'));
            expect(fetch.mock.calls.filter(([url]) => url.endsWith('/complete'))).toHaveLength(1);
            expect((doc.querySelector('#complete-auth') as HTMLElement).hidden).toBe(true);
        } finally { dom.window.close(); }
    });
});
