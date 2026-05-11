import type { PetPackage, TodoItem, TodoMenuAction } from '../../shared/types';

declare global {
  interface Window {
    todoPet: {
      todos: {
        list: () => Promise<TodoItem[]>;
        add: (text: string) => Promise<TodoItem>;
        delete: (id: string) => Promise<void>;
        setCompleted: (id: string, completed: boolean) => Promise<TodoItem>;
        setHighlighted: (id: string, highlighted: boolean) => Promise<TodoItem>;
        reorder: (date: string, ids: string[]) => Promise<TodoItem[]>;
        openSource: () => Promise<void>;
        onChanged: (listener: (items: TodoItem[]) => void) => () => void;
      };
      pets: {
        list: () => Promise<PetPackage[]>;
        select: (id: string) => Promise<PetPackage | undefined>;
        importZip: (path?: string) => Promise<PetPackage | undefined>;
        reload: () => Promise<PetPackage[]>;
        onChanged: (listener: (pets: PetPackage[]) => void) => () => void;
      };
      ui: {
        showPetMenu: (point: { x: number; y: number }) => Promise<void>;
        showTodoMenu: (payload: { point: { x: number; y: number }; item: TodoItem }) => Promise<void>;
        onToggleTodoPanel: (listener: () => void) => () => void;
        onSelectPet: (listener: (id: string) => void) => () => void;
        onTodoAction: (listener: (action: TodoMenuAction) => void) => () => void;
      };
      window: {
        moveBy: (deltaX: number, deltaY: number) => Promise<void>;
        quit: () => Promise<void>;
      };
    };
  }
}

export {};
