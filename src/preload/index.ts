import { contextBridge, ipcRenderer } from 'electron';
import type { PetPackage, TodoItem } from '../shared/types';

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
    reorder: (date: string, ids: string[]): Promise<TodoItem[]> => ipcRenderer.invoke('todos:reorder', date, ids),
    openSource: (): Promise<void> => ipcRenderer.invoke('todos:openSource'),
    onChanged: (listener: Listener<TodoItem[]>): (() => void) => onPayload('todos:changed', listener)
  },
  pets: {
    list: (): Promise<PetPackage[]> => ipcRenderer.invoke('pets:list'),
    select: (id: string): Promise<PetPackage | undefined> => ipcRenderer.invoke('pets:select', id),
    importZip: (path?: string): Promise<PetPackage | undefined> => ipcRenderer.invoke('pets:importZip', path),
    reload: (): Promise<PetPackage[]> => ipcRenderer.invoke('pets:reload'),
    onChanged: (listener: Listener<PetPackage[]>): (() => void) => onPayload('pets:changed', listener)
  },
  window: {
    moveBy: (deltaX: number, deltaY: number): Promise<void> => ipcRenderer.invoke('window:moveBy', deltaX, deltaY),
    quit: (): Promise<void> => ipcRenderer.invoke('window:quit')
  }
});
