import { describe, expect, test } from 'vitest';
import type { TodoItem, TodoSubTask } from '../src/shared/types';
import { countCompletedToday, countRemainingToday, formatLocalDateKey, getNextLocalDayRefreshDelay } from '../src/renderer/src/todoStats';

function item(
  id: string,
  date: string,
  completed: boolean,
  completedDate?: string,
  subTasks: TodoSubTask[] = [],
  deadline?: string
): TodoItem {
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
    deadline,
    subTasks
  };
}

function subTask(id: string, completed: boolean, completedDate?: string, deadline?: string): TodoSubTask {
  return { id, text: id, completed, completedDate, deadline };
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

  test('counts parent + all incomplete sub-tasks when parent deadline is due, sub-tasks judged independently otherwise', () => {
    const items = [
      // 父项截止今日且未完成：父项 1 + 全部未完成子任务（不管子任务自身截止日期）
      item('parent-due-today', '2026-05-12', false, undefined, [
        subTask('sub-open-no-ddl', false),
        subTask('sub-open-ddl-future', false, undefined, '2026-05-20'),
        subTask('sub-done', true, '2026-05-12', '2026-05-12')
      ], '2026-05-12'),
      // 父项截止在未来：父项不计，子任务按自身截止日期独立判断
      item('parent-future-ddl', '2026-05-12', false, undefined, [
        subTask('sub-due-today', false, undefined, '2026-05-12'),
        subTask('sub-no-ddl', false),
        subTask('sub-future-ddl', false, undefined, '2026-05-20'),
        subTask('sub-done', true, '2026-05-12', '2026-05-12')
      ], '2026-05-20'),
      // 未设置截止日期且未完成 → 不计入
      item('no-ddl', '2026-05-12', false, undefined, []),
      // 截止日期已逾期且未完成 → 计入
      item('overdue-ddl', '2026-05-12', false, undefined, [], '2026-05-10'),
      // 已完成（即使截止今日）→ 不计入
      item('done-today', '2026-05-12', true, undefined, [], '2026-05-12')
    ];

    // parent-due-today: 1 parent + 2 incomplete subs = 3
    // parent-future-ddl: sub-due-today = 1
    // overdue-ddl: 1
    expect(countRemainingToday(items, '2026-05-12')).toBe(5);
  });

  test('counts future-parent sub-tasks only when their own deadline is today or overdue', () => {
    const items = [
      item('future-parent', '2026-05-15', false, undefined, [
        subTask('future-no-ddl', false),
        subTask('future-ddl-later', false, undefined, '2026-05-20'),
        subTask('future-ddl-today', false, undefined, '2026-05-12'),
        subTask('future-ddl-overdue', false, undefined, '2026-05-10'),
        subTask('future-ddl-done', true, '2026-05-12', '2026-05-12')
      ])
    ];

    expect(countRemainingToday(items, '2026-05-12')).toBe(2);
  });

  test('schedules the next refresh just after local midnight', () => {
    const delay = getNextLocalDayRefreshDelay(new Date(2026, 4, 14, 23, 59, 30, 0));

    expect(delay).toBe(31_000);
  });
});
