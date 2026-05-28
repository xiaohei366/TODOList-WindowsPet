import type { ScheduledTodoInput, ScheduledTodoRule } from '../../shared/types';

export const weekdayOptions = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' }
];

export type ScheduleFormState = {
  kind: 'weekly' | 'one-time';
  enabled: boolean;
  text: string;
  hour: string;
  minute: string;
  weekdays: number[];
  year: string;
  month: string;
  day: string;
};

export function createEmptyScheduleForm(): ScheduleFormState {
  return {
    kind: 'weekly',
    enabled: true,
    text: '',
    hour: '',
    minute: '',
    weekdays: [1, 2, 3, 4, 5],
    year: '',
    month: '',
    day: ''
  };
}

export function createDefaultScheduleForm(now = new Date()): ScheduleFormState {
  return {
    ...createEmptyScheduleForm(),
    hour: String(now.getHours()).padStart(2, '0'),
    minute: String(now.getMinutes()).padStart(2, '0'),
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0')
  };
}

export function scheduleRuleToForm(rule: ScheduledTodoRule): ScheduleFormState {
  const dateParts = rule.kind === 'one-time' ? rule.date.split('-') : ['', '', ''];
  return {
    kind: rule.kind,
    enabled: rule.enabled,
    text: rule.text,
    hour: String(rule.hour).padStart(2, '0'),
    minute: String(rule.minute).padStart(2, '0'),
    weekdays: rule.kind === 'weekly' ? rule.weekdays : [1, 2, 3, 4, 5],
    year: dateParts[0],
    month: dateParts[1],
    day: dateParts[2]
  };
}

export function buildScheduleInput(form: ScheduleFormState, now = new Date()): ScheduledTodoInput {
  const text = form.text.trim();
  if (!text) {
    throw new Error('TODO 内容必填。');
  }
  const hour = parseRequiredNumber(form.hour, 0, 23, '小时需为 0-23。');
  const minute = parseRequiredNumber(form.minute, 0, 59, '分钟需为 0-59。');

  if (form.kind === 'weekly') {
    return {
      kind: 'weekly',
      enabled: form.enabled,
      text,
      hour,
      minute,
      weekdays: form.weekdays.length > 0 ? form.weekdays : [1, 2, 3, 4, 5]
    };
  }

  const year = parseOptionalNumber(form.year, 1, 9999, '年份无效。');
  const month = parseOptionalNumber(form.month, 1, 12, '月份需为 1-12。');
  const resolvedYear = year ?? now.getFullYear();
  const resolvedMonth = month ?? now.getMonth() + 1;
  const maxDay = daysInMonth(resolvedYear, resolvedMonth);
  const day = parseOptionalNumber(form.day, 1, maxDay, `日期需为 1-${maxDay}。`);

  return {
    kind: 'one-time',
    enabled: form.enabled,
    text,
    hour,
    minute,
    year,
    month,
    day
  };
}

export function getScheduleFormMaxDay(form: ScheduleFormState, now = new Date()): number {
  const year = parseOptionalDatePart(form.year, 1, 9999) ?? now.getFullYear();
  const month = parseOptionalDatePart(form.month, 1, 12) ?? now.getMonth() + 1;
  return daysInMonth(year, month);
}

export function formatScheduleSummary(rule: ScheduledTodoRule): string {
  const time = `${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`;
  if (rule.kind === 'one-time') {
    return `${rule.date} ${time}`;
  }
  return `每周 ${rule.weekdays.map((day) => weekdayOptions.find((weekday) => weekday.value === day)?.label ?? day).join('')} ${time}`;
}

function parseRequiredNumber(value: string, min: number, max: number, message: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(message);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(message);
  }
  return parsed;
}

function parseOptionalNumber(value: string, min: number, max: number, message: string): number | null {
  if (!value.trim()) {
    return null;
  }
  return parseRequiredNumber(value, min, max, message);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseOptionalDatePart(value: string, min: number, max: number): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}
