import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { TodoMarkdownStore, formatDateKey, selectVisibleTodos } from '../src/main/todoStore';

describe('TodoMarkdownStore', () => {
  let dir: string;
  let file: string;
  const today = new Date(2026, 4, 11);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tolist-todos-'));
    file = join(dir, 'todos.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('adds a first item into a human-readable year month day markdown section', async () => {
    const store = new TodoMarkdownStore(file, () => today);

    const item = await store.add('Review PR');

    expect(item).toMatchObject({
      date: '2026-05-11',
      text: 'Review PR',
      completed: false,
      highlighted: false,
      overdue: false
    });
    await expect(readFile(file, 'utf8')).resolves.toBe(
      '# 2026\n\n## 2026-05\n\n### 2026-05-11 Monday\n\n- [ ] Review PR\n'
    );
  });

  test('parses highlighted completed items and selects overdue plus today items', async () => {
    await writeFile(
      file,
      [
        '# 2026',
        '',
        '## 2026-05',
        '',
        '### 2026-05-10 Sunday',
        '',
        '- [ ] [!] Pay bill',
        '- [x] ~~Old done~~',
        '',
        '### 2026-05-11 Monday',
        '',
        '- [ ] Write tests',
        '- [x] ~~Ship build~~',
        ''
      ].join('\n'),
      'utf8'
    );
    const store = new TodoMarkdownStore(file, () => today);

    const items = await store.listAll();
    const visible = selectVisibleTodos(items, formatDateKey(today));

    expect(visible.map((item) => item.text)).toEqual(['Pay bill', 'Write tests', 'Ship build']);
    expect(visible[0]).toMatchObject({ highlighted: true, overdue: true, completed: false });
    expect(visible[2]).toMatchObject({ completed: true, overdue: false });
  });

  test('marks an item complete with strikethrough and moves it to the end of its day', async () => {
    const store = new TodoMarkdownStore(file, () => today);
    const first = await store.add('First');
    await store.add('Second');

    await store.setCompleted(first.id, true);

    await expect(readFile(file, 'utf8')).resolves.toContain(
      '### 2026-05-11 Monday\n\n- [ ] Second\n- [x] ~~First~~\n'
    );
  });

  test('toggles highlighted marker without losing completion state', async () => {
    const store = new TodoMarkdownStore(file, () => today);
    const item = await store.add('Important');
    const completed = await store.setCompleted(item.id, true);

    await store.setHighlighted(completed.id, true);

    await expect(readFile(file, 'utf8')).resolves.toContain('- [x] [!] ~~Important~~');
  });

  test('reorders only active items within one day and keeps completed items last', async () => {
    const store = new TodoMarkdownStore(file, () => today);
    const first = await store.add('First');
    const second = await store.add('Second');
    const third = await store.add('Third');
    await store.setCompleted(second.id, true);
    const active = (await store.list()).filter((item) => !item.completed);

    await store.reorder('2026-05-11', [active.find((item) => item.text === 'Third')!.id, first.id]);

    const content = await readFile(file, 'utf8');
    expect(content).toContain('- [ ] Third\n- [ ] First\n- [x] ~~Second~~');
    expect((await store.list()).map((item) => item.text)).toEqual(['Third', 'First', 'Second']);
  });

  test('deletes a todo by removing the markdown line', async () => {
    const store = new TodoMarkdownStore(file, () => today);
    const item = await store.add('Remove me');
    await store.add('Keep me');

    await store.delete(item.id);

    const content = await readFile(file, 'utf8');
    expect(content).not.toContain('Remove me');
    expect(content).toContain('Keep me');
  });
});
