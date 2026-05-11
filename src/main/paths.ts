import { app } from 'electron';
import { join } from 'node:path';

export type AppPaths = {
  todoFile: string;
  codexPets: string;
  appPets: string;
  packageRoot: string;
};

export function getAppPaths(): AppPaths {
  const appDataRoot = join(app.getPath('appData'), 'TOList');
  return {
    todoFile: join(app.getPath('documents'), 'TOList', 'todos.md'),
    codexPets: join(app.getPath('home'), '.codex', 'pets'),
    appPets: join(appDataRoot, 'pets'),
    packageRoot: join(appDataRoot, 'pet-packages')
  };
}
