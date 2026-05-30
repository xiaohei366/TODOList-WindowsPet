import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type AppLanguage, defaultLanguage, normalizeLanguage } from '../shared/i18n';

type AppSettingsDocument = {
  language?: AppLanguage;
};

export class AppSettingsStore {
  constructor(private readonly filePath: string) {}

  async getLanguage(): Promise<AppLanguage> {
    return normalizeLanguage((await this.readSettings()).language);
  }

  async setLanguage(language: AppLanguage): Promise<AppLanguage> {
    const normalized = normalizeLanguage(language);
    await this.writeSettings({ ...(await this.readSettings()), language: normalized });
    return normalized;
  }

  private async readSettings(): Promise<AppSettingsDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as AppSettingsDocument;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { language: defaultLanguage };
      }
      return { language: defaultLanguage };
    }
  }

  private async writeSettings(settings: AppSettingsDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }
}
