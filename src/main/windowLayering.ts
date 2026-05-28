export const petAlwaysOnTopLevel = 'pop-up-menu';

export type PetLayerWindow = {
  setAlwaysOnTop(flag: boolean, level?: typeof petAlwaysOnTopLevel): void;
  moveTop(): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
};

export function keepPetWindowOnTop(window: Pick<PetLayerWindow, 'setAlwaysOnTop' | 'moveTop'>): void {
  window.setAlwaysOnTop(true, petAlwaysOnTopLevel);
  window.moveTop();
}

export function setPetWindowMousePassthrough(
  window: PetLayerWindow,
  ignore: boolean
): void {
  if (ignore) {
    window.setIgnoreMouseEvents(true, { forward: true });
  } else {
    window.setIgnoreMouseEvents(false);
  }
  keepPetWindowOnTop(window);
}
