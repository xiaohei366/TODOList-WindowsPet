export type TodoItem = {
  id: string;
  date: string;
  text: string;
  completed: boolean;
  highlighted: boolean;
  overdue: boolean;
  displayOrder?: number;
  sourceLine: number;
};

export type TodoMenuActionType =
  | 'toggle-completed'
  | 'toggle-highlighted'
  | 'delete'
  | 'move-up'
  | 'move-down';

export type TodoMenuAction = {
  type: TodoMenuActionType;
  id: string;
};

export type PetSource = 'app' | 'codex' | 'npm';

export type PetPackage = {
  id: string;
  displayName: string;
  description: string;
  kind?: string;
  directory: string;
  spritesheetPath: string;
  spritesheetUrl?: string;
  source: PetSource;
};

export type PetState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export type AnimationSpec = {
  state: PetState;
  row: number;
  frameCount: number;
  durations: number[];
};
