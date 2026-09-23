// Isolated developer fixture. Never included in the portable application.
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'pet-usage-preview-'));
const previewRoutes = [];
const vite = await createVite({ configFile: false, root: process.cwd(), plugins: [react(), { name: 'usage-fixture', configureServer(server) { server.middlewares.use((req, res, next) => { const route = previewRoutes.find(([path]) => req.url.split('?')[0] === path); if (route)
                void route[1](req, res);
            else
                next(); }); } }], server: { host: '127.0.0.1', port: 0 } });
const { UsageService } = await vite.ssrLoadModule('/src/main/usage/service.ts');
const { UsageStore } = await vite.ssrLoadModule('/src/main/usage/store.ts');
const { UsageSettingsServer } = await vite.ssrLoadModule('/src/main/usage/settingsServer.ts');
const { defaultConnection } = await vite.ssrLoadModule('/src/shared/usage.ts');
const { queryUsage } = await vite.ssrLoadModule('/src/main/usage/adapters.ts');
const { codexMetrics, antigravitySummary } = await vite.ssrLoadModule('/src/main/usage/normalize.ts');
const fixture = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url, 'http://fixture');
    const tokens = { today: 2000000, week: 12000000, month: 35000000 }[url.searchParams.get('window')] || 2000000;
    const data = url.pathname.includes('by-model') ? [{ model:'demo', total_tokens:tokens }] : url.pathname.includes('/models') ? [{ id:'demo', credit:1 }] : url.pathname.includes('summary') ? {total_tokens:tokens} : { balance:18.75, reset_at:'2026-10-01T00:00:00Z' };
    res.end(JSON.stringify({ mock:true, data }));
});
await new Promise(r => fixture.listen(0, '127.0.0.1', r));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
const service = new UsageService(new UsageStore(root, { available: () => false, encrypt: () => { throw new Error('No credentials in preview'); }, decrypt: () => { throw new Error('No credentials in preview'); } }), () => { }, async (c, s, signal) => {
    if (c.providerId === 'antigravity')
        return { mock: true, planName: 'Demo plan', metrics: antigravitySummary({ groups: [{ buckets: [
            { bucketId: 'gemini-5h', remainingFraction: 0.65, resetTime: new Date(Date.now() + 4800000).toISOString() },
            { bucketId: 'gemini-weekly', remainingFraction: 0.42, resetTime: new Date(Date.now() + 259200000).toISOString() },
            { bucketId: '3p-5h', remainingFraction: 0.30, resetTime: new Date(Date.now() + 7200000).toISOString() },
            { bucketId: '3p-weekly', remainingFraction: 0.18, resetTime: new Date(Date.now() + 345600000).toISOString() }
        ] }] }) };
    if (c.providerId === 'codex')
        return { mock: true, planName: 'Demo plan', metrics: codexMetrics({ rate_limit: { primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_after_seconds: 4800 }, secondary_window: { used_percent: 82, limit_window_seconds: 604800, reset_after_seconds: 180000 } } }) };
    if (c.gateway.baseUrl !== fixtureUrl)
        throw new Error('Preview accepts only its fixture server');
    return queryUsage(c, s, signal);
});
await service.init();
const gateway = defaultConnection();
gateway.displayName = '个人网关 · 演示';
gateway.gateway = { ...gateway.gateway, protocol: 'custom-json', deploymentProvider: 'custom', baseUrl: fixtureUrl, allowPrivate: true, auth: 'none' };
gateway.gateway.custom.mappings[0].resetsAt = '/data/reset_at';
await service.save(gateway);
const codex = defaultConnection('codex');
codex.displayName = '工作账号 · 演示';
codex.order = -1;
const alice = await service.save(codex);
const bob = await service.save({ ...codex, displayName: '个人账号 · 演示' });
const google = await service.save({ ...defaultConnection('antigravity'), displayName: 'Google · 演示' });
// Synthetic public identities only; the preview never stores or requests official credentials.
const identities = new Map([[alice.id, { email: 'alice@example.test', workspaceId: 'demo-team' }], [bob.id, { email: 'bob@example.test', workspaceId: 'demo-personal' }], [google.id, { email: 'google@example.test' }]]);
const list = service.list.bind(service);
service.list = () => list().map(c => ({ ...c, account: identities.get(c.id) }));
service.refresh();
const settings = new UsageSettingsServer(service);
await settings.start();
previewRoutes.push(['/preview/snapshots', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(service.snapshots())); }]);
previewRoutes.push(['/preview/reorder', async (req, res) => {
    try { const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const result = await service.reorder(JSON.parse(Buffer.concat(chunks).toString()));
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch { res.statusCode = 409; res.end('{}'); }
}]);
previewRoutes.push(['/preview/pet.html', async (req, res) => {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pet usage preview</title></head><body style="margin:0;background:#eff3ed"><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import {UsagePanel} from '/src/renderer/src/UsagePanel.tsx';
import '/src/renderer/src/styles.css';
window.todoPet={usage:{list:()=>fetch('/preview/snapshots').then(r=>r.json()),onChanged:(listener)=>{const timer=setInterval(()=>fetch('/preview/snapshots').then(r=>r.json()).then(listener),1000);return()=>clearInterval(timer)},reorder:(ids)=>fetch('/preview/reorder',{method:'POST',body:JSON.stringify(ids)}).then(r=>{if(!r.ok)throw Error('Reorder failed');return r.json()}),refresh:async()=>{},openSettings:async()=>{}}};
createRoot(document.getElementById('root')).render(React.createElement(UsagePanel,{language:'zh-CN',scale:Number(new URLSearchParams(location.search).get('scale')||1),onClose:()=>{}}));
</script></body></html>`;
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, html));
    }]);
await vite.listen();
console.log(JSON.stringify({ settings: settings.url('zh-CN'), pet: `http://127.0.0.1:${vite.httpServer.address().port}/preview/pet.html`, fixture: fixtureUrl }));
async function close() { await settings.close(); await service.close(); await vite.close(); fixture.closeAllConnections(); await new Promise(r => fixture.close(r)); if (resolve(root).startsWith(resolve(tmpdir()) + '\\pet-usage-preview-'))
    await rm(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
