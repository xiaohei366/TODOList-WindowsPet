import { Check, Circle, Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import { FormEvent, PointerEvent, ReactElement, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { PetPackage, PetState, ScheduledTodoInput, ScheduledTodoRule, TodoItem, TodoMenuAction } from '../../shared/types';
import { type AppLanguage, type I18nKey, defaultLanguage, t } from '../../shared/i18n';
import { getAnimationSpec, getInteractivePetState, getPetSpriteStyle, getTodoDrivenPetState } from './petAnimation';
import { clampPetUiScale, defaultPetUiScale, getPetUiScaleFromResizeDrag } from './petScale';
import {
  buildScheduleInput,
  createDefaultScheduleForm,
  formatScheduleSummary,
  getScheduleFormMaxDay,
  scheduleRuleToForm,
  type ScheduleFormState,
  weekdayOptions
} from './scheduleForm';
import { moveTodoRelative, moveTodoStep, type TodoPlacement } from './todoOrdering';
import { countCompletedToday, formatLocalDateKey, getNextLocalDayRefreshDelay } from './todoStats';
import { hasExceededPetWindowDragThreshold } from './windowDrag';
import { shouldIgnoreWindowMouseEvents } from './mousePassthrough';

const selectedPetStorageKey = 'tolist:selected-pet';
const petUiScaleStorageKey = 'tolist:pet-ui-scale';
const petBaseBottom = 38;
const petBaseHeight = 104;
const todoPetGap = 8;

export function App(): ReactElement {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pets, setPets] = useState<PetPackage[]>([]);
  const [schedules, setSchedules] = useState<ScheduledTodoRule[]>([]);
  const [language, setLanguage] = useState<AppLanguage>(defaultLanguage);
  const [selectedPetId, setSelectedPetId] = useState<string>(() => localStorage.getItem(selectedPetStorageKey) ?? '');
  const [todoPanelVisible, setTodoPanelVisible] = useState(true);
  const [schedulePanelVisible, setSchedulePanelVisible] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [editingTodo, setEditingTodo] = useState<{ id: string; text: string } | null>(null);
  const [editingNotesTodo, setEditingNotesTodo] = useState<{ id: string; notes: string } | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(() => createDefaultScheduleForm());
  const [draggingTodo, setDraggingTodo] = useState<TodoItem | null>(null);
  const [resizingPetUi, setResizingPetUi] = useState(false);
  const [petUiScale, setPetUiScale] = useState(() =>
    clampPetUiScale(Number(localStorage.getItem(petUiScaleStorageKey) ?? defaultPetUiScale))
  );
  const [petHovered, setPetHovered] = useState(false);
  const [transientState, setTransientState] = useState<PetState | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const windowDrag = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    dragging: boolean;
    lastDirection: 'running-left' | 'running-right' | null;
  } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; scale: number } | null>(null);
  const mouseInputCaptured = useRef(false);
  const mousePassthrough = useRef<boolean | null>(null);
  const todoPressStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setWindowMousePassthrough(true);
    const handlePointerMove = (event: globalThis.PointerEvent): void => {
      updateWindowMousePassthrough(event.target);
    };
    const handleMouseMove = (event: MouseEvent): void => {
      updateWindowMousePassthrough(event.target);
    };
    const handlePointerLeave = (): void => {
      if (!mouseInputCaptured.current) {
        setWindowMousePassthrough(true);
      }
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('pointerleave', handlePointerLeave);
      void window.todoPet.window.setMousePassthrough(false);
    };
  }, []);

  useEffect(() => {
    void window.todoPet.settings.getLanguage().then(setLanguage);
    const offLanguage = window.todoPet.settings.onLanguageChanged(setLanguage);
    return () => {
      offLanguage();
    };
  }, []);

  useEffect(() => {
    void window.todoPet.todos.list().then(setTodos);
    void window.todoPet.pets.list().then((loadedPets) => {
      setPets(loadedPets);
      if (!selectedPetId && loadedPets[0]) {
        selectPet(loadedPets[0].id);
      }
    });
    void window.todoPet.schedules.list().then(setSchedules);

    const offTodos = window.todoPet.todos.onChanged(setTodos);
    const offSchedules = window.todoPet.schedules.onChanged(setSchedules);
    const offPets = window.todoPet.pets.onChanged((loadedPets) => {
      setPets(loadedPets);
      if (loadedPets.length > 0 && !loadedPets.some((pet) => pet.id === selectedPetId)) {
        selectPet(loadedPets[0].id);
      }
    });
    const offToggleTodoPanel = window.todoPet.ui.onToggleTodoPanel(() => {
      setSchedulePanelVisible(false);
      setTodoPanelVisible((visible) => !visible);
      setComposerOpen(false);
    });
    const offToggleSchedulePanel = window.todoPet.ui.onToggleSchedulePanel(() => {
      setTodoPanelVisible(true);
      setSchedulePanelVisible((visible) => !visible);
      setComposerOpen(false);
      setEditingTodo(null);
    });
    const offSelectPet = window.todoPet.ui.onSelectPet((id) => selectPet(id));
    return () => {
      offTodos();
      offSchedules();
      offPets();
      offToggleTodoPanel();
      offToggleSchedulePanel();
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
    let disposed = false;
    let timer: number | undefined;

    const refreshAndReschedule = (): void => {
      if (disposed) {
        return;
      }
      void window.todoPet.todos.list().then((items) => {
        if (!disposed) {
          setTodos(items);
        }
      }).finally(() => {
        if (!disposed) {
          scheduleNextRefresh();
        }
      });
    };

    const scheduleNextRefresh = (): void => {
      timer = window.setTimeout(refreshAndReschedule, getNextLocalDayRefreshDelay(new Date()));
    };

    scheduleNextRefresh();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!draggingTodo) {
      return;
    }
    const stopDragging = (event: globalThis.PointerEvent): void => {
      const activeIds = todos.filter((item) => !item.completed).map((item) => item.id);
      void window.todoPet.todos.reorderVisible(activeIds).then(setTodos);
      setDraggingTodo(null);
      setWindowMouseInputCaptured(false);
      updateWindowMousePassthroughFromPoint(event.clientX, event.clientY);
    };
    window.addEventListener('pointerup', stopDragging, { once: true });
    return () => window.removeEventListener('pointerup', stopDragging);
  }, [draggingTodo, todos]);

  useEffect(() => {
    if (!resizingPetUi) {
      return;
    }

    const onMove = (event: globalThis.PointerEvent): void => {
      if (!resizeStart.current) {
        return;
      }

      const nextScale = getPetUiScaleFromResizeDrag(
        resizeStart.current.scale,
        event.screenX - resizeStart.current.x,
        event.screenY - resizeStart.current.y
      );
      setPetUiScale(nextScale);
    };

    const onUp = (event: globalThis.PointerEvent): void => {
      setResizingPetUi(false);
      resizeStart.current = null;
      setWindowMouseInputCaptured(false);
      updateWindowMousePassthroughFromPoint(event.clientX, event.clientY);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizingPetUi]);

  useEffect(() => {
    localStorage.setItem(petUiScaleStorageKey, String(petUiScale));
  }, [petUiScale]);

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId) ?? pets[0],
    [pets, selectedPetId]
  );
  const completedTodayCount = countCompletedToday(todos, formatLocalDateKey(new Date()));
  const scheduleMaxDay = getScheduleFormMaxDay(scheduleForm);
  const basePetState = getTodoDrivenPetState(todos);
  const petState =
    transientState ??
    getInteractivePetState({
      baseState: basePetState,
      isHovered: petHovered
    });

  function tr(key: I18nKey, values?: Record<string, string | number>): string {
    return t(language, key, values);
  }

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

  async function submitSchedule(event: FormEvent): Promise<void> {
    event.preventDefault();
    let input: ScheduledTodoInput;
    try {
      input = buildScheduleInput(scheduleForm, new Date(), language);
    } catch (error) {
      setScheduleError((error as Error).message);
      return;
    }

    setScheduleError('');
    if (editingScheduleId) {
      await window.todoPet.schedules.update(editingScheduleId, input);
    } else {
      await window.todoPet.schedules.create(input);
    }
    closeScheduleForm();
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

  function setWindowMousePassthrough(ignore: boolean): void {
    if (mousePassthrough.current === ignore) {
      return;
    }
    mousePassthrough.current = ignore;
    void window.todoPet.window.setMousePassthrough(ignore);
  }

  function updateWindowMousePassthrough(target: EventTarget | null): void {
    setWindowMousePassthrough(shouldIgnoreWindowMouseEvents(target, mouseInputCaptured.current));
  }

  function updateWindowMousePassthroughFromPoint(clientX: number, clientY: number): void {
    updateWindowMousePassthrough(document.elementFromPoint(clientX, clientY));
  }

  function setWindowMouseInputCaptured(captured: boolean): void {
    mouseInputCaptured.current = captured;
    if (captured) {
      setWindowMousePassthrough(false);
    }
  }

  function openNewScheduleForm(): void {
    setScheduleForm(createDefaultScheduleForm());
    setEditingScheduleId(null);
    setScheduleError('');
    setScheduleFormOpen(true);
  }

  function editSchedule(rule: ScheduledTodoRule): void {
    setScheduleForm(scheduleRuleToForm(rule));
    setEditingScheduleId(rule.id);
    setScheduleError('');
    setScheduleFormOpen(true);
  }

  function closeScheduleForm(): void {
    setScheduleFormOpen(false);
    setEditingScheduleId(null);
    setScheduleError('');
    setScheduleForm(createDefaultScheduleForm());
  }

  function updateScheduleForm(patch: Partial<ScheduleFormState>): void {
    setScheduleForm((current) => ({ ...current, ...patch }));
  }

  function toggleScheduleWeekday(day: number): void {
    setScheduleForm((current) => {
      const weekdays = current.weekdays.includes(day)
        ? current.weekdays.filter((weekday) => weekday !== day)
        : [...current.weekdays, day].sort((left, right) => left - right);
      return { ...current, weekdays };
    });
  }

  async function toggleScheduleEnabled(rule: ScheduledTodoRule): Promise<void> {
    await window.todoPet.schedules.setEnabled(rule.id, !rule.enabled);
  }

  async function deleteSchedule(rule: ScheduledTodoRule): Promise<void> {
    await window.todoPet.schedules.delete(rule.id);
    if (editingScheduleId === rule.id) {
      closeScheduleForm();
    }
  }

  function handleTodoMenuAction(action: TodoMenuAction): void {
    const item = todos.find((todo) => todo.id === action.id);
    if (!item) {
      return;
    }

    if (action.type === 'edit') {
      setComposerOpen(false);
      setEditingTodo({ id: item.id, text: item.text });
      return;
    }
    if (action.type === 'edit-notes') {
      setComposerOpen(false);
      setEditingNotesTodo({ id: item.id, notes: item.notes ?? '' });
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
    if (editingTodo?.id === item.id || editingNotesTodo?.id === item.id || item.completed || event.button !== 0) {
      return;
    }
    todoPressStart.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setWindowMouseInputCaptured(true);
      setDraggingTodo(item);
    }, 220);
  }

  function cancelTodoPress(): void {
    window.clearTimeout(longPressTimer.current);
    todoPressStart.current = null;
  }

  async function submitTodoEdit(event: FormEvent, item: TodoItem): Promise<void> {
    event.preventDefault();
    const text = editingTodo?.text.trim() ?? '';
    if (!text) {
      return;
    }
    await window.todoPet.todos.updateText(item.id, text);
    setEditingTodo(null);
  }

  async function submitNotesEdit(event: FormEvent, item: TodoItem): Promise<void> {
    event.preventDefault();
    const notes = editingNotesTodo?.notes ?? '';
    await window.todoPet.todos.updateNotes(item.id, notes);
    setEditingNotesTodo(null);
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
    event.preventDefault();
    setWindowMouseInputCaptured(true);
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    windowDrag.current = {
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      dragging: false,
      lastDirection: null
    };
    window.todoPet.window.startDrag(event.screenX, event.screenY);

    let pendingDragMove: { screenX: number; screenY: number } | null = null;
    let dragAnimationFrame: number | null = null;

    const flushDragMove = (): void => {
      dragAnimationFrame = null;
      if (!pendingDragMove) {
        return;
      }
      const next = pendingDragMove;
      pendingDragMove = null;
      window.todoPet.window.moveDrag(next.screenX, next.screenY);
    };

    const scheduleDragMove = (screenX: number, screenY: number): void => {
      pendingDragMove = { screenX, screenY };
      if (dragAnimationFrame === null) {
        dragAnimationFrame = window.requestAnimationFrame(flushDragMove);
      }
    };

    const onMove = (moveEvent: globalThis.PointerEvent): void => {
      const drag = windowDrag.current;
      if (!drag) {
        return;
      }

      if (!drag.dragging) {
        if (!hasExceededPetWindowDragThreshold(drag.startX, drag.startY, moveEvent.screenX, moveEvent.screenY)) {
          return;
        }
        drag.dragging = true;
      }

      const deltaX = moveEvent.screenX - drag.lastX;
      const deltaY = moveEvent.screenY - drag.lastY;
      drag.lastX = moveEvent.screenX;
      drag.lastY = moveEvent.screenY;
      if (deltaX !== 0 || deltaY !== 0) {
        const direction = deltaX < 0 ? 'running-left' : 'running-right';
        if (drag.lastDirection !== direction) {
          drag.lastDirection = direction;
          setTransientState(direction);
        }
        scheduleDragMove(moveEvent.screenX, moveEvent.screenY);
      }
    };

    const stopDragging = (upEvent: globalThis.PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stopDragging);
      const drag = windowDrag.current;
      if (dragAnimationFrame !== null) {
        window.cancelAnimationFrame(dragAnimationFrame);
        dragAnimationFrame = null;
      }
      if (drag?.dragging) {
        window.todoPet.window.moveDrag(upEvent.screenX, upEvent.screenY);
      }
      pendingDragMove = null;
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      windowDrag.current = null;
      window.todoPet.window.endDrag();
      setTransientState(null);
      setWindowMouseInputCaptured(false);
      updateWindowMousePassthroughFromPoint(upEvent.clientX, upEvent.clientY);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stopDragging, { once: true });
  }

  function startPetUiResize(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setWindowMouseInputCaptured(true);
    resizeStart.current = { x: event.screenX, y: event.screenY, scale: petUiScale };
    setResizingPetUi(true);
  }

  return (
    <main className="pet-stage" style={{ '--pet-ui-scale': petUiScale } as CSSProperties}>
      {schedulePanelVisible ? (
        <section
          className="todo-panel schedule-panel"
          aria-label={tr('schedule.aria')}
          style={{ bottom: petBaseBottom + petBaseHeight * petUiScale + todoPetGap }}
        >
          <div className="todo-panel__top">
            <div className="todo-panel__heading">
              <span className="todo-panel__title">{tr('schedule.title')}</span>
              <span className="schedule-count">{tr('schedule.count', { count: schedules.length })}</span>
            </div>
            <div className="panel-actions">
              <button className="icon-button" title={tr('schedule.add')} onClick={openNewScheduleForm}>
                <Plus size={16} />
              </button>
              <button className="icon-button" title={tr('schedule.close')} onClick={() => setSchedulePanelVisible(false)}>
                <X size={16} />
              </button>
            </div>
          </div>

          {scheduleFormOpen ? (
            <form className="schedule-form" onSubmit={(event) => void submitSchedule(event)}>
              <div className="schedule-kind">
                <button
                  className={scheduleForm.kind === 'weekly' ? 'schedule-kind__option schedule-kind__option--active' : 'schedule-kind__option'}
                  type="button"
                  onClick={() => updateScheduleForm({ kind: 'weekly' })}
                >
                  {tr('schedule.weekly')}
                </button>
                <button
                  className={scheduleForm.kind === 'one-time' ? 'schedule-kind__option schedule-kind__option--active' : 'schedule-kind__option'}
                  type="button"
                  onClick={() => updateScheduleForm({ kind: 'one-time' })}
                >
                  {tr('schedule.oneTime')}
                </button>
              </div>
              <input
                value={scheduleForm.text}
                onChange={(event) => updateScheduleForm({ text: event.target.value })}
                placeholder={tr('schedule.text')}
              />
              <div className="schedule-time">
                <input
                  max={23}
                  min={0}
                  placeholder={tr('schedule.hour')}
                  type="number"
                  value={scheduleForm.hour}
                  onChange={(event) => updateScheduleForm({ hour: event.target.value })}
                />
                <span>:</span>
                <input
                  max={59}
                  min={0}
                  placeholder={tr('schedule.minute')}
                  type="number"
                  value={scheduleForm.minute}
                  onChange={(event) => updateScheduleForm({ minute: event.target.value })}
                />
              </div>
              {scheduleForm.kind === 'weekly' ? (
                <div className="weekday-row">
                  <span className="weekday-row__label">{tr('schedule.weekly')}</span>
                  {weekdayOptions.map((weekday) => (
                    <button
                      className={
                        scheduleForm.weekdays.includes(weekday.value)
                          ? 'weekday-toggle weekday-toggle--active'
                          : 'weekday-toggle'
                      }
                      key={weekday.value}
                      type="button"
                      onClick={() => toggleScheduleWeekday(weekday.value)}
                    >
                      {weekday.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="schedule-date">
                  <input
                    max={9999}
                    min={1}
                    placeholder={tr('schedule.year')}
                    type="number"
                    value={scheduleForm.year}
                    onChange={(event) => updateScheduleForm({ year: event.target.value })}
                  />
                  <input
                    max={12}
                    min={1}
                    placeholder={tr('schedule.month')}
                    type="number"
                    value={scheduleForm.month}
                    onChange={(event) => updateScheduleForm({ month: event.target.value })}
                  />
                  <input
                    max={scheduleMaxDay}
                    min={1}
                    placeholder={tr('schedule.day')}
                    type="number"
                    value={scheduleForm.day}
                    onChange={(event) => updateScheduleForm({ day: event.target.value })}
                  />
                </div>
              )}
              {scheduleError ? <div className="schedule-error">{scheduleError}</div> : null}
              <div className="schedule-form__actions">
                <button className="icon-button" title={tr('schedule.save')} type="submit">
                  <Check size={16} />
                </button>
                <button className="icon-button" title={tr('schedule.cancel')} type="button" onClick={closeScheduleForm}>
                  <X size={16} />
                </button>
              </div>
            </form>
          ) : null}

          <div className="schedule-list">
            {schedules.length === 0 ? (
              <div className="empty-state">{tr('schedule.empty')}</div>
            ) : (
              schedules.map((rule) => (
                <article className={rule.enabled ? 'schedule-item' : 'schedule-item schedule-item--disabled'} key={rule.id}>
                  <div className="schedule-item__copy">
                    <span>{rule.text}</span>
                    <small>{formatScheduleSummary(rule, language)}</small>
                  </div>
                  <div className="schedule-item__actions">
                    <button className="icon-button" title={rule.enabled ? tr('schedule.disable') : tr('schedule.enable')} onClick={() => void toggleScheduleEnabled(rule)}>
                      <Power size={15} />
                    </button>
                    <button className="icon-button" title={tr('schedule.edit')} onClick={() => editSchedule(rule)}>
                      <Pencil size={15} />
                    </button>
                    <button className="icon-button" title={tr('menu.delete')} onClick={() => void deleteSchedule(rule)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : todoPanelVisible ? (
        <section
          className="todo-panel"
          aria-label={tr('todo.aria')}
          style={{ bottom: petBaseBottom + petBaseHeight * petUiScale + todoPetGap }}
        >
          <div className="todo-panel__top">
            <div className="todo-panel__heading">
              <span className="todo-panel__title">TODO</span>
              <span className="todo-panel__streak">{tr('todo.completedToday', { count: completedTodayCount })}</span>
            </div>
            <button className="icon-button" title={tr('todo.add')} onClick={() => setComposerOpen(true)}>
              <Plus size={16} />
            </button>
          </div>

          {composerOpen ? (
            <form className="todo-composer" onSubmit={(event) => void submitTodo(event)}>
              <input
                autoFocus
                value={newTodoText}
                onChange={(event) => setNewTodoText(event.target.value)}
                placeholder={tr('todo.new')}
              />
              <button className="icon-button" title={tr('todo.save')} type="submit">
                <Check size={16} />
              </button>
              <button className="icon-button" title={tr('todo.cancel')} type="button" onClick={() => setComposerOpen(false)}>
                <X size={16} />
              </button>
            </form>
          ) : null}

          <div className="todo-list">
            {todos.length === 0 ? (
              <div className="empty-state">{tr('todo.empty')}</div>
            ) : (
            todos.map((item) => (
              <article
                className={[
                  'todo-item',
                  item.completed ? 'todo-item--done' : '',
                  item.highlighted ? 'todo-item--hot' : '',
                  editingTodo?.id === item.id ? 'todo-item--editing' : '',
                  editingNotesTodo?.id === item.id ? 'todo-item--editing-notes' : '',
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
                  {editingTodo?.id === item.id ? (
                    <form className="todo-editor" onSubmit={(event) => void submitTodoEdit(event, item)}>
                      <input
                        autoFocus
                        value={editingTodo.text}
                        onChange={(event) => setEditingTodo({ id: item.id, text: event.target.value })}
                      />
                      <button className="icon-button" title={tr('todo.saveEdit')} type="submit">
                        <Check size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title={tr('menu.cancelEdit')}
                        type="button"
                        onClick={() => setEditingTodo(null)}
                      >
                        <X size={16} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="todo-check"
                        title={item.completed ? tr('todo.markActive') : tr('todo.markDone')}
                        onClick={() => void window.todoPet.todos.setCompleted(item.id, !item.completed)}
                      >
                        {item.completed ? <Check size={15} /> : <Circle size={15} />}
                      </button>
                      <div className="todo-copy">
                        <span>{item.text}</span>
                        <small>{item.overdue ? item.date : tr('todo.today')}</small>
                        {item.notes && editingNotesTodo?.id !== item.id ? (
                          <small className="todo-notes-preview">{item.notes}</small>
                        ) : null}
                      </div>
                      {editingNotesTodo?.id === item.id ? (
                        <form className="todo-notes-editor" onSubmit={(event) => void submitNotesEdit(event, item)}>
                          <textarea
                            autoFocus
                            value={editingNotesTodo.notes}
                            onChange={(event) => setEditingNotesTodo({ id: item.id, notes: event.target.value })}
                            placeholder={tr('todo.notesPlaceholder')}
                            rows={2}
                          />
                          <div className="todo-notes-editor-actions">
                            <button className="icon-button" title={tr('todo.saveNotes')} type="submit">
                              <Check size={16} />
                            </button>
                            <button
                              className="icon-button"
                              title={tr('menu.cancelEdit')}
                              type="button"
                              onClick={() => setEditingNotesTodo(null)}
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </>
                  )}
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
        style={{ width: 96 * petUiScale, height: 104 * petUiScale }}
      >
        {selectedPet ? (
          <PetSprite pet={selectedPet} scale={petUiScale} state={petState} />
        ) : (
          <div className="pet-placeholder">PET</div>
        )}
        <button
          className="ui-resize-handle pet-resize-handle"
          title={tr('ui.resize')}
          type="button"
          onPointerDown={startPetUiResize}
        />
      </div>

    </main>
  );
}

function PetSprite({ pet, scale, state }: { pet: PetPackage; scale: number; state: PetState }): ReactElement {
  const frame = useAnimationFrame(state);

  return (
    <div
      className="pet-sprite"
      title={pet.displayName}
      style={getPetSpriteStyle(state, frame, pet.spritesheetUrl ?? '', scale)}
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

