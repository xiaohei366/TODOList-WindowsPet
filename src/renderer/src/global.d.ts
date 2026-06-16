import type { PetPackage, ScheduledTodoInput, ScheduledTodoRule, TodoItem, TodoMenuAction } from '../../shared/types';
import type { AppLanguage } from '../../shared/i18n';

declare global {
  interface Window {
    todoPet: {
      todos: {
        list: () => Promise<TodoItem[]>;
        add: (text: string) => Promise<TodoItem>;
        delete: (id: string) => Promise<void>;
        setCompleted: (id: string, completed: boolean) => Promise<TodoItem>;
        setHighlighted: (id: string, highlighted: boolean) => Promise<TodoItem>;
        updateText: (id: string, text: string) => Promise<TodoItem>;
        updateNotes: (id: string, notes: string) => Promise<TodoItem>;
        reorder: (date: string, ids: string[]) => Promise<TodoItem[]>;
        reorderVisible: (ids: string[]) => Promise<TodoItem[]>;
        openSource: () => Promise<void>;
        onChanged: (listener: (items: TodoItem[]) => void) => () => void;
      };
      schedules: {
        list: () => Promise<ScheduledTodoRule[]>;
        create: (input: ScheduledTodoInput) => Promise<ScheduledTodoRule>;
        update: (id: string, input: ScheduledTodoInput) => Promise<ScheduledTodoRule>;
        delete: (id: string) => Promise<void>;
        setEnabled: (id: string, enabled: boolean) => Promise<ScheduledTodoRule>;
        onChanged: (listener: (rules: ScheduledTodoRule[]) => void) => () => void;
      };
      pets: {
        list: () => Promise<PetPackage[]>;
        select: (id: string) => Promise<PetPackage | undefined>;
        importZip: (path?: string) => Promise<PetPackage | undefined>;
        reload: () => Promise<PetPackage[]>;
        onChanged: (listener: (pets: PetPackage[]) => void) => () => void;
      };
      settings: {
        getLanguage: () => Promise<AppLanguage>;
        setLanguage: (language: AppLanguage) => Promise<AppLanguage>;
        onLanguageChanged: (listener: (language: AppLanguage) => void) => () => void;
      };
      ui: {
        showPetMenu: (point: { x: number; y: number }) => Promise<void>;
        showTodoMenu: (payload: { point: { x: number; y: number }; item: TodoItem }) => Promise<void>;
        onToggleTodoPanel: (listener: () => void) => () => void;
        onToggleSchedulePanel: (listener: () => void) => () => void;
        onSelectPet: (listener: (id: string) => void) => () => void;
        onTodoAction: (listener: (action: TodoMenuAction) => void) => () => void;
      };
      window: {
        moveBy: (deltaX: number, deltaY: number) => Promise<void>;
        startDrag: (screenX: number, screenY: number) => void;
        moveDrag: (screenX: number, screenY: number) => void;
        endDrag: () => void;
        setMousePassthrough: (ignore: boolean) => Promise<void>;
        quit: () => Promise<void>;
      };
    };
  }
}

export {};
