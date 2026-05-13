import { describe, expect, test } from 'vitest';
import type { TodoItem } from '../src/shared/types';
import { moveTodoRelative, moveTodoStep } from '../src/renderer/src/todoOrdering';

function item(id: string, text = id, completed = false, date = '2026-05-11'): TodoItem {
  return {
    id,
    date,
    text,
    completed,
    highlighted: false,
    overdue: false,
    sourceLine: 1
  };
}

describe('todoOrdering', () => {
  test('moves a todo one step down without crossing completed todos', () => {
    const items = [item('a'), item('b'), item('c'), item('done', 'done', true)];

    expect(moveTodoStep(items, 'b', 'down').map((todo) => todo.id)).toEqual(['a', 'c', 'b', 'done']);
  });

  test('moves a todo one step up within active todos', () => {
    const items = [item('a'), item('b'), item('c')];

    expect(moveTodoStep(items, 'b', 'up').map((todo) => todo.id)).toEqual(['b', 'a', 'c']);
  });

  test('can drag a todo after the last active todo', () => {
    const items = [item('a'), item('b'), item('c'), item('done', 'done', true)];

    expect(moveTodoRelative(items, 'a', 'c', 'after').map((todo) => todo.id)).toEqual(['b', 'c', 'a', 'done']);
  });

  test('does not reorder completed todos through priority helpers', () => {
    const items = [item('a'), item('done', 'done', true), item('b')];

    expect(moveTodoStep(items, 'done', 'up')).toBe(items);
    expect(moveTodoRelative(items, 'a', 'done', 'after')).toBe(items);
  });

  test('moves visible active todos across different dates', () => {
    const items = [item('old', 'old', false, '2026-05-12'), item('today', 'today', false, '2026-05-13')];

    expect(moveTodoStep(items, 'today', 'up').map((todo) => todo.id)).toEqual(['today', 'old']);
    expect(moveTodoRelative(items, 'today', 'old', 'after').map((todo) => todo.id)).toEqual(['old', 'today']);
  });
});
