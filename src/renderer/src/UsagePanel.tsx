import { RefreshCw, Settings, X, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import type { AppLanguage } from '../../shared/i18n';
import type { UsageMetric, UsageSnapshot } from '../../shared/usage';
import { featuredMetric, remainingPercent } from '../../shared/usageDisplay';
import { useUsageReorder } from './useUsageReorder';
import './usage.css';

export function UsagePanel({ language, scale, onClose, onCapture }: { language: AppLanguage; scale: number; onClose(): void; onCapture?(captured: boolean): void }): ReactElement {
    const [snapshots, setSnapshots] = useState<UsageSnapshot[]>([]), [error, setError] = useState('');
    const [now, setNow] = useState(Date.now()), [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [busyUntil, setBusyUntil] = useState(0);
    const tr = (zh: string, en: string) => language === 'zh-CN' ? zh : en;
    const sorting = useUsageReorder(snapshots, setSnapshots, () => setError(tr('排序保存失败，已重新载入账号列表。', 'Order could not be saved. Accounts reloaded.')), onCapture);
    const run = async (fn: () => Promise<unknown>) => { try { setError(''); await fn(); } catch { setError(tr('操作失败，请重试或打开设置。', 'Request failed. Retry or open settings.')); } };
    useEffect(() => {
        let alive = true;
        void window.todoPet.usage.list().then(s => { if (alive) setSnapshots(s); }).catch(() => { if (alive) setError('用量配置无法读取 / Usage storage unavailable'); });
        const off = window.todoPet.usage.onChanged(setSnapshots);
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => { alive = false; off(); clearInterval(timer); };
    }, []);
    const settings = () => void run(() => window.todoPet.usage.openSettings());
    const status: Record<string, string> = { unconfigured: tr('未查询', 'Not queried'), ok: '', partial: tr('部分可用', 'Partial'), 'auth-required': tr('需登录', 'Sign in'), forbidden: tr('无权限', 'Denied'), unsupported: tr('不兼容', 'Unsupported'), 'rate-limited': tr('限流', 'Limited'), error: tr('失败', 'Failed'), paused: tr('暂停', 'Paused') };
    const date = (v: string | null) => v ? new Date(v).toLocaleString(language) : tr('未知', 'Unknown');
    const countdown = (v: string) => {
        const seconds = Math.ceil((Date.parse(v) - now) / 1000);
        if (seconds <= 0) return tr('等待更新', 'Awaiting update');
        if (seconds >= 86400) return Math.floor(seconds / 86400) + 'd ' + Math.floor(seconds % 86400 / 3600) + 'h';
        if (seconds >= 3600) return Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm';
        return Math.max(1, Math.ceil(seconds / 60)) + 'm';
    };
    const value = (m: UsageMetric) => {
        if (m.unlimited) return tr('不限量', 'Unlimited');
        const pct = remainingPercent(m);
        if (pct !== null) return Number(pct.toFixed(1)) + '%';
        const amount = m.remaining ?? m.used;
        if (amount === null) return '—';
        return (m.remaining === null ? tr('已用 ', 'Used ') : '') + Number(amount).toLocaleString(language, { maximumFractionDigits: 2 }) + ' ' + (m.currency || m.unit);
    };
    const metric = (m: UsageMetric, s: UsageSnapshot, detail = false) => {
        const stale = m.freshness === 'stale' || now - Date.parse(m.observedAt) > (s.staleAfterMs || 600000), pct = remainingPercent(m);
        const info = [m.resetsAt ? tr('恢复 ', 'Resets ') + countdown(m.resetsAt) : m.expiresAt ? tr('到期 ', 'Expires ') + date(m.expiresAt) : tr('恢复时间未知', 'Reset unknown'), stale ? tr('缓存', 'Cached') : '', m.authority !== 'provider' ? tr('自设/估算', 'Estimate') : '', m.completeness !== 'complete' ? tr('不完整', 'Partial') : ''].filter(Boolean).join(' · ');
        return <div className={'usage-metric' + (detail ? ' usage-detail' : '') + (stale ? ' stale' : '')} key={m.id} title={[m.label, m.remaining !== null ? tr('剩余 ', 'Remaining ') + m.remaining + ' ' + (m.currency || m.unit) : '', m.resetsAt ? date(m.resetsAt) : '', m.expiresAt ? tr('到期 ', 'Expires ') + date(m.expiresAt) : '', m.note || ''].filter(Boolean).join('\n')}>
            <div className="usage-metric-title"><span>{m.label}</span><strong aria-label={tr('剩余额度', 'Remaining quota')}>{value(m)}</strong></div>
            {pct !== null && <progress aria-label={tr('剩余百分比', 'Remaining percentage')} className={pct <= 10 ? 'low' : ''} max={100} value={pct}/>}
            <div className="usage-time">{info}</div>
        </div>;
    };
    const bottom = 38 + 104 * scale + 8;
    return <section className="usage-panel" style={{ bottom, '--usage-scale': scale, maxHeight: Math.max(90, (window.innerHeight - bottom - 16) / scale) } as CSSProperties} aria-label={tr('AI 用量', 'AI Usage')}>
        <header className="usage-header"><strong>{tr('AI 用量', 'AI Usage')}</strong><div className="usage-actions">
            <button aria-label={tr('刷新全部', 'Refresh all')} title={tr('刷新全部', 'Refresh all')} disabled={now < busyUntil || snapshots.some(s => s.refreshing)} onClick={() => { setBusyUntil(Date.now() + 10000); void run(() => window.todoPet.usage.refresh()); }}><RefreshCw size={13}/></button>
            <button aria-label={tr('配置 AI 账号', 'Configure AI accounts')} title={tr('配置 AI 账号', 'Configure AI accounts')} onClick={settings}><Settings size={14}/></button>
            <button aria-label={tr('关闭', 'Close')} onClick={onClose}><X size={14}/></button>
        </div></header>
        <div className="usage-scroll" ref={sorting.scroll} aria-busy={sorting.saving}>
            {error && <p className="usage-error" role="alert">{error}</p>}
            {!snapshots.length && !error && <div className="usage-empty"><button onClick={settings}>{tr('添加 AI 账号', 'Add AI account')}</button></div>}
            {sorting.sorted.map(s => {
                const main = featuredMetric(s), open = expanded.has(s.connectionId);
                const identity = [s.providerId === 'codex' ? 'Codex' : s.providerId === 'antigravity' ? 'Antigravity' : tr('网关', 'Gateway'), s.account?.email || s.account?.name || s.account?.subject?.slice(-8) || s.connectionId.slice(-8)].join(' · ');
                return <article className={'usage-account' + (sorting.dragging === s.connectionId ? ' usage-dragging' : '') + (sorting.drop?.id === s.connectionId ? sorting.drop.after ? ' usage-drop-after' : ' usage-drop-before' : '')} data-usage-id={s.connectionId} key={s.connectionId}>
                    <div className="usage-summary" onPointerDown={e => sorting.start(e, s.connectionId)}>
                        <button className="usage-drag-handle" disabled={sorting.saving || snapshots.length < 2} aria-label={tr('拖动排序 ', 'Reorder ') + s.displayName} title={tr('拖动调整位置；也可使用上下方向键', 'Drag to reorder, or use the up/down arrow keys')} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); sorting.step(s.connectionId, e.key === 'ArrowUp' ? -1 : 1); } }}><GripVertical size={11}/></button>
                        <div className="usage-account-title"><strong title={[s.displayName, identity, s.account?.workspaceId || '', s.planName || ''].join('\n')}>{s.displayName}</strong><span title={s.error || date(s.lastSuccessAt)}>{s.mock ? 'DEMO ' : ''}{s.refreshing ? tr('刷新中', 'Refreshing') : status[s.state]}</span><button className="usage-expand" aria-expanded={open} aria-controls={'usage-details-' + s.connectionId} aria-label={(open ? tr('收起 ', 'Collapse ') : tr('展开 ', 'Expand ')) + s.displayName} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(s.connectionId)) next.delete(s.connectionId); else next.add(s.connectionId); return next; })}>{open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}<span>{open ? tr('收起', 'Less') : tr('展开', 'More')}</span></button></div>
                        <div className="usage-identity" title={identity + (s.account?.workspaceId ? ' · ' + s.account.workspaceId : '')}>{identity}{s.account?.workspaceId ? ' · ' + s.account.workspaceId : ''}</div>
                        {s.state === 'paused' && <button className="usage-resume" onClick={() => void run(() => window.todoPet.usage.enable(s.connectionId))}>{tr('恢复并刷新', 'Resume and refresh')}</button>}
                        {main ? metric(main, s) : <button className="usage-missing" onClick={settings}>{tr('暂无用量 · 设置', 'No usage · Settings')}</button>}
                    </div>
                    {open && <div className="usage-details" id={'usage-details-' + s.connectionId}>
                        {s.error && <p className="usage-error">{s.error} <button onClick={settings}>{tr('设置', 'Settings')}</button></p>}
                        {s.retryAt && Date.parse(s.retryAt) > now && <small>{tr('等待重试', 'Retry in')} · {countdown(s.retryAt)}</small>}
                        {s.metrics.map(m => metric(m, s, true))}
                        <footer>{s.planName ? s.planName + ' · ' : ''}{tr('更新', 'Updated')} {date(s.lastSuccessAt)}</footer>
                    </div>}
                </article>;
            })}
        </div>
    </section>;
}
