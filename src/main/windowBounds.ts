export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Position = {
  x: number;
  y: number;
};

export const minVisibleWindowPixels = 80;

export function constrainWindowPosition(position: Position, windowSize: Rect, workArea: Rect): Position {
  return {
    x: clamp(
      position.x,
      workArea.x - windowSize.width + minVisibleWindowPixels,
      workArea.x + workArea.width - minVisibleWindowPixels
    ),
    y: clamp(
      position.y,
      workArea.y - windowSize.height + minVisibleWindowPixels,
      workArea.y + workArea.height - minVisibleWindowPixels
    )
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
