import { contextBridge, ipcRenderer } from 'electron';
import type { ImportResult, PetPackage, ScheduledTodoInput, ScheduledTodoRule, TodoItem, TodoMenuAction } from '../shared/types';

type Listener<T> = (payload: T) => void;

function onPayload<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('todoPet', {
  todos: {
    list: (): Promise<TodoItem[]> => ipcRenderer.invoke('todos:list'),
    add: (text: string): Promise<TodoItem> => ipcRenderer.invoke('todos:add', text),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('todos:delete', id),
    setCompleted: (id: string, completed: boolean): Promise<TodoItem> =>
      ipcRenderer.invoke('todos:setCompleted', id, completed),
    setHighlighted: (id: string, highlighted: boolean): Promise<TodoItem> =>
      ipcRenderer.invoke('todos:setHighlighted', id, highlighted),
    updateText: (id: string, text: string): Promise<TodoItem> => ipcRenderer.invoke('todos:updateText', id, text),
    reorder: (date: string, ids: string[]): Promise<TodoItem[]> => ipcRenderer.invoke('todos:reorder', date, ids),
    reorderVisible: (ids: string[]): Promise<TodoItem[]> => ipcRenderer.invoke('todos:reorderVisible', ids),
    exportMarkdown: (): Promise<void> => ipcRenderer.invoke('todos:exportMarkdown'),
    importMarkdown: (): Promise<ImportResult | undefined> => ipcRenderer.invoke('todos:importMarkdown'),
    openSource: (): Promise<void> => ipcRenderer.invoke('todos:openSource'),
    onChanged: (listener: Listener<TodoItem[]>): (() => void) => onPayload('todos:changed', listener)
  },
  schedules: {
    list: (): Promise<ScheduledTodoRule[]> => ipcRenderer.invoke('schedules:list'),
    create: (input: ScheduledTodoInput): Promise<ScheduledTodoRule> => ipcRenderer.invoke('schedules:create', input),
    update: (id: string, input: ScheduledTodoInput): Promise<ScheduledTodoRule> =>
      ipcRenderer.invoke('schedules:update', id, input),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('schedules:delete', id),
    setEnabled: (id: string, enabled: boolean): Promise<ScheduledTodoRule> =>
      ipcRenderer.invoke('schedules:setEnabled', id, enabled),
    exportJson: (): Promise<void> => ipcRenderer.invoke('schedules:exportJson'),
    importJson: (): Promise<ImportResult | undefined> => ipcRenderer.invoke('schedules:importJson'),
    onChanged: (listener: Listener<ScheduledTodoRule[]>): (() => void) => onPayload('schedules:changed', listener)
  },
  pets: {
    list: (): Promise<PetPackage[]> => ipcRenderer.invoke('pets:list'),
    select: (id: string): Promise<PetPackage | undefined> => ipcRenderer.invoke('pets:select', id),
    importZip: (path?: string): Promise<PetPackage | undefined> => ipcRenderer.invoke('pets:importZip', path),
    reload: (): Promise<PetPackage[]> => ipcRenderer.invoke('pets:reload'),
    onChanged: (listener: Listener<PetPackage[]>): (() => void) => onPayload('pets:changed', listener)
  },
  ui: {
    showPetMenu: (point: { x: number; y: number }): Promise<void> => ipcRenderer.invoke('ui:showPetMenu', point),
    showTodoMenu: (payload: { point: { x: number; y: number }; item: TodoItem }): Promise<void> =>
      ipcRenderer.invoke('ui:showTodoMenu', payload),
    onToggleTodoPanel: (listener: Listener<void>): (() => void) => onPayload('ui:toggleTodoPanel', listener),
    onToggleSchedulePanel: (listener: Listener<void>): (() => void) => onPayload('ui:toggleSchedulePanel', listener),
    onSelectPet: (listener: Listener<string>): (() => void) => onPayload('ui:selectPet', listener),
    onTodoAction: (listener: Listener<TodoMenuAction>): (() => void) => onPayload('ui:todoAction', listener)
  },
  window: {
    moveBy: (deltaX: number, deltaY: number): Promise<void> => ipcRenderer.invoke('window:moveBy', deltaX, deltaY),
    quit: (): Promise<void> => ipcRenderer.invoke('window:quit')
  }
});
