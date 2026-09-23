import type { UsageState } from '../../shared/usage';
export class UsageError extends Error {
    constructor(public code: string, message: string, public state: UsageState = 'error', public retryAt?: number) { super(message); }
}
export function safeError(error: unknown): UsageError {
    return error instanceof UsageError ? error : new UsageError('network', '网络或本机服务异常，请重试 / Network or local service error');
}
export function invalid(message: string): never { throw new UsageError('invalid-config', message); }
