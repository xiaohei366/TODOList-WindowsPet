import { describe, expect, test } from 'vitest';
import type { TodoItem, TodoSubTask } from '../src/shared/types';
import { countCompletedToday, formatLocalDateKey, getNextLocalDayRefreshDelay } from '../src/renderer/src/todoStats';

function item(id: string, date: string, completed: boolean, completedDate?: string, subTasks: TodoSubTask[] = []): TodoItem {
  return {
    id,
    date,
    text: id,
    completed,
    completedDate,
    highlighted: false,
    overdue: false,
    sourceLine: 1,
    notes: '',
    deadline: undefined,
    subTasks
  };
}

function subTask(id: string, completed: boolean, completedDate?: string): TodoSubTask {
  return { id, text: id, completed, completedDate };
}

describe('todoStats helpers', () => {
  test('formats a local date key for today comparisons', () => {
    expect(formatLocalDateKey(new Date(2026, 4, 12))).toBe('2026-05-12');
  });

  test('counts completed todos finished today even when created earlier', () => {
    const items = [
      item('done-today', '2026-05-12', true),
      item('active-today', '2026-05-12', false),
      item('done-yesterday', '2026-05-11', true),
      item('legacy-done-today', '2026-05-10', true, '2026-05-12')
    ];

    expect(countCompletedToday(items, '2026-05-12')).toBe(2);
  });

  test('counts completed sub-tasks finished today in addition to parent todos', () => {
    const items = [
      item('parent-done', '2026-05-12', true, '2026-05-12', [
        subTask('sub-earlier', true, '2026-05-11'),
        subTask('sub-today', true, '2026-05-12')
      ]),
      item('parent-active', '2026-05-12', false, undefined, [
        subTask('sub-active-today', true, '2026-05-12'),
        subTask('sub-open', false)
      ])
    ];

    expect(countCompletedToday(items, '2026-05-12')).toBe(3);
  });

  test('schedules the next refresh just after local midnight', () => {
    const delay = getNextLocalDayRefreshDelay(new Date(2026, 4, 14, 23, 59, 30, 0));

    expect(delay).toBe(31_000);
  });
});
