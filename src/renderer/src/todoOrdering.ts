import type { TodoItem } from '../../shared/types';

export type TodoPlacement = 'before' | 'after';
export type TodoStepDirection = 'up' | 'down';

export function moveTodoRelative(
  items: TodoItem[],
  draggedId: string,
  targetId: string,
  placement: TodoPlacement
): TodoItem[] {
  const dragged = items.find((item) => item.id === draggedId);
  const target = items.find((item) => item.id === targetId);
  if (!dragged || !target || !canReorderAgainst(dragged, target)) {
    return items;
  }

  const sameDay = items.filter((item) => item.date === dragged.date);
  const reorderedSameDay = sameDay.filter((item) => item.id !== draggedId);
  const targetIndex = reorderedSameDay.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) {
    return items;
  }

  reorderedSameDay.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, dragged);
  return replaceDayItems(items, dragged.date, reorderedSameDay);
}

export function moveTodoStep(items: TodoItem[], itemId: string, direction: TodoStepDirection): TodoItem[] {
  const target = items.find((item) => item.id === itemId);
  if (!target || target.completed) {
    return items;
  }

  const sameDay = items.filter((item) => item.date === target.date);
  const active = sameDay.filter((item) => !item.completed);
  const activeIndex = active.findIndex((item) => item.id === itemId);
  const nextIndex = direction === 'up' ? activeIndex - 1 : activeIndex + 1;
  if (activeIndex < 0 || nextIndex < 0 || nextIndex >= active.length) {
    return items;
  }

  const reorderedActive = [...active];
  const [moved] = reorderedActive.splice(activeIndex, 1);
  reorderedActive.splice(nextIndex, 0, moved);

  return replaceDayItems(items, target.date, [...reorderedActive, ...sameDay.filter((item) => item.completed)]);
}

function canReorderAgainst(dragged: TodoItem, target: TodoItem): boolean {
  return dragged.id !== target.id && dragged.date === target.date && !dragged.completed && !target.completed;
}

function replaceDayItems(items: TodoItem[], date: string, nextDayItems: TodoItem[]): TodoItem[] {
  const replacementQueue = [...nextDayItems];
  return items.map((item) => {
    if (item.date !== date) {
      return item;
    }
    return replacementQueue.shift()!;
  });
}
