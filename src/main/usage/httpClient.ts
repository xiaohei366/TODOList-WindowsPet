import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { addressClass } from './config';
import { UsageError } from './errors';
export type JsonRequest = {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    allowPrivate?: boolean;
    signal?: AbortSignal;
};
export type RequestJson = (url: string, options?: JsonRequest) => Promise<any>;
let active = 0;
const waiting: Array<() => void> = [];
async function acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (active >= 3)
        await new Promise<void>((resolve, reject) => {
            const enter = () => { signal.removeEventListener('abort', abort); resolve(); };
            const abort = () => { const index = waiting.indexOf(enter); if (index >= 0)
                waiting.splice(index, 1); reject(new UsageError('cancelled', '查询取消 / Cancelled')); };
            waiting.push(enter);
            signal.addEventListener('abort', abort, { once: true });
        });
    else
        active++;
    return () => { const next = waiting.shift(); if (next)
        next();
    else
        active--; };
}
export function retryAfter(value: string | undefined, now = Date.now()): number {
    const seconds = Number(value);
    const at = value && Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value || '');
    return Number.isFinite(at) ? Math.max(now + 1000, at) : now + 60000;
}
// Resolve and pin the validated destination on every request. Redirects are never followed.
export const requestJson: RequestJson = async (address, options = {}) => {
    const timeout = AbortSignal.timeout(15000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const release = await acquire(signal);
    try {
        return await performRequest(address, { ...options, signal });
    }
    finally {
        release();
    }
};
const performRequest: RequestJson = async (address, options = {}) => {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new UsageError('url', '不支持的地址 / Unsupported URL');
    const addresses = await new Promise<Awaited<ReturnType<typeof lookup>>[]>((resolve, reject) => {
        const signal = options.signal!;
        const abort = () => reject(new UsageError('timeout', '请求取消或超时 / Request cancelled or timed out'));
        if (signal.aborted) {
            abort();
            return;
        }
        signal.addEventListener('abort', abort, { once: true });
        lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    if (!addresses.length || addresses.some(a => addressClass(a.address) === 'blocked' || addressClass(a.address) === 'private' && !options.allowPrivate))
        throw new UsageError('destination', '服务地址不允许 / Destination not allowed');
    if (url.protocol === 'http:' && (!options.allowPrivate || addresses.some(a => addressClass(a.address) !== 'private')))
        throw new UsageError('https-required', '外部服务需要 HTTPS / HTTPS required');
    const destination = addresses[0];
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(url, { method: options.method || 'GET', headers: { Accept: 'application/json', ...options.headers }, signal: options.signal,
            family: destination.family,
            lookup: (_hostname, _options, callback) => callback(null, destination.address, destination.family) }, res => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024)
                req.destroy(new UsageError('too-large', '服务响应过大 / Response too large'));
            else
                chunks.push(chunk); });
            res.on('end', () => {
                clearTimeout(timer);
                const status = res.statusCode || 500;
                if (status < 200 || status >= 300) {
                    const state = status === 401 ? 'auth-required' : status === 403 ? 'forbidden' : status === 429 ? 'rate-limited' : status === 404 ? 'unsupported' : 'error';
                    reject(new UsageError(`http-${status}`, `查询返回 HTTP ${status} / Provider HTTP ${status}`, state, status === 429 ? retryAfter(res.headers['retry-after']) : undefined));
                    return;
                }
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (!data || typeof data !== 'object')
                        throw new Error();
                    resolve(data);
                }
                catch {
                    reject(new UsageError('schema', '响应不是有效 JSON / Invalid JSON response', 'unsupported'));
                }
            });
            res.on('error', () => req.destroy(new UsageError('network', '响应读取失败 / Response interrupted')));
        });
        const timer = setTimeout(() => req.destroy(new UsageError('timeout', '请求超时 / Request timed out')), 15000);
        req.on('error', error => { clearTimeout(timer); reject(error instanceof UsageError ? error : new UsageError('network', '无法连接服务 / Unable to connect')); });
        req.end(options.body);
    });
};
