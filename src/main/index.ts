import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  shell,
  Tray
} from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TodoMarkdownStore } from './todoStore';
import { PetRegistry } from './petRegistry';
import { getAppPaths } from './paths';
import type { PetPackage, TodoItem, TodoMenuAction } from '../shared/types';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'todolist-pet',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let todoWatch: FSWatcher | undefined;
let todoStore: TodoMarkdownStore;
let petRegistry: PetRegistry;

const currentDir = dirname(fileURLToPath(import.meta.url));

function getBundledAssetPath(fileName: string): string {
  return join(currentDir, '../../build', fileName);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 430,
    minWidth: 360,
    minHeight: 360,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: getBundledAssetPath('icon.png'),
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(currentDir, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function createTrayIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(getBundledAssetPath('icon.png')).resize({ width: 16, height: 16 });
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('TOList Desktop Pet');
  tray.on('double-click', () => toggleMainWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show / Hide',
        click: () => toggleMainWindow()
      },
      {
        label: 'Open TODO Markdown',
        click: async () => {
          await openTodoSource();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit TOList Desktop Pet',
        click: () => app.quit()
      }
    ])
  );
}

function toggleMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }
  mainWindow.show();
}

async function startTodoWatch(): Promise<void> {
  todoWatch?.close();
  const filePath = await todoStore.openPath();
  let timer: NodeJS.Timeout | undefined;
  todoWatch = watch(filePath, { persistent: false }, () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void sendTodosChanged();
    }, 100);
  });
}

async function sendTodosChanged(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('todos:changed', await todoStore.list());
}

async function sendPetsChanged(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('pets:changed', await listPetsWithUrls());
}

async function openTodoSource(): Promise<void> {
  const filePath = await todoStore.openPath();
  await shell.openPath(filePath);
}

async function importPetZip(zipPath?: string): Promise<PetPackage | undefined> {
  let selectedPath = zipPath;
  if (!selectedPath) {
    const result = await dialog.showOpenDialog({
      title: 'Import Codex Pet Zip',
      filters: [{ name: 'Zip files', extensions: ['zip'] }],
      properties: ['openFile']
    });
    selectedPath = result.filePaths[0];
  }
  if (!selectedPath) {
    return undefined;
  }
  const pet = await petRegistry.importZip(selectedPath);
  await sendPetsChanged();
  return { ...pet, spritesheetUrl: `todolist-pet://${encodeURIComponent(pet.id)}/spritesheet.webp` };
}

async function listPetsWithUrls(): Promise<PetPackage[]> {
  return (await petRegistry.list()).map((pet) => ({
    ...pet,
    spritesheetUrl: `todolist-pet://${encodeURIComponent(pet.id)}/spritesheet.webp`
  }));
}

async function showPetMenu(point?: { x: number; y: number }): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const pets = await listPetsWithUrls();
  const selectedPetId = await mainWindow.webContents.executeJavaScript(
    "localStorage.getItem('tolist:selected-pet')",
    true
  ) as string | null;
  const petItems: Electron.MenuItemConstructorOptions[] =
    pets.length > 0
      ? pets.map((pet) => ({
          label: pet.displayName,
          type: 'radio',
          checked: selectedPetId === pet.id,
          click: () => mainWindow?.webContents.send('ui:selectPet', pet.id)
        }))
      : [{ label: 'No pets found', enabled: false }];
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide TODO Panel',
      click: () => mainWindow?.webContents.send('ui:toggleTodoPanel')
    },
    {
      label: 'Open Markdown',
      click: async () => {
        await openTodoSource();
      }
    },
    {
      label: 'Import Pet Zip',
      click: async () => {
        await importPetZip();
      }
    },
    {
      label: 'Refresh Pets',
      click: async () => {
        await sendPetsChanged();
      }
    },
    { type: 'separator' },
    {
      label: 'Switch Pet',
      submenu: petItems
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);

  menu.popup({ window: mainWindow, x: point?.x, y: point?.y });
}

