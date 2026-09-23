import type { UsageMetric, UsageSnapshot } from './usage';

export function remainingPercent(metric: UsageMetric): number | null {
    if (metric.unlimited) return null;
    if (metric.remainingPercent !== null && Number.isFinite(metric.remainingPercent)) return metric.remainingPercent;
    const limit = metric.limit === null ? NaN : Number(metric.limit);
    const left = metric.remaining !== null ? Number(metric.remaining) : metric.used !== null ? limit - Number(metric.used) : NaN;
    return limit > 0 && Number.isFinite(left) ? Math.max(0, Math.min(100, left / limit * 100)) : null;
}

/** Compare percentages, never dollars against tokens or credits. Unknown quota stays unknown. */
export function featuredMetric(snapshot: UsageSnapshot): UsageMetric | undefined {
    if (snapshot.providerId === 'antigravity') {
        if (snapshot.featuredMetricId) return snapshot.metrics.find(m => m.id === snapshot.featuredMetricId);
        return snapshot.metrics.find(m => m.id.startsWith('model:')) || snapshot.metrics[0];
    }
    const quotas = snapshot.metrics.filter(m => ['quota', 'budget', 'balance'].includes(m.kind));
    const comparable = quotas.filter(m => remainingPercent(m) !== null);
    if (comparable.length) return comparable.reduce((lowest, m) => remainingPercent(m)! < remainingPercent(lowest)! ? m : lowest);
    return quotas.find(m => !m.unlimited && m.remaining !== null) || quotas[0] || snapshot.metrics[0];
}
