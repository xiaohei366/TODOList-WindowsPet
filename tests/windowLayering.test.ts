import { describe, expect, test } from 'vitest';
import {
  keepPetWindowOnTop,
  petAlwaysOnTopLevel,
  setPetWindowMousePassthrough,
  type PetLayerWindow
} from '../src/main/windowLayering';

function createWindowDouble(): PetLayerWindow & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setAlwaysOnTop: (flag, level) => {
      calls.push(`top:${String(flag)}:${String(level)}`);
    },
    moveTop: () => {
      calls.push('moveTop');
    },
    setIgnoreMouseEvents: (ignore, options) => {
      calls.push(`ignore:${String(ignore)}:${options?.forward === true ? 'forward' : 'none'}`);
    }
  };
}

describe('pet window layering', () => {
  test('uses a high non-screen-saver topmost level for the desktop pet', () => {
    expect(petAlwaysOnTopLevel).toBe('pop-up-menu');
  });

  test('reasserts always-on-top and z-order together', () => {
    const window = createWindowDouble();

    keepPetWindowOnTop(window);

    expect(window.calls).toEqual(['top:true:pop-up-menu', 'moveTop']);
  });

  test('keeps the pet topmost after changing mouse passthrough styles', () => {
    const window = createWindowDouble();

    setPetWindowMousePassthrough(window, true);
    setPetWindowMousePassthrough(window, false);

    expect(window.calls).toEqual([
      'ignore:true:forward',
      'top:true:pop-up-menu',
      'moveTop',
      'ignore:false:none',
      'top:true:pop-up-menu',
      'moveTop'
    ]);
  });
});
