import { describe, expect, test } from 'vitest';
import { defaultLanguage, languageOptions, normalizeLanguage, t } from '../src/shared/i18n';

describe('i18n helpers', () => {
  test('normalizes supported languages and falls back to Chinese', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguage('en-US')).toBe('en-US');
    expect(normalizeLanguage('bad')).toBe(defaultLanguage);
    expect(normalizeLanguage(undefined)).toBe(defaultLanguage);
  });

  test('exposes Chinese and English language options', () => {
    expect(languageOptions).toEqual([
      { language: 'zh-CN', label: '中文' },
      { language: 'en-US', label: 'English' }
    ]);
  });

  test('translates native and renderer labels', () => {
    expect(t('zh-CN', 'menu.language')).toBe('语言');
    expect(t('en-US', 'menu.language')).toBe('Language');
    expect(t('zh-CN', 'menu.exportData')).toBe('导出数据');
    expect(t('zh-CN', 'menu.importData')).toBe('导入数据');
    expect(t('zh-CN', 'menu.openMarkdown')).toBe('打开存储数据的原始文件');
    expect(t('en-US', 'menu.exportData')).toBe('Export Data');
    expect(t('en-US', 'menu.importData')).toBe('Import Data');
    expect(t('en-US', 'menu.openMarkdown')).toBe('Open Raw Data File');
    expect(t('zh-CN', 'todo.completedToday', { count: 3 })).toBe('今日已完成 3 个任务');
    expect(t('en-US', 'todo.completedToday', { count: 3 })).toBe('3 tasks completed today');
  });
});
