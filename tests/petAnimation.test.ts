import { describe, expect, test } from 'vitest';
import {
  getAnimationSpec,
  getInteractivePetState,
  getPetSpriteStyle,
  getTodoDrivenPetState
} from '../src/renderer/src/petAnimation';
import type { TodoItem } from '../src/shared/types';

describe('petAnimation helpers', () => {
  test('uses Codex atlas row and duration metadata for review state', () => {
    expect(getAnimationSpec('review')).toMatchObject({
      row: 8,
      frameCount: 6,
      durations: [240, 240, 240, 240, 240, 448]
    });
  });

  test('plays pet animations at a calmer desktop-pet cadence', () => {
    expect(Math.min(...getAnimationSpec('running').durations)).toBeGreaterThanOrEqual(190);
    expect(Math.min(...getAnimationSpec('review').durations)).toBeGreaterThanOrEqual(240);
    expect(Math.max(...getAnimationSpec('idle').durations)).toBeGreaterThanOrEqual(500);
  });

  test('plays idle animation more slowly than active states', () => {
    expect(getAnimationSpec('idle').durations).toEqual([1344, 528, 528, 672, 672, 1536]);
    expect(getAnimationSpec('review').durations).toEqual([240, 240, 240, 240, 240, 448]);
  });

  test('renders Codex pet cells at half visual size while preserving atlas offsets', () => {
    expect(getPetSpriteStyle('review', 2, 'todolist-pet://demo/spritesheet.webp')).toMatchObject({
      width: 96,
      height: 104,
      backgroundSize: '768px 936px',
      backgroundPosition: '-192px -832px'
    });
  });

  test('switches to review when overdue or today active todos exist', () => {
    const items: TodoItem[] = [
      {
        id: '1',
        date: '2026-05-10',
        text: 'Pay bill',
        completed: false,
        highlighted: false,
        overdue: true,
        sourceLine: 4
      }
    ];

    expect(getTodoDrivenPetState(items)).toBe('review');
  });

  test('switches to idle when all visible todos are complete', () => {
    const items: TodoItem[] = [
      {
        id: '1',
        date: '2026-05-11',
        text: 'Done',
        completed: true,
        highlighted: false,
        overdue: false,
        sourceLine: 4
      }
    ];

    expect(getTodoDrivenPetState(items)).toBe('idle');
  });

  test('uses waving while hovered and keeps drag direction as the highest priority state', () => {
    expect(getInteractivePetState({ baseState: 'review', isHovered: true })).toBe('waving');
    expect(getInteractivePetState({ baseState: 'review', isHovered: true, dragDirection: 'left' })).toBe(
      'running-left'
    );
    expect(getInteractivePetState({ baseState: 'idle', isHovered: false })).toBe('idle');
  });
});
