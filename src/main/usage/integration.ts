import { app, BrowserWindow, ipcMain, powerMonitor, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { UsageStore } from './store';
import { UsageService } from './service';
import { UsageSettingsServer } from './settingsServer';
import { safeError } from './errors';
import type { AppLanguage } from '../../shared/i18n';
export async function startUsage(getWindow: () => BrowserWindow | undefined, getLanguage: () => AppLanguage): Promise<() => Promise<void>> {
    const service = new UsageService(new UsageStore(join(app.getPath('appData'), 'TOList', 'usage'), {
        available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value)
    }), () => { const w = getWindow(); if (w && !w.isDestroyed())
        w.webContents.send('usage:changed', service.snapshots()); });
    let failure: string | undefined;
    try {
        await service.init();
    }
    catch (e) {
        failure = safeError(e).message;
    }
    const settings = new UsageSettingsServer(service, url => shell.openExternal(url));
    const ready = () => { if (failure)
        throw new Error(failure); };
    ipcMain.handle('usage:list', () => { ready(); return service.snapshots(); });
    ipcMain.handle('usage:reorder', (_event, ids: unknown) => { ready(); return service.reorder(ids); });
    ipcMain.handle('usage:enable', (_event, id: string) => { ready(); return service.enable(id); });
    ipcMain.handle('usage:refresh', (_event, id?: string) => { ready(); service.refresh(typeof id === 'string' ? id : undefined); });
    let starting: Promise<void> | undefined;
    ipcMain.handle('usage:openSettings', async () => {
        ready();
        starting ||= settings.start().catch(e => { starting = undefined; throw e; });
        await starting;
        await shell.openExternal(settings.url(getLanguage()));
    });
    const suspend = () => service.suspend(), resume = () => service.resume();
    powerMonitor.on('suspend', suspend);
    powerMonitor.on('resume', resume);
    return async () => { powerMonitor.removeListener('suspend', suspend); powerMonitor.removeListener('resume', resume); await settings.close(); await service.close(); };
}
