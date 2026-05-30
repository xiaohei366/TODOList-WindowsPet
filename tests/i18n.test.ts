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
    expect(t('zh-CN', 'menu.exportTodoMarkdown')).toBe('导出 TODO 项');
    expect(t('zh-CN', 'menu.importScheduledJson')).toBe('导入定时任务');
    expect(t('en-US', 'menu.exportTodoMarkdown')).toBe('Export TODO Items');
    expect(t('en-US', 'menu.importScheduledJson')).toBe('Import Scheduled Tasks');
    expect(t('zh-CN', 'todo.completedToday', { count: 3 })).toBe('今日已完成 3 个任务');
    expect(t('en-US', 'todo.completedToday', { count: 3 })).toBe('3 tasks completed today');
  });
});
