import { describe, expect, test } from 'vitest';
import {
  clampPetUiScale,
  defaultPetUiScale,
  getPetUiScaleFromResizeDrag,
  maxPetUiScale,
  minPetUiScale
} from '../src/renderer/src/petScale';

describe('petScale helpers', () => {
  test('clamps pet ui scale to the supported desktop overlay range', () => {
    expect(clampPetUiScale(0.2)).toBe(minPetUiScale);
    expect(clampPetUiScale(3)).toBe(maxPetUiScale);
    expect(clampPetUiScale(Number.NaN)).toBe(defaultPetUiScale);
  });

  test('uses diagonal drag distance to resize the pet ui', () => {
    expect(getPetUiScaleFromResizeDrag(1, 13, 13)).toBeCloseTo(1.1);
    expect(getPetUiScaleFromResizeDrag(1, 260, 260)).toBe(maxPetUiScale);
    expect(getPetUiScaleFromResizeDrag(1, -52, -52)).toBeCloseTo(minPetUiScale);
  });
});
