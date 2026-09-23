import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { UsageSnapshot } from '../../shared/usage';

// Keep quota updates separate from the temporary drag order. Pointer capture also works
// outside the small scroll viewport, and the list scrolls while hovering near an edge.
export function useUsageReorder(snapshots: UsageSnapshot[], update: (value: UsageSnapshot[]) => void,
    failed: () => void, capture?: (value: boolean) => void) {
    const scroll = useRef<HTMLDivElement>(null);
    const latest = useRef({ snapshots, update, failed, capture });
    latest.current = { snapshots, update, failed, capture };
    const cleanup = useRef<(() => void) | undefined>(undefined);
    const pending = useRef(false), mounted = useRef(true);
    const [dragging, setDragging] = useState('');
    const [drop, setDrop] = useState<{ id: string; after: boolean }>();
    const [order, setOrder] = useState<string[]>();
    const [saving, setSaving] = useState(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; cleanup.current?.(); }; }, []);

    async function persist(ids: string[]) {
        pending.current = true; setSaving(true); setOrder(ids);
        try { const result = await window.todoPet.usage.reorder(ids); if (mounted.current) latest.current.update(result); }
        catch {
            if (mounted.current) latest.current.failed();
            try { const result = await window.todoPet.usage.list(); if (mounted.current) latest.current.update(result); } catch { /* Keep the last snapshot when storage is unavailable. */ }
        } finally { pending.current = false; if (mounted.current) { setOrder(undefined); setSaving(false); } }
    }
    function start(event: PointerEvent<HTMLElement>, id: string) {
        if (event.button !== 0 || pending.current || latest.current.snapshots.length < 2 || !scroll.current) return;
        if ((event.target as HTMLElement).closest('button:not(.usage-drag-handle),a,input,select')) return;
        cleanup.current?.();
        event.preventDefault();
        const viewport = scroll.current, pointer = event.pointerId, startX = event.clientX, startY = event.clientY;
        const initial = latest.current.snapshots.map(s => s.connectionId);
        let active = false, x = startX, y = startY, frame = 0;
        let target: { id: string; after: boolean } | undefined;
        viewport.setPointerCapture(pointer);
        latest.current.capture?.(true);
        const activate = () => { active = true; setDragging(id); };
        const hold = window.setTimeout(activate, 220);
        const locate = () => {
            const bounds = viewport.getBoundingClientRect();
            if (x < bounds.left - 30 || x > bounds.right + 30) { target = undefined; setDrop(undefined); return; }
            const cards = [...viewport.querySelectorAll<HTMLElement>('[data-usage-id]')];
            const card = cards.find(c => y <= c.getBoundingClientRect().bottom) || cards.at(-1);
            if (!card || card.dataset.usageId === id) { target = undefined; setDrop(undefined); return; }
            const rect = card.getBoundingClientRect();
            target = { id: card.dataset.usageId!, after: y > rect.top + rect.height / 2 };
            setDrop(target);
        };
        const animate = () => {
            if (active) {
                const bounds = viewport.getBoundingClientRect();
                if (x >= bounds.left - 30 && x <= bounds.right + 30) {
                    if (y < bounds.top + 22) viewport.scrollTop -= 5;
                    else if (y > bounds.bottom - 22) viewport.scrollTop += 5;
                }
                locate();
            }
            frame = requestAnimationFrame(animate);
        };
        const move = (e: globalThis.PointerEvent) => {
            if (e.pointerId !== pointer) return;
            x = e.clientX; y = e.clientY;
            if (!active && Math.hypot(x - startX, y - startY) > 5) { clearTimeout(hold); activate(); }
        };
        const stop = () => {
            clearTimeout(hold); cancelAnimationFrame(frame);
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
            window.removeEventListener('keydown', key); viewport.removeEventListener('lostpointercapture', cancel);
            if (viewport.hasPointerCapture(pointer)) viewport.releasePointerCapture(pointer);
            latest.current.capture?.(false); cleanup.current = undefined;
            if (mounted.current) { setDragging(''); setDrop(undefined); }
        };
        const up = (e: globalThis.PointerEvent) => {
            if (e.pointerId !== pointer) return;
            x = e.clientX; y = e.clientY; if (active) locate();
            const destination = active && target; stop();
            if (!destination) return;
            const ids = initial.filter(value => value !== id);
            ids.splice(ids.indexOf(destination.id) + Number(destination.after), 0, id);
            if (ids.some((value, index) => value !== initial[index])) void persist(ids);
        };
        const cancel = () => stop();
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); stop(); } };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
        window.addEventListener('keydown', key); viewport.addEventListener('lostpointercapture', cancel);
        cleanup.current = stop; frame = requestAnimationFrame(animate);
    }
    function step(id: string, delta: number) {
        if (pending.current || dragging) return;
        const ids = latest.current.snapshots.map(s => s.connectionId), index = ids.indexOf(id), destination = index + delta;
        if (index < 0 || destination < 0 || destination >= ids.length) return;
        [ids[index], ids[destination]] = [ids[destination], ids[index]];
        void persist(ids);
    }
    const sorted = order ? [...snapshots].sort((a, b) => order.indexOf(a.connectionId) - order.indexOf(b.connectionId)) : snapshots;
    return { scroll, start, step, dragging, drop, saving, sorted };
}
