import { describe, expect, test } from 'vitest';
import { mouseInputSelector, shouldIgnoreWindowMouseEvents } from '../src/renderer/src/mousePassthrough';

function makeTarget(matched: boolean): EventTarget {
  return {
    closest: (selector: string) => (selector === mouseInputSelector && matched ? {} : null)
  } as unknown as EventTarget;
}

describe('mouse passthrough hit testing', () => {
  test('passes clicks through the transparent window background', () => {
    expect(shouldIgnoreWindowMouseEvents(null, false)).toBe(true);
    expect(shouldIgnoreWindowMouseEvents({} as EventTarget, false)).toBe(true);
    expect(shouldIgnoreWindowMouseEvents(makeTarget(false), false)).toBe(true);
  });

  test('keeps mouse input for pet, TODO panel, and resize handle regions', () => {
    expect(mouseInputSelector).toContain('.todo-panel');
    expect(mouseInputSelector).toContain('.pet-anchor');
    expect(mouseInputSelector).toContain('.ui-resize-handle');
    expect(shouldIgnoreWindowMouseEvents(makeTarget(true), false)).toBe(false);
  });

  test('keeps mouse input while an interaction is captured', () => {
    expect(shouldIgnoreWindowMouseEvents(makeTarget(false), true)).toBe(false);
  });
});
