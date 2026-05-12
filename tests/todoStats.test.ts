import { describe, expect, test } from 'vitest';
import type { TodoItem } from '../src/shared/types';
import { countCompletedToday, formatLocalDateKey } from '../src/renderer/src/todoStats';

function item(id: string, date: string, completed: boolean): TodoItem {
  return {
    id,
    date,
    text: id,
    completed,
    highlighted: false,
    overdue: false,
    sourceLine: 1
  };
}

describe('todoStats helpers', () => {
  test('formats a local date key for today comparisons', () => {
    expect(formatLocalDateKey(new Date(2026, 4, 12))).toBe('2026-05-12');
  });

  test('counts only completed todos from today', () => {
    const items = [
      item('done-today', '2026-05-12', true),
      item('active-today', '2026-05-12', false),
      item('done-yesterday', '2026-05-11', true)
    ];

    expect(countCompletedToday(items, '2026-05-12')).toBe(1);
  });
});
