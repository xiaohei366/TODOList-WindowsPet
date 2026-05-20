import { describe, expect, test } from 'vitest';
import { constrainWindowPosition } from '../src/main/windowBounds';
import { hasExceededPetWindowDragThreshold } from '../src/renderer/src/windowDrag';

describe('pet window drag helpers', () => {
  test('does not treat a normal click jitter as a drag', () => {
    expect(hasExceededPetWindowDragThreshold(100, 100, 102, 101)).toBe(false);
    expect(hasExceededPetWindowDragThreshold(100, 100, 105, 100)).toBe(true);
  });

  test('keeps part of the transparent pet window visible on screen', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const windowSize = { x: 0, y: 0, width: 680, height: 720 };

    expect(constrainWindowPosition({ x: -5000, y: -5000 }, windowSize, workArea)).toEqual({
      x: -600,
      y: -640
    });
    expect(constrainWindowPosition({ x: 5000, y: 5000 }, windowSize, workArea)).toEqual({
      x: 1840,
      y: 1000
    });
  });
});
