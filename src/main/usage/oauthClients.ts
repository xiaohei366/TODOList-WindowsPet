import type { UsageProvider } from '../../shared/usage';
// Desktop OAuth application credential distributed by the reference Antigravity client.
// This identifies the installed application; it is not a user token or a confidential server secret.
// Keep it in the main process, out of settings responses and browser assets.
const antigravityDesktopSecret = "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";
export function builtinClientSecret(provider: UsageProvider): string | undefined {
    return provider === 'antigravity' ? antigravityDesktopSecret : undefined;
}
