import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AppSettingsStore } from '../src/main/appSettings';

describe('AppSettingsStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tolist-settings-'));
    file = join(dir, 'settings.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('defaults to Chinese when no settings file exists', async () => {
    const store = new AppSettingsStore(file);

    await expect(store.getLanguage()).resolves.toBe('zh-CN');
  });

  test('persists the selected language', async () => {
    const store = new AppSettingsStore(file);

    await store.setLanguage('en-US');

    await expect(store.getLanguage()).resolves.toBe('en-US');
    await expect(readFile(file, 'utf8')).resolves.toContain('"language": "en-US"');
  });

  test('falls back to Chinese for invalid stored language', async () => {
    await writeFile(file, JSON.stringify({ language: 'fr-FR' }), 'utf8');
    const store = new AppSettingsStore(file);

    await expect(store.getLanguage()).resolves.toBe('zh-CN');
  });
});
