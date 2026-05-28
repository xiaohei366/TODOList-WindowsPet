import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
  Tray
} from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TodoMarkdownStore } from './todoStore';
import { PetRegistry } from './petRegistry';
import { getAppPaths } from './paths';
import { getNextScheduledRunDate, runDueScheduledTodos, ScheduledTodoStore } from './scheduledTodos';
import { keepPetWindowOnTop, setPetWindowMousePassthrough } from './windowLayering';
import { constrainWindowPosition } from './windowBounds';
import type { ImportResult, PetPackage, ScheduledTodoInput, TodoItem, TodoMenuAction } from '../shared/types';

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
let scheduledTodoStore: ScheduledTodoStore;
let scheduledTodoTimer: NodeJS.Timeout | undefined;
let petRegistry: PetRegistry;

const currentDir = dirname(fileURLToPath(import.meta.url));

function getBundledAssetPath(fileName: string): string {
  return join(currentDir, '../../build', fileName);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 720,
    minWidth: 680,
    minHeight: 720,
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

  keepPetWindowOnTop(mainWindow);
  setPetWindowMousePassthrough(mainWindow, true);

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(currentDir, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  mainWindow.on('show', () => {
    if (mainWindow) {
      keepPetWindowOnTop(mainWindow);
    }
  });
  mainWindow.on('restore', () => {
    if (mainWindow) {
      keepPetWindowOnTop(mainWindow);
    }
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
        label: '显示/隐藏',
        click: () => toggleMainWindow()
      },
      {
        label: '打开 TODO Markdown',
        click: async () => {
          await openTodoSource();
        }
      },
      { type: 'separator' },
      {
        label: '退出 TOList 桌宠',
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
  keepPetWindowOnTop(mainWindow);
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

async function sendSchedulesChanged(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('schedules:changed', await scheduledTodoStore.list());
}

async function openTodoSource(): Promise<void> {
  const filePath = await todoStore.openPath();
  await shell.openPath(filePath);
}

async function exportTodoMarkdown(): Promise<void> {
  const source = await todoStore.openPath();
  const result = await dialog.showSaveDialog({
    title: '导出 TODO Markdown',
    defaultPath: 'todos.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) {
    return;
  }
  await copyFile(source, result.filePath);
}

async function importTodoMarkdown(): Promise<ImportResult | undefined> {
  const result = await dialog.showOpenDialog({
    title: '导入 TODO Markdown',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile']
  });
  const selectedPath = result.filePaths[0];
  if (!selectedPath) {
    return undefined;
  }
  const imported = await todoStore.importMarkdown(selectedPath);
  await sendTodosChanged();
  return imported;
}

async function exportScheduledJson(): Promise<void> {
  const result = await dialog.showSaveDialog({
    title: '导出定时 JSON',
    defaultPath: 'scheduled-todos.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) {
    return;
  }
  await scheduledTodoStore.exportJson(result.filePath);
}

async function importScheduledJson(): Promise<ImportResult | undefined> {
  const result = await dialog.showOpenDialog({
    title: '导入定时 JSON',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  const selectedPath = result.filePaths[0];
  if (!selectedPath) {
    return undefined;
  }
  const imported = await scheduledTodoStore.importJson(selectedPath);
  await afterScheduleMutation(true);
  return imported;
}

async function importPetZip(zipPath?: string): Promise<PetPackage | undefined> {
  let selectedPath = zipPath;
  if (!selectedPath) {
    const result = await dialog.showOpenDialog({
      title: '导入 Codex 宠物 Zip',
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
      : [{ label: '未找到宠物', enabled: false }];
  const menu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏 TODO 面板',
      click: () => mainWindow?.webContents.send('ui:toggleTodoPanel')
    },
    {
      label: '定时 TODO',
      click: () => mainWindow?.webContents.send('ui:toggleSchedulePanel')
    },
    { type: 'separator' },
    {
      label: '打开 Markdown',
      click: async () => {
        await openTodoSource();
      }
    },
    {
      label: '导出 TODO Markdown',
      click: async () => {
        await exportTodoMarkdown();
      }
    },
    {
      label: '导入 TODO Markdown',
      click: async () => {
        await importTodoMarkdown();
      }
    },
    {
      label: '导出定时 JSON',
      click: async () => {
        await exportScheduledJson();
      }
    },
    {
      label: '导入定时 JSON',
      click: async () => {
        await importScheduledJson();
      }
    },
    { type: 'separator' },
    {
      label: '切换宠物风格',
      submenu: petItems
    },
    { type: 'separator' },
    {
      label: '导入宠物 Zip',
      click: async () => {
        await importPetZip();
      }
    },
    {
      label: '刷新宠物',
      click: async () => {
        await sendPetsChanged();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
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
      label: '编辑',
      click: () => sendTodoMenuAction({ type: 'edit', id: item.id })
    },
    {
      label: item.completed ? '标记未完成' : '标记完成',
      click: () => sendTodoMenuAction({ type: 'toggle-completed', id: item.id })
    },
    {
      label: item.highlighted ? '取消标红' : '标红',
      click: () => sendTodoMenuAction({ type: 'toggle-highlighted', id: item.id })
    },
    {
      label: '调整优先级',
      enabled: !item.completed,
      submenu: [
        {
          label: '上移',
          click: () => sendTodoMenuAction({ type: 'move-up', id: item.id })
        },
        {
          label: '下移',
          click: () => sendTodoMenuAction({ type: 'move-down', id: item.id })
        }
      ]
    },
    { type: 'separator' },
    {
      label: '删除',
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
  ipcMain.handle('todos:updateText', async (_event, id: string, text: string) => {
    const item = await todoStore.updateText(id, text);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:reorder', async (_event, date: string, ids: string[]) => {
    const items = await todoStore.reorder(date, ids);
    await sendTodosChanged();
    return items;
  });
  ipcMain.handle('todos:reorderVisible', async (_event, ids: string[]) => {
    const items = await todoStore.reorderVisible(ids);
    await sendTodosChanged();
    return items;
  });
  ipcMain.handle('todos:exportMarkdown', async () => {
    await exportTodoMarkdown();
  });
  ipcMain.handle('todos:importMarkdown', async () => {
    return importTodoMarkdown();
  });
  ipcMain.handle('todos:openSource', async () => {
    await openTodoSource();
  });

  ipcMain.handle('schedules:list', async () => scheduledTodoStore.list());
  ipcMain.handle('schedules:create', async (_event, input: ScheduledTodoInput) => {
    const rule = await scheduledTodoStore.create(input);
    await afterScheduleMutation(true);
    return rule;
  });
  ipcMain.handle('schedules:update', async (_event, id: string, input: ScheduledTodoInput) => {
    const rule = await scheduledTodoStore.update(id, input);
    await afterScheduleMutation(true);
    return rule;
  });
  ipcMain.handle('schedules:delete', async (_event, id: string) => {
    await scheduledTodoStore.delete(id);
    await afterScheduleMutation(false);
  });
  ipcMain.handle('schedules:setEnabled', async (_event, id: string, enabled: boolean) => {
    const rule = await scheduledTodoStore.setEnabled(id, enabled);
    await afterScheduleMutation(true);
    return rule;
  });
  ipcMain.handle('schedules:exportJson', async () => {
    await exportScheduledJson();
  });
  ipcMain.handle('schedules:importJson', async () => {
    return importScheduledJson();
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
    const bounds = window.getBounds();
    const proposed = {
      x: Math.round(bounds.x + deltaX),
      y: Math.round(bounds.y + deltaY)
    };
    const display = screen.getDisplayMatching({ ...bounds, ...proposed });
    const next = constrainWindowPosition(proposed, bounds, display.workArea);
    window.setPosition(next.x, next.y, false);
    keepPetWindowOnTop(window);
  });
  ipcMain.handle('window:setMousePassthrough', (event, ignore: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    setPetWindowMousePassthrough(window, ignore);
  });
  ipcMain.handle('window:quit', () => app.quit());
}

async function runScheduledTodoCheck(): Promise<void> {
  const generated = await runDueScheduledTodos(scheduledTodoStore, todoStore);
  if (generated > 0) {
    await sendTodosChanged();
  }
  await sendSchedulesChanged();
}

async function handleScheduledTodoTimer(): Promise<void> {
  try {
    await runScheduledTodoCheck();
  } finally {
    await refreshScheduledTodoTimer();
  }
}

async function afterScheduleMutation(runDueNow: boolean): Promise<void> {
  if (runDueNow) {
    await runScheduledTodoCheck();
  } else {
    await sendSchedulesChanged();
  }
  await refreshScheduledTodoTimer();
}

async function refreshScheduledTodoTimer(): Promise<void> {
  if (scheduledTodoTimer) {
    clearTimeout(scheduledTodoTimer);
    scheduledTodoTimer = undefined;
  }

  const nextRun = getNextScheduledRunDate(await scheduledTodoStore.list());
  if (!nextRun) {
    return;
  }

  const delay = Math.max(1000, nextRun.getTime() - Date.now() + 1000);
  scheduledTodoTimer = setTimeout(() => {
    void handleScheduledTodoTimer();
  }, Math.min(delay, 2_147_483_647));
}

app.whenReady().then(async () => {
  const paths = getAppPaths();
  todoStore = new TodoMarkdownStore(paths.todoFile);
  scheduledTodoStore = new ScheduledTodoStore(paths.scheduledTodosFile);
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
  await runScheduledTodoCheck();
  await refreshScheduledTodoTimer();
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  todoWatch?.close();
  if (scheduledTodoTimer) {
    clearTimeout(scheduledTodoTimer);
  }
});
