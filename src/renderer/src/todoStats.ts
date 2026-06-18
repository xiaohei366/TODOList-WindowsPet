import type { TodoItem } from '../../shared/types';

export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function countCompletedToday(items: TodoItem[], todayKey: string): number {
  let count = 0;
  for (const item of items) {
    if (item.completed && (item.completedDate ?? item.date) === todayKey) {
      count += 1;
    }
    for (const sub of item.subTasks) {
      if (sub.completed && (sub.completedDate ?? item.date) === todayKey) {
        count += 1;
      }
    }
  }
  return count;
}

export function getNextLocalDayRefreshDelay(now: Date): number {
  const nextRefresh = new Date(now);
  nextRefresh.setHours(24, 0, 1, 0);
  return Math.max(1_000, nextRefresh.getTime() - now.getTime());
}
