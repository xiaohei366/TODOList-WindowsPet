import { describe, expect, it } from 'vitest';
import { featuredMetric, remainingPercent } from '../src/shared/usageDisplay';
import type { UsageSnapshot } from '../src/shared/usage';
import { defaultConnection } from '../src/shared/usage';
import { metric } from '../src/main/usage/normalize';
import { queryUsage } from '../src/main/usage/adapters';
import { validateConnection } from '../src/main/usage/config';
import { UsageError } from '../src/main/usage/errors';

const snapshot = (metrics: UsageSnapshot['metrics'], extra: Partial<UsageSnapshot> = {}) => ({ providerId: 'codex', metrics, ...extra }) as UsageSnapshot;
describe('compact quota summary', () => {
    it('chooses the lowest remaining percentage and updates as the windows change', () => {
        const daily = metric('daily', 'Daily', { remainingPercent: 80 }), weekly = metric('weekly', 'Weekly', { remainingPercent: 20 });
        expect(featuredMetric(snapshot([daily, weekly]))?.id).toBe('weekly');
        expect(featuredMetric(snapshot([{ ...daily, remainingPercent: 0 }, weekly]))?.id).toBe('daily');
    });
    it('derives comparable budget percentages but never compares raw dollars with credits', () => {
        const small = metric('usd', 'USD', { kind: 'balance', unit: 'currency', currency: 'USD', remaining: '5' });
        const budget = metric('credit', 'Credit', { kind: 'budget', unit: 'credit', remaining: '10', limit: '100' });
        expect(featuredMetric(snapshot([small, budget], { providerId: 'personal-gateway' }))?.id).toBe('credit');
        expect(remainingPercent(small)).toBeNull();
        expect(remainingPercent({ ...budget, remaining: null, used: '75' })).toBe(25);
        expect(remainingPercent({ ...budget, unlimited: true })).toBeNull();
        expect(remainingPercent({ ...budget, remainingPercent: NaN, remaining: '0', limit: '0' })).toBeNull();
    });
    it('honors the Antigravity selection and does not silently substitute a missing model', () => {
        const metrics = [metric('pool:one', 'Pool'), metric('model:a', 'A', { remainingPercent: 1 }), metric('model:b', 'B', { remainingPercent: 90 })];
        expect(featuredMetric(snapshot(metrics, { providerId: 'antigravity' }))?.id).toBe('model:a');
        expect(featuredMetric(snapshot(metrics, { providerId: 'antigravity', featuredMetricId: 'model:b' }))?.id).toBe('model:b');
        expect(featuredMetric(snapshot(metrics, { providerId: 'antigravity', featuredMetricId: 'model:gone' }))).toBeUndefined();
    });
});
describe('multiple gateway periods', () => {
    it('queries each selected window with a separate budget and reset time', async () => {
        const c = defaultConnection(); c.gateway.baseUrl = 'https://gateway.example.test';
        c.gateway.periods = [{ period: 'today', budget: 10 }, { period: 'week', budget: 20 }, { period: 'month', budget: 100 }];
        const windows: string[] = [];
        const result = await queryUsage(c, { apiKey: 'fixture' }, new AbortController().signal, async url => {
            if (url.includes('/models')) return { data: [{ id: 'model', credit: 1 }] };
            windows.push(new URL(url).searchParams.get('window')!);
            if (url.includes('by-model')) return { data: [{ model: 'model', total_tokens: 5000000 }] };
            return { data: { total_tokens: 5000000 } };
        });
        expect(new Set(windows)).toEqual(new Set(['today','week','month']));
        expect(result.metrics.map(m => m.id)).toEqual(['today:tokens','today:budget','week:tokens','week:budget','month:tokens','month:budget']);
        expect(result.metrics.filter(m => m.kind === 'budget').map(m => m.remainingPercent)).toEqual([50,75,95]);
        expect(result.metrics.filter(m => m.kind === 'budget').every(m => !!m.resetsAt)).toBe(true);
        expect(featuredMetric(snapshot(result.metrics, { providerId: 'personal-gateway' }))?.id).toBe('today:budget');
    });
    it('keeps successful windows and marks failed window prefixes for stale-cache retention', async () => {
        const c = defaultConnection(); c.gateway.baseUrl = 'https://gateway.example.test'; c.gateway.periods = [{ period:'today' }, { period:'week' }];
        const retryAt = Date.now() + 60000;
        const result = await queryUsage(c, { apiKey: 'fixture' }, new AbortController().signal, async url => {
            if (url.includes('week')) throw new UsageError('http-429','limited','rate-limited',retryAt);
            return { data: { total_tokens: 123 } };
        });
        expect(result).toMatchObject({ retryAt, failedPrefixes: ['week:'], metrics: [{ id:'today:tokens', used:'123' }] });
    });
    it('preserves legacy single-period config and validates duplicate periods and budgets', () => {
        const c = defaultConnection(); c.gateway.baseUrl = 'https://gateway.example.test'; c.gateway.period = 'week'; c.gateway.budget = 9;
        expect(validateConnection(c).gateway).toMatchObject({ period: 'week', budget: 9 });
        expect(() => validateConnection({ ...c, gateway: { ...c.gateway, periods: [{ period: 'week' }, { period: 'week' }] } })).toThrow();
        expect(() => validateConnection({ ...c, gateway: { ...c.gateway, periods: [{ period: 'month', budget: -1 }] } })).toThrow();
    });
});
