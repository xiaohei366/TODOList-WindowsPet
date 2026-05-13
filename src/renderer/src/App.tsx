import { Check, Circle, Plus, X } from 'lucide-react';
import { FormEvent, PointerEvent, ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import type { PetPackage, PetState, TodoItem, TodoMenuAction } from '../../shared/types';
import { getAnimationSpec, getInteractivePetState, getPetSpriteStyle, getTodoDrivenPetState } from './petAnimation';
import { moveTodoRelative, moveTodoStep, type TodoPlacement } from './todoOrdering';
import { countCompletedToday, formatLocalDateKey } from './todoStats';

const selectedPetStorageKey = 'tolist:selected-pet';

export function App(): ReactElement {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pets, setPets] = useState<PetPackage[]>([]);
  const [selectedPetId, setSelectedPetId] = useState<string>(() => localStorage.getItem(selectedPetStorageKey) ?? '');
  const [todoPanelVisible, setTodoPanelVisible] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [draggingTodo, setDraggingTodo] = useState<TodoItem | null>(null);
  const [draggingWindow, setDraggingWindow] = useState(false);
  const [petHovered, setPetHovered] = useState(false);
  const [transientState, setTransientState] = useState<PetState | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const todoPressStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void window.todoPet.todos.list().then(setTodos);
    void window.todoPet.pets.list().then((loadedPets) => {
      setPets(loadedPets);
      if (!selectedPetId && loadedPets[0]) {
        selectPet(loadedPets[0].id);
      }
    });

    const offTodos = window.todoPet.todos.onChanged(setTodos);
    const offPets = window.todoPet.pets.onChanged((loadedPets) => {
      setPets(loadedPets);
      if (loadedPets.length > 0 && !loadedPets.some((pet) => pet.id === selectedPetId)) {
        selectPet(loadedPets[0].id);
      }
    });
    const offToggleTodoPanel = window.todoPet.ui.onToggleTodoPanel(() => {
      setTodoPanelVisible((visible) => !visible);
      setComposerOpen(false);
    });
    const offSelectPet = window.todoPet.ui.onSelectPet((id) => selectPet(id));
    return () => {
      offTodos();
      offPets();
      offToggleTodoPanel();
      offSelectPet();
    };
  }, [selectedPetId]);

  useEffect(() => {
    const offTodoAction = window.todoPet.ui.onTodoAction(handleTodoMenuAction);
    return () => {
      offTodoAction();
    };
  }, [todos]);

  useEffect(() => {
    if (!draggingTodo) {
      return;
    }
    const stopDragging = (): void => {
      const activeIds = todos.filter((item) => !item.completed).map((item) => item.id);
      void window.todoPet.todos.reorderVisible(activeIds).then(setTodos);
      setDraggingTodo(null);
    };
    window.addEventListener('pointerup', stopDragging, { once: true });
    return () => window.removeEventListener('pointerup', stopDragging);
  }, [draggingTodo, todos]);

  useEffect(() => {
    if (!draggingWindow) {
      return;
    }

    const onMove = (event: globalThis.PointerEvent): void => {
      if (!lastPointer.current) {
        lastPointer.current = { x: event.screenX, y: event.screenY };
        return;
      }

      const deltaX = event.screenX - lastPointer.current.x;
      const deltaY = event.screenY - lastPointer.current.y;
      lastPointer.current = { x: event.screenX, y: event.screenY };
      if (deltaX !== 0 || deltaY !== 0) {
        setTransientState(deltaX < 0 ? 'running-left' : 'running-right');
        void window.todoPet.window.moveBy(deltaX, deltaY);
      }
    };

    const onUp = (): void => {
      setDraggingWindow(false);
      setTransientState(null);
      lastPointer.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingWindow]);

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId) ?? pets[0],
    [pets, selectedPetId]
  );
  const completedTodayCount = countCompletedToday(todos, formatLocalDateKey(new Date()));
  const basePetState = getTodoDrivenPetState(todos);
  const petState =
    transientState ??
    getInteractivePetState({
      baseState: basePetState,
      isHovered: petHovered
    });

  function selectPet(id: string): void {
    setSelectedPetId(id);
    localStorage.setItem(selectedPetStorageKey, id);
    void window.todoPet.pets.select(id);
  }

  async function submitTodo(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = newTodoText.trim();
    if (!text) {
      return;
    }
    await window.todoPet.todos.add(text);
    setNewTodoText('');
    setComposerOpen(false);
    setTransientState('waving');
    window.setTimeout(() => setTransientState(null), 900);
  }

  function openPetMenu(event: React.MouseEvent): void {
    event.preventDefault();
    void window.todoPet.ui.showPetMenu({ x: Math.round(event.clientX), y: Math.round(event.clientY) });
  }

  function openTaskMenu(event: React.MouseEvent, item: TodoItem): void {
    event.preventDefault();
    void window.todoPet.ui.showTodoMenu({
      point: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
      item
    });
  }

  function handleTodoMenuAction(action: TodoMenuAction): void {
    const item = todos.find((todo) => todo.id === action.id);
    if (!item) {
      return;
    }

    if (action.type === 'toggle-completed') {
      void window.todoPet.todos.setCompleted(item.id, !item.completed);
      return;
    }
    if (action.type === 'toggle-highlighted') {
      void window.todoPet.todos.setHighlighted(item.id, !item.highlighted);
      return;
    }
    if (action.type === 'delete') {
      void window.todoPet.todos.delete(item.id);
      return;
    }
    if (action.type === 'move-up' || action.type === 'move-down') {
      applyPriorityStep(item, action.type === 'move-up' ? 'up' : 'down');
    }
  }

  function startTodoPress(event: PointerEvent, item: TodoItem): void {
    if (item.completed || event.button !== 0) {
      return;
    }
    todoPressStart.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setDraggingTodo(item);
    }, 220);
  }

  function cancelTodoPress(): void {
    window.clearTimeout(longPressTimer.current);
    todoPressStart.current = null;
  }

  function handleTodoPointerMove(event: PointerEvent<HTMLElement>, item: TodoItem): void {
    if (!draggingTodo && todoPressStart.current) {
      const deltaX = event.clientX - todoPressStart.current.x;
      const deltaY = event.clientY - todoPressStart.current.y;
      if (Math.hypot(deltaX, deltaY) > 10) {
        cancelTodoPress();
      }
      return;
    }

    if (!draggingTodo) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement: TodoPlacement = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
    hoverTodo(item, placement);
  }

  function hoverTodo(item: TodoItem, placement: TodoPlacement): void {
    if (!draggingTodo || item.id === draggingTodo.id || item.completed) {
      return;
    }
    setTodos((current) => moveTodoRelative(current, draggingTodo.id, item.id, placement));
  }

  function applyPriorityStep(item: TodoItem, direction: 'up' | 'down'): void {
    const next = moveTodoStep(todos, item.id, direction);
    if (next === todos) {
      return;
    }
    setTodos(next);
    const activeIds = next.filter((todo) => !todo.completed).map((todo) => todo.id);
    void window.todoPet.todos.reorderVisible(activeIds).then(setTodos);
  }

  function startWindowDrag(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointer.current = { x: event.screenX, y: event.screenY };
    setDraggingWindow(true);
  }

  return (
    <main className="pet-stage">
      {todoPanelVisible ? (
        <section className="todo-panel" aria-label="TODO list">
          <div className="todo-panel__top">
            <div className="todo-panel__heading">
              <span className="todo-panel__title">TODO</span>
              <span className="todo-panel__streak">今日已完成 {completedTodayCount} 个任务</span>
            </div>
            <button className="icon-button" title="Add TODO" onClick={() => setComposerOpen(true)}>
              <Plus size={16} />
            </button>
          </div>

          {composerOpen ? (
            <form className="todo-composer" onSubmit={(event) => void submitTodo(event)}>
              <input
                autoFocus
                value={newTodoText}
                onChange={(event) => setNewTodoText(event.target.value)}
                placeholder="New TODO"
              />
              <button className="icon-button" title="Save TODO" type="submit">
                <Check size={16} />
              </button>
              <button className="icon-button" title="Cancel" type="button" onClick={() => setComposerOpen(false)}>
                <X size={16} />
              </button>
            </form>
          ) : null}

          <div className="todo-list">
            {todos.length === 0 ? (
              <div className="empty-state">No active TODO</div>
            ) : (
              todos.map((item) => (
                <article
                  className={[
                    'todo-item',
                    item.completed ? 'todo-item--done' : '',
                    item.highlighted ? 'todo-item--hot' : '',
                    draggingTodo?.id === item.id ? 'todo-item--dragging' : ''
                  ].join(' ')}
                  data-todo-id={item.id}
                  key={item.id}
                  onContextMenu={(event) => openTaskMenu(event, item)}
                  onPointerDown={(event) => startTodoPress(event, item)}
                  onPointerMove={(event) => handleTodoPointerMove(event, item)}
                  onPointerUp={cancelTodoPress}
                  onPointerCancel={cancelTodoPress}
                >
                  <button
                    className="todo-check"
                    title={item.completed ? 'Mark active' : 'Mark done'}
                    onClick={() => void window.todoPet.todos.setCompleted(item.id, !item.completed)}
                  >
                    {item.completed ? <Check size={15} /> : <Circle size={15} />}
                  </button>
                  <div className="todo-copy">
                    <span>{item.text}</span>
                    <small>{item.overdue ? item.date : 'Today'}</small>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      <div
        className="pet-anchor"
        onContextMenu={openPetMenu}
        onPointerDown={startWindowDrag}
        onPointerEnter={() => setPetHovered(true)}
        onPointerLeave={() => setPetHovered(false)}
      >
        {selectedPet ? <PetSprite pet={selectedPet} state={petState} /> : <div className="pet-placeholder">PET</div>}
      </div>

    </main>
  );
}

function PetSprite({ pet, state }: { pet: PetPackage; state: PetState }): ReactElement {
  const frame = useAnimationFrame(state);

  return (
    <div
      className="pet-sprite"
      title={pet.displayName}
      style={getPetSpriteStyle(state, frame, pet.spritesheetUrl ?? '')}
    />
  );
}

function useAnimationFrame(state: PetState): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const spec = getAnimationSpec(state);
    setFrame(0);
    let disposed = false;
    let frameIndex = 0;
    let timer: number;

    const tick = (): void => {
      if (disposed) {
        return;
      }
      timer = window.setTimeout(() => {
        frameIndex = (frameIndex + 1) % spec.frameCount;
        setFrame(frameIndex);
        tick();
      }, spec.durations[frameIndex]);
    };

    tick();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [state]);

  return frame;
}

