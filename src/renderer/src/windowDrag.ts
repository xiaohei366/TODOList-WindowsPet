export const petWindowDragThresholdPx = 4;

export function hasExceededPetWindowDragThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= petWindowDragThresholdPx;
}
