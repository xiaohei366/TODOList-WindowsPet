import { describe, expect, test } from 'vitest';
import type { TodoItem } from '../src/shared/types';
import {
  buildTodoListUnits,
  flattenActiveUnitIds,
  moveTodoRelative,
  moveTodoStep,
  moveTodoUnitRelative
} from '../src/renderer/src/todoOrdering';

function item(id: string, text = id, completed = false, date = '2026-05-11', tag?: string): TodoItem {
  return {
    id,
    date,
    text,
    completed,
    highlighted: false,
    overdue: false,
    sourceLine: 1,
    notes: '',
    deadline: undefined,
    tag,
    subTasks: []
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

  test('groups todos with the same tag as a top-level unit', () => {
    const items = [item('a', 'a', false, '2026-05-11', 'work'), item('b'), item('c', 'c', false, '2026-05-11', 'work')];
    const units = buildTodoListUnits(items);

    expect(units.map((unit) => unit.id)).toEqual(['tag:work', 'todo:b']);
    expect(units[0].type === 'tag-group' ? units[0].items.map((todo) => todo.id) : []).toEqual(['a', 'c']);
  });

  test('moves a tag group as one top-level unit against untagged todos', () => {
    const items = [item('a', 'a', false, '2026-05-11', 'work'), item('b'), item('c', 'c', false, '2026-05-11', 'work')];
    const nextUnits = moveTodoUnitRelative(buildTodoListUnits(items), 'tag:work', 'todo:b', 'after');

    expect(flattenActiveUnitIds(nextUnits)).toEqual(['b', 'a', 'c']);
  });

  test('moves tagged todos only within their tag group', () => {
    const items = [
      item('a', 'a', false, '2026-05-11', 'work'),
      item('b'),
      item('c', 'c', false, '2026-05-11', 'work'),
      item('d', 'd', false, '2026-05-11', 'life')
    ];

    expect(moveTodoStep(items, 'c', 'up').map((todo) => todo.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveTodoRelative(items, 'a', 'd', 'after')).toBe(items);
  });

  test('moves untagged todos across tag groups as top-level units', () => {
    const items = [item('a', 'a', false, '2026-05-11', 'work'), item('b'), item('c', 'c', false, '2026-05-11', 'work')];

    expect(moveTodoStep(items, 'b', 'up').map((todo) => todo.id)).toEqual(['b', 'a', 'c']);
  });
});
