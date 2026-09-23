import { createHash, randomUUID } from 'node:crypto';
import type { UsageConnection, UsageCredential, UsageSnapshot } from '../../shared/usage';
import { validateConnection } from './config';
import { queryUsage, type QueryResult } from './adapters';
import { identityFromToken, OAuthService } from './oauth';
import { UsageStore } from './store';
import { UsageError, safeError } from './errors';
export class UsageService {
    readonly oauth: OAuthService;
    private jobs = new Map<string, Promise<void>>();
    private controllers = new Map<string, AbortController>();
    private attempts = new Map<string, number>();
    private failures = new Map<string, number>();
    private blockedUntil = new Map<string, number>();
    private requested = new Set<string>();
    private testing = new Set<string>();
    private timer?: NodeJS.Timeout;
    private suspended = false;
    private closed = false;
    private mutation: Promise<unknown> = Promise.resolve();
    private resetQueries = new Set<string>();
    private testRunning = 0;
    private testProvider?: UsageConnection['providerId'];
    private testQueue: Promise<unknown> = Promise.resolve();
    private testCache = new Map<string, { expires: number; result: Promise<QueryResult> }>();
    private identityAttempts = new Map<string, number>();
    constructor(readonly store: UsageStore, private changed: () => void, private query: (c: UsageConnection, s: UsageCredential, signal: AbortSignal) => Promise<QueryResult> = queryUsage, oauth = new OAuthService()) { this.oauth = oauth; }
    async init(): Promise<void> {
        await this.store.load();
        for (const c of this.store.connections) {
            const s = this.store.snapshots[c.id];
            if (s) {
                s.refreshing = false;
                s.metrics.forEach(m => m.freshness = 'stale');
                const retry = Date.parse(s.retryAt || s.nextRefreshAt || '') || 0;
                if ((s.retryAt || s.state === 'rate-limited' || s.errorCode === 'http-429') && retry > Date.now())
                    this.blockedUntil.set(c.id, retry);
                if (!c.enabled || !c.intervalMinutes || ['auth-required', 'forbidden', 'unsupported'].includes(s.state))
                    s.nextRefreshAt = null;
                else if ((!s.retryAt && !['rate-limited', 'error'].includes(s.state) && s.errorCode !== 'http-429') || retry <= Date.now())
                    s.nextRefreshAt = new Date(Date.now() + Math.random() * 15000).toISOString();
            }
        }
        this.timer = setInterval(() => this.tick(), 1000);
    }
    private serial<T>(operation: () => Promise<T>): Promise<T> { const next = this.mutation.catch(() => { }).then(operation); this.mutation = next; return next; }
    list(): UsageConnection[] {
        return this.store.connections.map(c => {
            const credential = this.store.credential(c.id), hint = identityFromToken(credential.accessToken || '');
            return { ...structuredClone(c), hasCredential: Boolean(credential.accessToken || credential.apiKey),
                account: c.providerId === 'personal-gateway' ? undefined : { email: credential.email || hint.email, name: credential.name || hint.name, subject: credential.identity || hint.identity, workspaceId: c.accountId || hint.accountId } };
        }).sort((a, b) => a.order - b.order);
    }
    snapshots(): UsageSnapshot[] {
        return this.list().map(c => {
            const s = structuredClone(this.store.snapshots[c.id] || this.empty(c));
            s.displayName = c.displayName;
            s.account = c.account;
            s.featuredMetricId = c.featuredMetricId;
            s.staleAfterMs = Math.max(10, 2 * c.intervalMinutes) * 60000;
            if (!c.enabled) {
                s.state = 'paused';
                s.nextRefreshAt = null;
            }
            for (const m of s.metrics)
                if (Date.now() - Date.parse(m.observedAt) > Math.max(10, 2 * c.intervalMinutes) * 60000)
                    m.freshness = 'stale';
            if (c.pinnedMetricIds.length)
                s.metrics.sort((a, b) => { const ai = c.pinnedMetricIds.indexOf(a.id), bi = c.pinnedMetricIds.indexOf(b.id); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi); });
            return s;
        });
    }
    private empty(c: UsageConnection): UsageSnapshot {
        return { connectionId: c.id, configRevision: c.revision, providerId: c.providerId, displayName: c.displayName,
            state: c.enabled ? 'unconfigured' : 'paused', refreshing: false, metrics: [], lastAttemptAt: null, lastSuccessAt: null, nextRefreshAt: null };
    }
    save(input: unknown, supplied?: UsageCredential): Promise<UsageConnection> { return this.persist(input, supplied, false); }
    saveAuthorized(input: unknown, supplied: UsageCredential): Promise<UsageConnection> { return this.persist(input, supplied, true); }
    async setFeaturedMetric(id: string, metricId: unknown): Promise<UsageConnection> {
        const c = this.store.connections.find(x => x.id === id);
        if (!c) throw new UsageError('not-found', '账号不存在 / Account not found');
        if (c.providerId !== 'antigravity' || typeof metricId !== 'string' || metricId.length > 256)
            throw new UsageError('invalid', '模型选择无效 / Invalid model selection');
        // A model choice is presentation only: never serialize the form's enable switch or credentials.
        return this.save({ ...c, featuredMetricId: metricId || undefined });
    }
    async enable(id: string): Promise<void> {
        const c = this.store.connections.find(x => x.id === id);
        if (!c) throw new UsageError('not-found', '账号不存在 / Account not found');
        if (!c.enabled) await this.save({ ...c, enabled: true });
        this.refresh(id);
    }
    reorder(ids: unknown): Promise<UsageSnapshot[]> {
        return this.serial(async () => {
            const previous = this.store.connections;
            if (!Array.isArray(ids) || ids.length !== previous.length || new Set(ids).size !== ids.length ||
                ids.some(id => typeof id !== 'string' || !previous.some(c => c.id === id)))
                throw new UsageError('conflict', '账号列表已更新，请重试排序 / Account list changed; retry ordering');
            const next = ids.map((id, order) => { const c = previous.find(c => c.id === id)!; return { ...c, order, revision: c.revision + 1 }; });
            this.store.connections = next;
            for (const c of next) if (this.store.snapshots[c.id]) this.store.snapshots[c.id].configRevision = c.revision;
            try { await this.store.save(); }
            catch (error) {
                this.store.connections = previous;
                for (const c of previous) if (this.store.snapshots[c.id]) this.store.snapshots[c.id].configRevision = c.revision;
                throw error;
            }
            this.changed();
            return this.snapshots();
        });
    }
    private async persist(input: unknown, supplied: UsageCredential | undefined, authorized: boolean): Promise<UsageConnection> {
        return this.serial(async () => {
            let c = validateConnection(input), old = this.store.connections.find(x => x.id === c.id);
            if (c.id && !old)
                throw new UsageError('not-found', '账号不存在 / Account not found');
            if (old && old.revision !== c.revision)
                throw new UsageError('conflict', '配置已更新，请重新载入 / Configuration changed');
            if (authorized) {
                if (!supplied?.identity || !supplied.accessToken || c.providerId === 'personal-gateway')
                    throw new UsageError('oauth-identity', '授权身份不完整 / Account identity unavailable');
                // Match the provider, subject and workspace, never the editable alias or email alone.
                const match = this.store.connections.find(x => {
                    const secret = this.store.credential(x.id), hint = identityFromToken(secret.accessToken || '');
                    return x.providerId === c.providerId && x.credentialMode === 'oauth-owned' &&
                        (secret.identity || hint.identity) === supplied.identity &&
                        (x.accountId || hint.accountId || '') === (c.accountId || '') && (x.projectId || '') === (c.projectId || '');
                });
                if (match) {
                    c = { ...(match.id === c.id ? c : structuredClone(match)), oauth: c.oauth, credentialMode: 'oauth-owned' };
                    old = match;
                } else if (old && (old.providerId !== c.providerId || this.store.credential(old.id).accessToken || this.store.credential(old.id).apiKey)) {
                    // A different browser identity creates its own record even during reauthorization.
                    c = { ...c, id: '', revision: 0, displayName: c.providerId };
                    old = undefined;
                }
                if (!old) c.order = Math.max(-1, ...this.store.connections.map(x => x.order)) + 1;
            } else if (old && (old.providerId !== c.providerId || old.credentialMode === 'oauth-owned' &&
                (old.accountId !== c.accountId || supplied?.identity && this.store.credential(old.id).identity && supplied.identity !== this.store.credential(old.id).identity))) {
                throw new UsageError('account-bound', '请添加新账号，已有账号不能更换平台或身份 / Add a new account to change platform or identity');
            }
            if (!old && this.store.connections.length >= 50)
                throw new UsageError('limit', '最多 50 个账号 / Limit: 50 accounts');
            const previous = old ? this.store.credential(old.id) : {};
            const identityChanged = old && (old.providerId !== c.providerId || old.accountId !== c.accountId || old.projectId !== c.projectId || old.gateway.baseUrl !== c.gateway.baseUrl || old.credentialMode !== c.credentialMode || JSON.stringify(old.oauth) !== JSON.stringify(c.oauth));
            // Never attach a credential to a newly edited destination without explicit replacement.
            const replacingCredential = Boolean(supplied && Object.keys(supplied).length);
            const credential = authorized || identityChanged ? supplied || {} : { ...previous, ...supplied };
            if (old?.gateway.modelsBaseUrl !== c.gateway.modelsBaseUrl && !supplied?.modelsApiKey)
                delete credential.modelsApiKey;
            c.id ||= randomUUID();
            c.revision += 1;
            delete c.hasCredential;
            const originalConnections = this.store.connections, oldSnapshot = this.store.snapshots[c.id];
            // Ignore hidden gateway fields for official accounts. Display edits must keep the live
            // snapshot object, so a query already in flight can still publish its result.
            const queryConfig = (value: UsageConnection) => JSON.stringify({ ...value, displayName: '', order: 0, pinnedMetricIds: [], featuredMetricId: undefined, revision: 0,
                gateway: value.providerId === 'personal-gateway' ? value.gateway : undefined });
            const onlyDisplayChange = old && !replacingCredential && queryConfig(old) === queryConfig(c);
            if (!onlyDisplayChange) this.controllers.get(c.id)?.abort();
            this.store.connections = [...originalConnections.filter(x => x.id !== c.id), c];
            this.store.setCredential(c.id, credential);
            const oldMetadata = oldSnapshot && { displayName: oldSnapshot.displayName, configRevision: oldSnapshot.configRevision };
            this.store.snapshots[c.id] = onlyDisplayChange && oldSnapshot ? Object.assign(oldSnapshot, { displayName: c.displayName, configRevision: c.revision }) : this.empty(c);
            if (!identityChanged && (this.blockedUntil.get(c.id) || 0) > Date.now()) this.store.snapshots[c.id].retryAt = new Date(this.blockedUntil.get(c.id)!).toISOString();
            try {
                await this.store.save();
            }
            catch (e) {
                this.store.connections = originalConnections;
                this.store.setCredential(c.id, previous);
                if (oldSnapshot) {
                    Object.assign(oldSnapshot, oldMetadata);
                    this.store.snapshots[c.id] = oldSnapshot;
                }
                else
                    delete this.store.snapshots[c.id];
                throw e;
            }
            if (identityChanged) {
                this.blockedUntil.delete(c.id);
                this.attempts.delete(c.id);
            }
            this.changed();
            return this.list().find(x => x.id === c.id)!;
        });
    }
    async delete(id: string): Promise<void> {
        return this.serial(async () => {
            const connections = this.store.connections, credential = this.store.credential(id), snapshot = this.store.snapshots[id];
            this.controllers.get(id)?.abort();
            this.requested.delete(id);
            this.identityAttempts.delete(id);
            this.store.delete(id);
            try {
                await this.store.save();
            }
            catch (e) {
                this.store.connections = connections;
                this.store.setCredential(id, credential);
                if (snapshot)
                    this.store.snapshots[id] = snapshot;
                throw e;
            }
            this.changed();
        });
    }
    async test(input: unknown, supplied?: UsageCredential): Promise<QueryResult> {
        const c = validateConnection(input), existing = this.store.connections.find(x => x.id === c.id);
        const key = createHash('sha256').update(JSON.stringify([c, supplied, existing ? this.store.credential(c.id) : {}])).digest('hex');
        for (const [id, cached] of this.testCache) if (cached.expires < Date.now()) this.testCache.delete(id);
        const cached = this.testCache.get(key);
        if (cached) return structuredClone(await cached.result);
        if (this.testCache.size >= 50) throw new UsageError('busy', '测试队列已满 / Test queue full');
        const result = this.testQueue.catch(() => {}).then(() => this.performTest(c, supplied, key));
        const entry = { expires: Infinity, result }; this.testCache.set(key, entry);
        this.testQueue = result.then(() => { entry.expires = Date.now() + 10000; }, () => { entry.expires = Date.now() + 10000; });
        return structuredClone(await result);
    }
    private async performTest(c: UsageConnection, supplied: UsageCredential | undefined, key: string): Promise<QueryResult> {
        if (this.closed) throw new UsageError('cancelled', '查询已取消 / Cancelled');
        // Wait for background work instead of rejecting every click while the scheduler is busy.
        if (this.jobs.has(c.id)) await this.jobs.get(c.id);
        while (this.jobs.size >= 3 || [...this.jobs.keys()].filter(id => this.store.connections.find(x => x.id === id)?.providerId === c.providerId).length >= 2) await Promise.race(this.jobs.values());
        if (this.closed) throw new UsageError('cancelled', '查询已取消 / Cancelled');
        const existing = this.store.connections.find(x => x.id === c.id);
        const blockKey = c.id || key;
        if ((this.blockedUntil.get(blockKey) || 0) > Date.now())
            throw new UsageError('rate-limit', '平台限流，请等待重试时间 / Provider rate limit; wait before retrying', 'rate-limited', this.blockedUntil.get(blockKey));
        const snapshot = this.store.snapshots[c.id];
        if (!Object.keys(supplied || {}).length && existing && JSON.stringify(validateConnection(existing)) === JSON.stringify(c) && snapshot?.state === 'ok' && Date.now() - Date.parse(snapshot.lastSuccessAt || '') < 10000)
            return { metrics: snapshot.metrics, planName: snapshot.planName, mock: snapshot.mock };
        const canReuse = existing && existing.providerId === c.providerId && existing.gateway.baseUrl === c.gateway.baseUrl && existing.accountId === c.accountId && existing.projectId === c.projectId && JSON.stringify(existing.oauth) === JSON.stringify(c.oauth);
        let secret = { ...(canReuse ? this.store.credential(c.id) : {}), ...supplied };
        if (existing?.gateway.modelsBaseUrl !== c.gateway.modelsBaseUrl && !supplied?.modelsApiKey)
            delete secret.modelsApiKey;
        this.testRunning++;
        this.testProvider = c.providerId;
        this.testing.add(c.id);
        this.attempts.set(c.id, Date.now());
        const controller = new AbortController(); this.controllers.set(`test:${key}`, controller);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
        const renew = async () => {
            secret = await this.oauth.refresh(c, secret);
            if (canReuse && !supplied?.accessToken && !supplied?.refreshToken) await this.serial(async () => {
                if (this.store.connections.find(x => x.id === c.id)?.revision === existing.revision && !signal.aborted) {
                    this.store.setCredential(c.id, secret); await this.store.save();
                }
            });
        };
        try {
            let renewed = false;
            if (c.credentialMode === 'oauth-owned' && secret.refreshToken && (!secret.expiresAt || secret.expiresAt < Date.now() + 120000)) { await renew(); renewed = true; }
            let result: QueryResult;
            try { result = await this.query(c, secret, signal); }
            catch (e) {
                if (renewed || c.credentialMode !== 'oauth-owned' || !secret.refreshToken || safeError(e).state !== 'auth-required') throw e;
                await renew(); result = await this.query(c, secret, signal);
            }
            if (result.retryAt) this.blockedUntil.set(blockKey, result.retryAt);
            return result;
        }
        catch (e) {
            const err = safeError(e);
            if (err.retryAt)
                this.blockedUntil.set(blockKey, err.retryAt);
            throw err;
        }
        finally {
            this.testRunning--;
            this.testProvider = undefined;
            this.testing.delete(c.id);
            this.controllers.delete(`test:${key}`);
        }
    }
    refresh(id?: string): void {
        for (const c of this.store.connections) {
            if (id && c.id !== id || !c.enabled)
                continue;
            // A replaced configuration may still have an aborted job unwinding. Queue its refresh
            // instead of losing the user's request. An unchanged active query already fulfills it.
            if (this.jobs.has(c.id) && !this.controllers.get(c.id)?.signal.aborted) continue;
            if ((this.blockedUntil.get(c.id) || 0) > Date.now())
                continue;
            const s = this.store.snapshots[c.id] ||= this.empty(c);
            this.requested.add(c.id);
            s.nextRefreshAt = new Date(Math.max(Date.now(), (this.attempts.get(c.id) || 0) + 10000)).toISOString();
        }
        this.tick();
    }
    private tick(): void {
        if (this.suspended || this.closed)
            return;
        for (const c of this.store.connections) {
            if (this.jobs.size + this.testRunning >= 3)
                break;
            if (!c.enabled || this.jobs.has(c.id) || this.testing.has(c.id) || (this.blockedUntil.get(c.id) || 0) > Date.now())
                continue;
            const s = this.store.snapshots[c.id] ||= this.empty(c);
            if (!s.nextRefreshAt && !s.lastAttemptAt && c.intervalMinutes > 0)
                s.nextRefreshAt = new Date(Date.now() + Math.random() * 15000).toISOString();
            if (!s.nextRefreshAt || Date.parse(s.nextRefreshAt) > Date.now())
                continue;
            if (!this.requested.has(c.id) && ['auth-required', 'forbidden', 'unsupported'].includes(s.state))
                continue;
            const sameProvider = [...this.jobs.keys()].filter(id => this.store.connections.find(x => x.id === id)?.providerId === c.providerId).length + (this.testProvider === c.providerId ? 1 : 0);
            if (sameProvider >= 2)
                continue;
            this.requested.delete(c.id);
            const job = this.run(c).finally(() => { this.jobs.delete(c.id); this.controllers.delete(c.id); });
            this.jobs.set(c.id, job);
        }
    }
    private async run(c: UsageConnection): Promise<void> {
        const controller = new AbortController();
        this.controllers.set(c.id, controller);
        const timeout = setTimeout(() => controller.abort(), 45000);
        const s = this.store.snapshots[c.id] ||= this.empty(c);
        this.attempts.set(c.id, Date.now());
        s.lastAttemptAt = new Date().toISOString();
        s.refreshing = true;
        this.changed();
        const current = () => this.store.snapshots[c.id] === s && !controller.signal.aborted && !this.closed;
        let credential = this.store.credential(c.id);
        const renew = async () => {
            const next = await this.oauth.refresh(c, credential);
            if (!current())
                throw new UsageError('cancelled', '查询取消 / Cancelled');
            await this.serial(async () => { if (!current())
                return; this.store.setCredential(c.id, next); await this.store.save(); });
            credential = next;
        };
        try {
            let renewed = false;
            if (c.credentialMode === 'oauth-owned' && credential.refreshToken && (!credential.expiresAt || credential.expiresAt < Date.now() + 120000)) {
                await renew();
                renewed = true;
            }
            // Backfill older accounts without making profile availability a prerequisite for quota queries.
            if (c.credentialMode === 'oauth-owned' && credential.accessToken && (credential.identity || credential.refreshToken) && !credential.email && Date.now() - (this.identityAttempts.get(c.id) || 0) > 900000) {
                this.identityAttempts.set(c.id, Date.now());
                try {
                    const next = await this.oauth.enrichIdentity(c, credential);
                    await this.serial(async () => { if (current()) { this.store.setCredential(c.id, next); await this.store.save(); credential = next; } });
                } catch (e) { if (safeError(e).code === 'identity-changed') throw e; }
            }
            let result: QueryResult;
            try {
                result = await this.query(c, credential, controller.signal);
            }
            catch (e) {
                if (safeError(e).state !== 'auth-required' || renewed || c.credentialMode !== 'oauth-owned' || !credential.refreshToken)
                    throw e;
                await renew();
                result = await this.query(c, credential, controller.signal);
            }
            if (!current())
                return;
            const old = s.planName === result.planName ? s.metrics.filter(m => result.failedPrefixes?.some(p => m.id.startsWith(p))).map(m => ({ ...m, freshness: 'stale' as const })) : [];
            s.metrics = [...result.metrics, ...old];
            s.planName = result.planName;
            s.mock = result.mock;
            s.state = result.partialError || s.metrics.some(m => m.completeness !== 'complete') ? 'partial' : 'ok';
            s.error = result.partialError;
            s.errorCode = result.retryAt ? 'http-429' : undefined;
            s.retryAt = result.retryAt ? new Date(result.retryAt).toISOString() : undefined;
            if (result.retryAt) this.blockedUntil.set(c.id, result.retryAt);
            s.lastSuccessAt = new Date().toISOString();
            this.failures.delete(c.id);
            let next = c.intervalMinutes ? Date.now() + c.intervalMinutes * 60000 * (0.9 + Math.random() * 0.2) : Infinity;
            for (const m of s.metrics) {
                if (!m.resetsAt || !c.intervalMinutes)
                    continue;
                const key = `${c.id}:${m.id}:${m.resetsAt}`;
                const reset = Date.parse(m.resetsAt);
                if (!this.resetQueries.has(key) && reset <= Date.now()) {
                    this.resetQueries.add(key);
                    next = Math.min(next, Date.now() + 10000);
                }
                else if (!this.resetQueries.has(key))
                    next = Math.min(next, reset + 10000);
            }
            if (result.retryAt && Number.isFinite(next)) next = Math.max(next, result.retryAt);
            s.nextRefreshAt = Number.isFinite(next) ? new Date(next).toISOString() : null;
        }
        catch (e) {
            if (this.store.snapshots[c.id] !== s || this.closed)
                return;
            const err = controller.signal.aborted ? new UsageError('timeout', '查询超时 / Query timed out') : safeError(e);
            s.state = err.state;
            s.error = err.message;
            s.errorCode = err.code;
            s.metrics.forEach(m => m.freshness = 'stale');
            const failures = (this.failures.get(c.id) || 0) + 1;
            this.failures.set(c.id, failures);
            const retry = err.retryAt || Date.now() + [1, 2, 5, 15, 30][Math.min(failures - 1, 4)] * 60000;
            if (err.retryAt)
                this.blockedUntil.set(c.id, retry);
            s.retryAt = err.retryAt ? new Date(err.retryAt).toISOString() : undefined;
            s.nextRefreshAt = !['auth-required', 'forbidden', 'unsupported'].includes(s.state) && c.intervalMinutes ? new Date(retry).toISOString() : null;
        }
        finally {
            clearTimeout(timeout);
            s.refreshing = false;
            if (this.store.snapshots[c.id] === s && !this.closed) {
                try {
                    await this.serial(() => this.store.save());
                }
                catch {
                    s.error = '缓存保存失败 / Cache could not be saved';
                }
                this.changed();
            }
        }
    }
    suspend(): void { this.suspended = true; for (const c of this.controllers.values())
        c.abort(); }
    resume(): void { this.suspended = false; for (const c of this.store.connections) {
        const s = this.store.snapshots[c.id];
        if (s && c.enabled && c.intervalMinutes)
            s.nextRefreshAt = new Date(Math.max(this.blockedUntil.get(c.id) || 0, Date.now() + Math.random() * 15000)).toISOString();
    } }
    async close(): Promise<void> { this.closed = true; clearInterval(this.timer); this.oauth.close(); for (const c of this.controllers.values())
        c.abort(); await Promise.allSettled([...this.jobs.values(), this.testQueue]); this.testCache.clear(); await this.store.flush(); }
}