function sendTodoMenuAction(action: TodoMenuAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('ui:todoAction', action);
}

function showTodoMenu(payload: { point?: { x: number; y: number }; item: TodoItem }): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const { item, point } = payload;
  const menu = Menu.buildFromTemplate([
    {
      label: item.completed ? 'Mark Active' : 'Mark Done',
      click: () => sendTodoMenuAction({ type: 'toggle-completed', id: item.id })
    },
    {
      label: item.highlighted ? 'Unmark Red' : 'Mark Red',
      click: () => sendTodoMenuAction({ type: 'toggle-highlighted', id: item.id })
    },
    {
      label: 'Adjust Priority',
      enabled: !item.completed,
      submenu: [
        {
          label: 'Move Up',
          click: () => sendTodoMenuAction({ type: 'move-up', id: item.id })
        },
        {
          label: 'Move Down',
          click: () => sendTodoMenuAction({ type: 'move-down', id: item.id })
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Delete',
      click: () => sendTodoMenuAction({ type: 'delete', id: item.id })
    }
  ]);

  menu.popup({ window: mainWindow, x: point?.x, y: point?.y });
}

function registerPetProtocol(): void {
  protocol.handle('todolist-pet', async (request) => {
    const id = decodeURIComponent(new URL(request.url).hostname);
    const pet = await petRegistry.findById(id);
    if (!pet) {
      return new Response('Pet not found.', { status: 404 });
    }
    return net.fetch(pathToFileURL(pet.spritesheetPath).toString());
  });
}

function registerIpc(): void {
  ipcMain.handle('todos:list', async () => todoStore.list());
  ipcMain.handle('todos:add', async (_event, text: string) => {
    const item = await todoStore.add(text);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:delete', async (_event, id: string) => {
    await todoStore.delete(id);
    await sendTodosChanged();
  });
  ipcMain.handle('todos:setCompleted', async (_event, id: string, completed: boolean) => {
    const item = await todoStore.setCompleted(id, completed);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:setHighlighted', async (_event, id: string, highlighted: boolean) => {
    const item = await todoStore.setHighlighted(id, highlighted);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:reorder', async (_event, date: string, ids: string[]) => {
    const items = await todoStore.reorder(date, ids);
    await sendTodosChanged();
    return items;
  });
  ipcMain.handle('todos:openSource', async () => {
    await openTodoSource();
  });

  ipcMain.handle('pets:list', async () => listPetsWithUrls());
  ipcMain.handle('pets:select', async (_event, id: string) => petRegistry.findById(id));
  ipcMain.handle('pets:reload', async () => {
    const pets = await listPetsWithUrls();
    await sendPetsChanged();
    return pets;
  });
  ipcMain.handle('pets:importZip', async (_event, zipPath?: string) => {
    return importPetZip(zipPath);
  });
  ipcMain.handle('ui:showPetMenu', async (_event, point?: { x: number; y: number }) => showPetMenu(point));
  ipcMain.handle('ui:showTodoMenu', (_event, payload: { point?: { x: number; y: number }; item: TodoItem }) =>
    showTodoMenu(payload)
  );

  ipcMain.handle('window:moveBy', (event, deltaX: number, deltaY: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    const [x, y] = window.getPosition();
    window.setPosition(Math.round(x + deltaX), Math.round(y + deltaY), false);
  });
  ipcMain.handle('window:quit', () => app.quit());
}

app.whenReady().then(async () => {
  const paths = getAppPaths();
  todoStore = new TodoMarkdownStore(paths.todoFile);
  petRegistry = new PetRegistry({
    codexPets: paths.codexPets,
    appPets: paths.appPets,
    packageRoot: paths.packageRoot
  });

  registerPetProtocol();
  registerIpc();
  createWindow();
  createTray();
  await startTodoWatch();
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  todoWatch?.close();
});
