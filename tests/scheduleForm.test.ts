import { describe, expect, test } from 'vitest';
import { buildScheduleInput, createEmptyScheduleForm, getScheduleFormMaxDay, weekdayOptions } from '../src/renderer/src/scheduleForm';

describe('schedule form helpers', () => {
  test('uses numeric weekday labels for the compact weekday picker', () => {
    expect(weekdayOptions.map((weekday) => weekday.label)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  test('rejects impossible calendar dates before sending schedule input', () => {
    const form = {
      ...createEmptyScheduleForm(),
      kind: 'one-time' as const,
      text: 'Leap day check',
      hour: '9',
      minute: '30',
      year: '2026',
      month: '2',
      day: '29'
    };

    expect(() => buildScheduleInput(form)).toThrow('Day must be 1-28.');
  });

  test('rejects out-of-range schedule time', () => {
    expect(() =>
      buildScheduleInput({ ...createEmptyScheduleForm(), text: 'Bad hour', hour: '24', minute: '0' })
    ).toThrow('Hour must be 0-23.');
    expect(() =>
      buildScheduleInput({ ...createEmptyScheduleForm(), text: 'Bad minute', hour: '23', minute: '60' })
    ).toThrow('Minute must be 0-59.');
  });

  test('computes max day from the selected year and month', () => {
    expect(getScheduleFormMaxDay({ ...createEmptyScheduleForm(), year: '2026', month: '2' })).toBe(28);
    expect(getScheduleFormMaxDay({ ...createEmptyScheduleForm(), year: '2028', month: '2' })).toBe(29);
  });
});
