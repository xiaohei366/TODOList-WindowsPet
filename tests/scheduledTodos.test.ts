import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ScheduledTodoStore, runDueScheduledTodos } from '../src/main/scheduledTodos';

describe('scheduled TODOs', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tolist-schedules-'));
    file = join(dir, 'scheduled-todos.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('creates a weekly rule and generates it once for the matching local day and time', async () => {
    const now = new Date(2026, 4, 11, 9, 30);
    const store = new ScheduledTodoStore(file, () => now);
    await store.create({
      kind: 'weekly',
      enabled: true,
      text: 'Daily problem',
      hour: 9,
      minute: 30,
      weekdays: [1, 2, 3, 4, 5]
    });
    const added: string[] = [];

    await expect(runDueScheduledTodos(store, { add: async (text) => added.push(text) }, now)).resolves.toBe(1);
    await expect(runDueScheduledTodos(store, { add: async (text) => added.push(text) }, now)).resolves.toBe(0);

    expect(added).toEqual(['Daily problem']);
    expect((await store.list())[0]).toMatchObject({ lastGeneratedDate: '2026-05-11' });
  });

  test('fires a one-time rule once and marks it fired', async () => {
    const now = new Date(2026, 4, 13, 15, 45);
    const store = new ScheduledTodoStore(file, () => now);
    await store.create({
      kind: 'one-time',
      enabled: true,
      text: 'Submit report',
      hour: 15,
      minute: 30,
      year: 2026,
      month: 5,
      day: 13
    });
    const added: string[] = [];

    await expect(runDueScheduledTodos(store, { add: async (text) => added.push(text) }, now)).resolves.toBe(1);
    await expect(runDueScheduledTodos(store, { add: async (text) => added.push(text) }, now)).resolves.toBe(0);

    expect(added).toEqual(['Submit report']);
    expect((await store.list())[0]).toMatchObject({ fired: true, lastGeneratedDate: '2026-05-13' });
  });

  test('does not backfill missed weekly runs before today', async () => {
    const now = new Date(2026, 4, 12, 10, 0);
    const store = new ScheduledTodoStore(file, () => now);
    await store.create({
      kind: 'weekly',
      enabled: true,
      text: 'Read news',
      hour: 9,
      minute: 0,
      weekdays: [1]
    });
    const added: string[] = [];

    await expect(runDueScheduledTodos(store, { add: async (text) => added.push(text) }, now)).resolves.toBe(0);

    expect(added).toEqual([]);
    expect((await store.list())[0]).not.toHaveProperty('lastGeneratedDate');
  });

  test('merges imported scheduled JSON by newer id and semantic duplicates', async () => {
    const store = new ScheduledTodoStore(file, () => new Date(2026, 4, 11, 9, 0));
    const existing = await store.create({
      kind: 'weekly',
      enabled: true,
      text: 'Daily problem',
      hour: 9,
      minute: 0,
      weekdays: [1, 2, 3, 4, 5]
    });
    const importFile = join(dir, 'import.json');
    await writeFile(
      importFile,
      JSON.stringify({
        version: 1,
        rules: [
          { ...existing, text: 'Daily problem updated', updatedAt: '2026-05-12T00:00:00.000Z' },
          { ...existing, id: 'duplicate-id', createdAt: '2026-05-13T00:00:00.000Z', updatedAt: '2026-05-13T00:00:00.000Z' },
          {
            id: 'future-id',
            kind: 'one-time',
            enabled: true,
            text: 'Future task',
            hour: 12,
            minute: 15,
            date: '2026-05-20',
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z'
          }
        ]
      }),
      'utf8'
    );

    const result = await store.importJson(importFile);

    expect(result).toEqual({ added: 1, updated: 1, skipped: 1 });
    expect((await store.list()).map((rule) => rule.text)).toEqual(['Daily problem updated', 'Future task']);
  });

  test('rejects rules without required text or time', async () => {
    const store = new ScheduledTodoStore(file, () => new Date(2026, 4, 11, 9, 0));

    await expect(
      store.create({ kind: 'weekly', enabled: true, text: '', hour: 9, minute: 0, weekdays: [1] })
    ).rejects.toThrow('Schedule text is required.');
    await expect(
      store.create({ kind: 'weekly', enabled: true, text: 'Task', hour: undefined, minute: 0, weekdays: [1] })
    ).rejects.toThrow('Schedule time is required.');
    await expect(
      store.create({ kind: 'weekly', enabled: true, text: 'Task', hour: 24, minute: 0, weekdays: [1] })
    ).rejects.toThrow('Hour must be 0-23.');
    await expect(
      store.create({ kind: 'weekly', enabled: true, text: 'Task', hour: 23, minute: 60, weekdays: [1] })
    ).rejects.toThrow('Minute must be 0-59.');
    await expect(
      store.create({
        kind: 'one-time',
        enabled: true,
        text: 'Bad date',
        hour: 9,
        minute: 0,
        year: 2026,
        month: 2,
        day: 29
      })
    ).rejects.toThrow('Schedule date is required.');
  });

  test('exports an empty valid JSON document when no rules exist', async () => {
    const store = new ScheduledTodoStore(file, () => new Date(2026, 4, 11, 9, 0));
    const exportFile = join(dir, 'export.json');

    await store.exportJson(exportFile);

    expect(JSON.parse(await readFile(exportFile, 'utf8'))).toEqual({ version: 1, rules: [] });
  });
});
