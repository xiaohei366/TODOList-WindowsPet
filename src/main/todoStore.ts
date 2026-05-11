import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TodoItem } from '../shared/types';

type ParsedTodo = TodoItem & {
  order: number;
};

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function selectVisibleTodos(items: TodoItem[], todayKey: string): TodoItem[] {
  const withOverdue = items.map((item) => ({
    ...item,
    overdue: !item.completed && item.date < todayKey
  }));
  const overdue = withOverdue
    .filter((item) => item.overdue)
    .sort((left, right) => left.date.localeCompare(right.date) || left.sourceLine - right.sourceLine);
  const today = withOverdue.filter((item) => item.date === todayKey);
  return [...overdue, ...today];
}

export function parseTodoMarkdown(content: string, todayKey: string): ParsedTodo[] {
  const lines = content.split(/\r?\n/);
  const items: ParsedTodo[] = [];
  let currentDate: string | undefined;

  lines.forEach((line, index) => {
    const heading = /^###\s+(\d{4}-\d{2}-\d{2})(?:\s+.*)?$/.exec(line.trim());
    if (heading) {
      currentDate = heading[1];
      return;
    }

    if (!currentDate) {
      return;
    }

    const todo = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (!todo) {
      return;
    }

    const completed = todo[1].toLowerCase() === 'x';
    const parsed = parseTodoBody(todo[2], completed);
    const sourceLine = index + 1;
    const order = items.length;
    items.push({
      id: createTodoId(currentDate, sourceLine, parsed.text, completed, parsed.highlighted),
      date: currentDate,
      text: parsed.text,
      completed,
      highlighted: parsed.highlighted,
      overdue: !completed && currentDate < todayKey,
      sourceLine,
      order
    });
  });

  return items;
}

export function renderTodoMarkdown(items: TodoItem[]): string {
  const sortedDates = Array.from(new Set(items.map((item) => item.date))).sort();
  const lines: string[] = [];

  let renderedYear = '';
  let renderedMonth = '';

  for (const date of sortedDates) {
    const year = date.slice(0, 4);
    const month = date.slice(0, 7);
    const dayItems = items.filter((item) => item.date === date);
    const orderedDayItems = [
      ...dayItems.filter((item) => !item.completed),
      ...dayItems.filter((item) => item.completed)
    ];

    if (renderedYear !== year) {
      if (lines.length > 0 && lines.at(-1) !== '') {
        lines.push('');
      }
      lines.push(`# ${year}`, '');
      renderedYear = year;
      renderedMonth = '';
    }

    if (renderedMonth !== month) {
      lines.push(`## ${month}`, '');
      renderedMonth = month;
    }

    lines.push(`### ${date} ${weekdayName(date)}`, '');
    for (const item of orderedDayItems) {
      lines.push(formatTodoLine(item));
    }
    lines.push('');
  }

  return lines.length === 0 ? '' : lines.join('\n');
}

export class TodoMarkdownStore {
  constructor(
    private readonly filePath: string,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async list(): Promise<TodoItem[]> {
    return selectVisibleTodos(await this.listAll(), formatDateKey(this.clock()));
  }

  async listAll(): Promise<TodoItem[]> {
    return this.readItems();
  }

  async add(text: string): Promise<TodoItem> {
    const cleaned = cleanTodoText(text);
    if (!cleaned) {
      throw new Error('Todo text is required.');
    }

    const date = formatDateKey(this.clock());
    const items = await this.readItems();
    items.push({
      id: '',
      date,
      text: cleaned,
      completed: false,
      highlighted: false,
      overdue: false,
      sourceLine: 0,
      order: items.length
    });
    await this.writeItems(items);
    const updated = await this.readItems();
    const created = [...updated].reverse().find((item) => item.date === date && item.text === cleaned);
    if (!created) {
      throw new Error('Failed to create todo.');
    }
    return created;
  }

  async delete(id: string): Promise<void> {
    const items = await this.readItems();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) {
      throw new Error('Todo not found.');
    }
    await this.writeItems(next);
  }

  async setCompleted(id: string, completed: boolean): Promise<TodoItem> {
    const items = await this.readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error('Todo not found.');
    }

    const target = { ...items[index], completed };
    const next = items.filter((item) => item.id !== id);
    next.push(target);
    await this.writeItems(next);
    return this.findUpdated(target);
  }

  async setHighlighted(id: string, highlighted: boolean): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const next = items.map((item) => (item.id === id ? { ...item, highlighted } : item));
    await this.writeItems(next);
    return this.findUpdated({ ...target, highlighted });
  }

  async reorder(date: string, ids: string[]): Promise<TodoItem[]> {
    const items = await this.readItems();
    const dayItems = items.filter((item) => item.date === date);
    const active = dayItems.filter((item) => !item.completed);
    const completed = dayItems.filter((item) => item.completed);
    const byId = new Map(active.map((item) => [item.id, item]));
    const reorderedActive = ids.map((id) => byId.get(id)).filter((item): item is ParsedTodo => Boolean(item));
    const missingActive = active.filter((item) => !ids.includes(item.id));
    const nextDay = [...reorderedActive, ...missingActive, ...completed];
    const next = [...items.filter((item) => item.date !== date), ...nextDay];

    await this.writeItems(next);
    return this.list();
  }

  async openPath(): Promise<string> {
    await this.ensureParent();
    try {
      await readFile(this.filePath, 'utf8');
    } catch {
      await writeFile(this.filePath, '', 'utf8');
    }
    return this.filePath;
  }

  private async findUpdated(target: TodoItem): Promise<TodoItem> {
    const updated = await this.readItems();
    const match = updated.find(
      (item) =>
        item.date === target.date &&
        item.text === target.text &&
        item.completed === target.completed &&
        item.highlighted === target.highlighted
    );
    if (!match) {
      throw new Error('Updated todo not found.');
    }
    return match;
  }

  private async readItems(): Promise<ParsedTodo[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return parseTodoMarkdown(content, formatDateKey(this.clock()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeItems(items: TodoItem[]): Promise<void> {
    await this.ensureParent();
    await writeFile(this.filePath, renderTodoMarkdown(items), 'utf8');
  }

  private async ensureParent(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
  }
}

function parseTodoBody(rawBody: string, completed: boolean): { highlighted: boolean; text: string } {
  let body = rawBody.trim();
  let highlighted = false;

  if (/^\[!\](?:\s+|$)/.test(body)) {
    highlighted = true;
    body = body.replace(/^\[!\]\s*/, '');
  }

  if (completed && body.startsWith('~~') && body.endsWith('~~') && body.length >= 4) {
    body = body.slice(2, -2);
  }

  return { highlighted, text: body.trim() };
}

function formatTodoLine(item: TodoItem): string {
  const checkbox = item.completed ? 'x' : ' ';
  const marker = item.highlighted ? '[!] ' : '';
  const text = item.completed ? `~~${item.text}~~` : item.text;
  return `- [${checkbox}] ${marker}${text}`;
}

function cleanTodoText(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function weekdayName(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(year, month - 1, day));
}

function createTodoId(
  date: string,
  sourceLine: number,
  text: string,
  completed: boolean,
  highlighted: boolean
): string {
  return `${date}:${sourceLine}:${hash(`${date}\0${sourceLine}\0${text}\0${completed}\0${highlighted}`)}`;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16);
}
