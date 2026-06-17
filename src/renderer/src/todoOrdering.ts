import type { TodoItem } from '../../shared/types';

export type TodoPlacement = 'before' | 'after';
export type TodoStepDirection = 'up' | 'down';

export type TodoListUnit =
  | { type: 'tag-group'; id: string; tag: string; items: TodoItem[] }
  | { type: 'todo'; id: string; item: TodoItem };

export function buildTodoListUnits(items: TodoItem[]): TodoListUnit[] {
  const units: TodoListUnit[] = [];
  const groups = new Map<string, Extract<TodoListUnit, { type: 'tag-group' }>>();

  for (const item of items) {
    if (!item.tag) {
      units.push({ type: 'todo', id: todoUnitId(item.id), item });
      continue;
    }

    const existing = groups.get(item.tag);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    const group: Extract<TodoListUnit, { type: 'tag-group' }> = {
      type: 'tag-group',
      id: tagUnitId(item.tag),
      tag: item.tag,
      items: [item]
    };
    groups.set(item.tag, group);
    units.push(group);
  }

  return units;
}

export function flattenTodoUnits(units: TodoListUnit[]): TodoItem[] {
  return units.flatMap((unit) => (unit.type === 'tag-group' ? unit.items : [unit.item]));
}

export function flattenActiveUnitIds(units: TodoListUnit[]): string[] {
  return flattenTodoUnits(units).filter((item) => !item.completed).map((item) => item.id);
}

export function moveTodoUnitRelative(
  units: TodoListUnit[],
  draggedUnitId: string,
  targetUnitId: string,
  placement: TodoPlacement
): TodoListUnit[] {
  const dragged = units.find((unit) => unit.id === draggedUnitId);
  const target = units.find((unit) => unit.id === targetUnitId);
  if (!dragged || !target || dragged.id === target.id || !unitCanMove(dragged) || !unitCanMove(target)) {
    return units;
  }

  const reordered = units.filter((unit) => unit.id !== draggedUnitId);
  const targetIndex = reordered.findIndex((unit) => unit.id === targetUnitId);
  if (targetIndex < 0) {
    return units;
  }

  reordered.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, dragged);
  return reordered;
}

export function moveTodoUnitStep(units: TodoListUnit[], unitId: string, direction: TodoStepDirection): TodoListUnit[] {
  const unit = units.find((candidate) => candidate.id === unitId);
  if (!unit || !unitCanMove(unit)) {
    return units;
  }

  const movableUnits = units.filter(unitCanMove);
  const currentIndex = movableUnits.findIndex((candidate) => candidate.id === unitId);
  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= movableUnits.length) {
    return units;
  }

  return moveTodoUnitRelative(
    units,
    unitId,
    movableUnits[nextIndex].id,
    direction === 'up' ? 'before' : 'after'
  );
}

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

  if (dragged.tag || target.tag) {
    return moveTodoWithinTagRelative(items, draggedId, targetId, placement);
  }

  const units = buildTodoListUnits(items);
  const nextUnits = moveTodoUnitRelative(units, todoUnitId(draggedId), todoUnitId(targetId), placement);
  return nextUnits === units ? items : flattenTodoUnits(nextUnits);
}

export function moveTodoStep(items: TodoItem[], itemId: string, direction: TodoStepDirection): TodoItem[] {
  const target = items.find((item) => item.id === itemId);
  if (!target || target.completed) {
    return items;
  }

  if (target.tag) {
    return moveTodoWithinTagStep(items, itemId, direction);
  }

  const units = buildTodoListUnits(items);
  const nextUnits = moveTodoUnitStep(units, todoUnitId(itemId), direction);
  return nextUnits === units ? items : flattenTodoUnits(nextUnits);
}

export function moveTodoWithinTagRelative(
  items: TodoItem[],
  draggedId: string,
  targetId: string,
  placement: TodoPlacement
): TodoItem[] {
  const dragged = items.find((item) => item.id === draggedId);
  const target = items.find((item) => item.id === targetId);
  if (!dragged || !target || !canReorderAgainst(dragged, target) || !dragged.tag || dragged.tag !== target.tag) {
    return items;
  }

  const units = buildTodoListUnits(items);
  const group = units.find((unit) => unit.type === 'tag-group' && unit.tag === dragged.tag);
  if (!group || group.type !== 'tag-group') {
    return items;
  }

  const reorderedItems = group.items.filter((item) => item.id !== draggedId);
  const targetIndex = reorderedItems.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) {
    return items;
  }

  reorderedItems.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, dragged);
  const nextUnits = units.map((unit) => (unit.id === group.id ? { ...group, items: reorderedItems } : unit));
  return flattenTodoUnits(nextUnits);
}

export function moveTodoWithinTagStep(items: TodoItem[], itemId: string, direction: TodoStepDirection): TodoItem[] {
  const target = items.find((item) => item.id === itemId);
  if (!target?.tag || target.completed) {
    return items;
  }

  const activeGroupItems = items.filter((item) => item.tag === target.tag && !item.completed);
  const currentIndex = activeGroupItems.findIndex((item) => item.id === itemId);
  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= activeGroupItems.length) {
    return items;
  }

  return moveTodoWithinTagRelative(
    items,
    itemId,
    activeGroupItems[nextIndex].id,
    direction === 'up' ? 'before' : 'after'
  );
}

export function getTodoTopLevelUnitId(item: TodoItem): string {
  return item.tag ? tagUnitId(item.tag) : todoUnitId(item.id);
}

export function getTagUnitId(tag: string): string {
  return tagUnitId(tag);
}

function canReorderAgainst(dragged: TodoItem, target: TodoItem): boolean {
  return dragged.id !== target.id && !dragged.completed && !target.completed;
}

function unitCanMove(unit: TodoListUnit): boolean {
  return unit.type === 'tag-group'
    ? unit.items.some((item) => !item.completed)
    : !unit.item.completed;
}

function tagUnitId(tag: string): string {
  return `tag:${tag}`;
}

function todoUnitId(id: string): string {
  return `todo:${id}`;
}
