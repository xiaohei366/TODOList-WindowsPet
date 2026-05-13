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

  const active = items.filter((item) => !item.completed);
  const reorderedActive = active.filter((item) => item.id !== draggedId);
  const targetIndex = reorderedActive.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) {
    return items;
  }

  reorderedActive.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, dragged);
  return [...reorderedActive, ...items.filter((item) => item.completed)];
}

export function moveTodoStep(items: TodoItem[], itemId: string, direction: TodoStepDirection): TodoItem[] {
  const target = items.find((item) => item.id === itemId);
  if (!target || target.completed) {
    return items;
  }

  const active = items.filter((item) => !item.completed);
  const activeIndex = active.findIndex((item) => item.id === itemId);
  const nextIndex = direction === 'up' ? activeIndex - 1 : activeIndex + 1;
  if (activeIndex < 0 || nextIndex < 0 || nextIndex >= active.length) {
    return items;
  }

  const reorderedActive = [...active];
  const [moved] = reorderedActive.splice(activeIndex, 1);
  reorderedActive.splice(nextIndex, 0, moved);

  return [...reorderedActive, ...items.filter((item) => item.completed)];
}

function canReorderAgainst(dragged: TodoItem, target: TodoItem): boolean {
  return dragged.id !== target.id && !dragged.completed && !target.completed;
}
