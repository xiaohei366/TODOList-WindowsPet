import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConnection, type UsageConnection, type UsageCredential } from '../src/shared/usage';
import { UsageStore } from '../src/main/usage/store';
import { UsageService } from '../src/main/usage/service';
import { OAuthService } from '../src/main/usage/oauth';
import { metric } from '../src/main/usage/normalize';
import { UsageError } from '../src/main/usage/errors';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const codec = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const token = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const secret = (identity: string): UsageCredential => ({ identity, email: `${identity}@example.test`, name: identity, accessToken: `access-${identity}`, refreshToken: `refresh-${identity}`, expiresAt: Date.now() + 3600000 });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'pet-accounts-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const disk = new UsageStore(root, codec);
    const query = vi.fn(async (_c: UsageConnection, s: UsageCredential, _signal: AbortSignal) => ({ metrics: [metric('quota', s.email || 'Quota', { remaining: s.identity === 'alice' ? '80' : '30' })] }));
    const service = new UsageService(disk, () => {}, query);
    cleanup.push(() => service.close());
    await service.init();
    return { root, disk, service, query };
}

describe('independent usage accounts', () => {
    it('switches the Antigravity model without pausing, clearing quota, or aborting an in-flight refresh', async () => {
        const { service, disk, query } = await fixture();
        const c = await service.saveAuthorized(defaultConnection('antigravity'), secret('alice'));
        service.refresh(c.id);
        await vi.waitFor(() => expect(service.snapshots()[0].state).toBe('ok'));
        const snapshot = disk.snapshots[c.id], nextRefresh = snapshot.nextRefreshAt;
        await service.setFeaturedMetric(c.id, 'model:two');
        expect(service.list()[0]).toMatchObject({ enabled: true, featuredMetricId: 'model:two' });
        expect(disk.snapshots[c.id]).toBe(snapshot);
        expect(service.snapshots()[0]).toMatchObject({ state: 'ok', nextRefreshAt: nextRefresh, metrics: [{ remaining: '80' }] });

        // Start another query after its local cooldown, then change presentation while it waits.
        (service as any).attempts.clear();
        let finish!: () => void;
        query.mockImplementationOnce(async (_connection, _secret, signal) => {
            await new Promise<void>(resolve => finish = resolve);
            expect(signal.aborted).toBe(false);
            return { metrics: [metric('model:three', 'Three', { remaining: '72' })] };
        });
        service.refresh(c.id);
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        try {
            await service.setFeaturedMetric(c.id, 'model:three');
            expect(service.snapshots()[0].refreshing).toBe(true);
        } finally { finish(); }
        await vi.waitFor(() => expect(service.snapshots()[0]).toMatchObject({ state: 'ok', refreshing: false, featuredMetricId: 'model:three', metrics: [{ remaining: '72' }] }));
        expect(disk.credential(c.id).refreshToken).toBe('refresh-alice');
    });
    it('keeps an intentionally paused account paused when picking a model, and resumes it explicitly', async () => {
        const { service, query } = await fixture();
        const c = await service.saveAuthorized({ ...defaultConnection('antigravity'), enabled: false }, secret('alice'));
        await service.setFeaturedMetric(c.id, 'model:selected');
        expect(service.snapshots()[0].state).toBe('paused');
        expect(query).not.toHaveBeenCalled();
        await service.enable(c.id);
        await vi.waitFor(() => expect(service.snapshots()[0].state).toBe('ok'));
        expect(service.list()[0]).toMatchObject({ enabled: true, featuredMetricId: 'model:selected' });
    });
    it('persists account order without cancelling queries or changing identities, and rejects stale lists', async () => {
        const { service, disk, root, query } = await fixture();
        const a = await service.saveAuthorized(defaultConnection('codex'), secret('alice'));
        const b = await service.saveAuthorized(defaultConnection('antigravity'), secret('bob'));
        let finish!: () => void;
        query.mockImplementationOnce(async (_c, _s, signal) => { await new Promise<void>(resolve => finish = resolve); expect(signal.aborted).toBe(false); return { metrics: [metric('quota', 'Quota', { remaining: '11' })] }; });
        service.refresh(a.id);
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        try { expect((await service.reorder([b.id, a.id])).map(s => s.connectionId)).toEqual([b.id, a.id]); }
        finally { finish(); }
        await vi.waitFor(() => expect(service.snapshots()[1]).toMatchObject({ state: 'ok', metrics: [{ remaining: '11' }] }));
        await expect(service.reorder([b.id, b.id])).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.reorder([a.id])).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.reorder([b.id, 'deleted'])).rejects.toMatchObject({ code: 'conflict' });
        expect(disk.credential(a.id).email).toBe('alice@example.test');
        await service.close();
        const restored = new UsageStore(root, codec); await restored.load();
        expect(restored.connections.sort((x, y) => x.order - y.order).map(c => c.id)).toEqual([b.id, a.id]);
        expect(restored.credential(b.id).email).toBe('bob@example.test');
    });
    it('rolls back account order if persistence fails', async () => {
        const { service, disk } = await fixture();
        const a = await service.saveAuthorized(defaultConnection('codex'), secret('alice'));
        const b = await service.saveAuthorized(defaultConnection('codex'), secret('bob'));
        vi.spyOn(disk, 'save').mockRejectedValueOnce(new Error('disk unavailable'));
        await expect(service.reorder([b.id, a.id])).rejects.toThrow('disk unavailable');
        expect(service.list().map(c => [c.id, c.revision])).toEqual([[a.id, a.revision], [b.id, b.revision]]);
    });
    it('waits for background querying and reuses the completed result instead of reporting cooldown', async () => {
        const { service, query } = await fixture();
        let finish!: () => void;
        query.mockImplementationOnce(async () => { await new Promise<void>(resolve => finish = resolve); return { metrics: [metric('quota', 'Query', { remaining: '42' })] }; });
        const c = await service.saveAuthorized(defaultConnection('codex'), secret('alice'));
        service.refresh(c.id);
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        const result = service.test(c);
        finish();
        expect((await result).metrics[0].remaining).toBe('42');
        expect((await service.test(c)).metrics[0].remaining).toBe('42');
        expect(query).toHaveBeenCalledTimes(1);
    });
    it('tests another account immediately and coalesces repeated clicks on one configuration', async () => {
        const { service, query } = await fixture();
        const a = await service.saveAuthorized(defaultConnection('codex'), secret('alice'));
        const b = await service.saveAuthorized(defaultConnection('codex'), secret('bob'));
        const results = await Promise.all([service.test(a), service.test(a), service.test(b)]);
        expect(results.map(r => r.metrics[0].remaining)).toEqual(['80','80','30']);
        expect(query).toHaveBeenCalledTimes(2);
    });
    it('still respects provider Retry-After without turning it into a global test cooldown', async () => {
        const { service, query } = await fixture();
        const a = await service.saveAuthorized(defaultConnection('codex'), secret('alice'));
        query.mockRejectedValueOnce(new UsageError('http-429', 'Provider retry required', 'rate-limited', Date.now() + 60000));
        await expect(service.test(a)).rejects.toMatchObject({ code: 'http-429' });
        await expect(service.test({ ...a, displayName:'Renamed draft' })).rejects.toMatchObject({ code: 'rate-limit' });
        expect(query).toHaveBeenCalledTimes(1);
    });
    it('keeps Codex when a stale UI sends its ID for an Antigravity login', async () => {
        const { service, disk } = await fixture();
        const codex = await service.saveAuthorized({ ...defaultConnection('codex'), accountId: 'workspace-a' }, secret('alice'));
        const google = await service.saveAuthorized({ ...defaultConnection('antigravity'), id: codex.id, revision: codex.revision }, secret('alice'));
        expect(google.id).not.toBe(codex.id);
        expect(service.list()).toHaveLength(2);
        expect(disk.credential(codex.id)).toMatchObject({ accessToken: 'access-alice', refreshToken: 'refresh-alice', email: 'alice@example.test' });
        expect(service.list().find(c => c.id === codex.id)).toMatchObject({ providerId: 'codex', account: { email: 'alice@example.test', workspaceId: 'workspace-a' } });
        await expect(service.save({ ...codex, providerId: 'antigravity' })).rejects.toMatchObject({ code: 'account-bound' });
    });
    it('isolates two users on the same platform across queries, restart and deletion', async () => {
        const { service, disk, root, query } = await fixture();
        const alice = await service.saveAuthorized(defaultConnection('codex'), secret('alice'));
        const bob = await service.saveAuthorized(alice, secret('bob'));
        expect(bob.id).not.toBe(alice.id);
        service.refresh();
        await vi.waitFor(() => expect(service.snapshots().every(s => s.state === 'ok')).toBe(true));
        expect(query.mock.calls.map(([c, s]) => [c.id, s.accessToken])).toEqual(expect.arrayContaining([[alice.id, 'access-alice'], [bob.id, 'access-bob']]));
        expect(service.snapshots().find(s => s.connectionId === alice.id)).toMatchObject({ account: { email: 'alice@example.test' }, metrics: [{ remaining: '80' }] });
        expect(service.snapshots().find(s => s.connectionId === bob.id)).toMatchObject({ account: { email: 'bob@example.test' }, metrics: [{ remaining: '30' }] });
        await service.close();
        const reloaded = new UsageStore(root, codec); await reloaded.load();
        expect(reloaded.credential(alice.id).email).toBe('alice@example.test');
        expect(reloaded.credential(bob.id).email).toBe('bob@example.test');
        const next = new UsageService(reloaded, () => {}, query); cleanup.push(() => next.close());
        await next.delete(alice.id);
        expect(next.list().map(c => c.id)).toEqual([bob.id]);
        expect(reloaded.credential(alice.id)).toEqual({});
        expect(reloaded.credential(bob.id).refreshToken).toBe('refresh-bob');
        expect(disk.connections).toHaveLength(2);
    });
    it('deduplicates repeat sign-ins atomically while preserving aliases and other identities', async () => {
        const { service, disk } = await fixture();
        const first = await service.saveAuthorized({ ...defaultConnection('codex'), displayName: 'Work plan', accountId: 'workspace-a' }, secret('alice'));
        const other = await service.saveAuthorized(defaultConnection('codex'), secret('bob'));
        const [a, b] = await Promise.all([
            service.saveAuthorized({ ...defaultConnection('codex'), accountId: 'workspace-a' }, { ...secret('alice'), refreshToken: 'rotated-a' }),
            service.saveAuthorized({ ...defaultConnection('codex'), accountId: 'workspace-a' }, { ...secret('alice'), refreshToken: 'rotated-b' })
        ]);
        expect([a.id, b.id]).toEqual([first.id, first.id]);
        expect(b.displayName).toBe('Work plan');
        expect(service.list()).toHaveLength(2);
        expect(disk.credential(first.id).refreshToken).toBe('rotated-b');
        expect(disk.credential(other.id).refreshToken).toBe('refresh-bob');
        expect(JSON.stringify(service.list()) + JSON.stringify(service.snapshots())).not.toMatch(/access-alice|rotated-b|refresh-bob/);
    });
    it('separates workspaces and users with identical email addresses', async () => {
        const { service } = await fixture();
        const c = { ...defaultConnection('codex'), accountId: 'workspace-a' };
        const one = await service.saveAuthorized(c, secret('alice'));
        const two = await service.saveAuthorized({ ...one, accountId: 'workspace-b' }, secret('alice'));
        const three = await service.saveAuthorized(c, { ...secret('another-subject'), email: 'alice@example.test' });
        expect(new Set([one.id, two.id, three.id]).size).toBe(3);
        expect(service.snapshots().map(s => s.account?.workspaceId)).toEqual(['workspace-a', 'workspace-b', 'workspace-a']);
    });
    it('does not resurrect a deleted login target or overwrite a concurrently edited one', async () => {
        const { service } = await fixture();
        const c = await service.saveAuthorized(defaultConnection('codex'), secret('alice'));
        await service.save({ ...c, displayName: 'New alias' });
        await expect(service.saveAuthorized(c, secret('alice'))).rejects.toMatchObject({ code: 'conflict' });
        await service.delete(c.id);
        await expect(service.saveAuthorized(c, secret('alice'))).rejects.toMatchObject({ code: 'not-found' });
    });
    it('shows legacy Codex nested profile claims without requiring another login', async () => {
        const { service } = await fixture();
        const accessToken = token({ sub: 'legacy-user', 'https://api.openai.com/profile': { email: 'legacy@example.test', name: 'Legacy' }, 'https://api.openai.com/auth': { chatgpt_account_id: 'legacy-workspace' } });
        await service.save(defaultConnection('codex'), { accessToken, identity: 'legacy-user' });
        expect(service.snapshots()[0].account).toEqual({ subject: 'legacy-user', email: 'legacy@example.test', name: 'Legacy', workspaceId: 'legacy-workspace' });
    });
    it('backfills old Google profile details and checks the subject before saving them', async () => {
        const { service, disk } = await fixture();
        await service.close();
        const oauth = new OAuthService(async () => ({ sub: 'google-user', email: 'google@example.test', name: 'Google User' }));
        const next = new UsageService(disk, () => {}, async () => ({ metrics: [] }), oauth);
        cleanup.push(() => next.close());
        const c = await next.save(defaultConnection('antigravity'), { identity: 'google-user', accessToken: 'opaque', expiresAt: Date.now() + 3600000 });
        next.refresh(c.id);
        await vi.waitFor(() => expect(next.snapshots()[0].account?.email).toBe('google@example.test'));
        expect(disk.credential(c.id).name).toBe('Google User');
        await expect(oauth.enrichIdentity(c, { identity: 'someone-else', accessToken: 'opaque' })).rejects.toMatchObject({ code: 'identity-changed' });
    });
    it('keeps email through token rotation and rejects a changed workspace', async () => {
        const c = { ...defaultConnection('codex'), accountId: 'workspace-a' };
        const oauth = new OAuthService(async () => ({ access_token: token({ sub: 'alice', 'https://api.openai.com/auth': { chatgpt_account_id: 'workspace-a' } }) }));
        expect(await oauth.refresh(c, secret('alice'))).toMatchObject({ email: 'alice@example.test', name: 'alice', refreshToken: 'refresh-alice' });
        await expect(oauth.refresh({ ...c, accountId: 'workspace-b' }, secret('alice'))).rejects.toMatchObject({ state: 'auth-required' });
    });
});
