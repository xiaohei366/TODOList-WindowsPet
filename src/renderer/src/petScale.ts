export const minPetUiScale = 0.65;
export const maxPetUiScale = 2;
export const defaultPetUiScale = 1;

const resizeSensitivity = 260;

export function clampPetUiScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return defaultPetUiScale;
  }
  return Math.min(maxPetUiScale, Math.max(minPetUiScale, scale));
}

export function getPetUiScaleFromResizeDrag(
  initialScale: number,
  deltaX: number,
  deltaY: number
): number {
  return clampPetUiScale(initialScale + (deltaX + deltaY) / resizeSensitivity);
}
