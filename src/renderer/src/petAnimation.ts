import type { AnimationSpec, PetState, TodoItem } from '../../shared/types';

const codexCellWidth = 192;
const codexCellHeight = 208;
const codexAtlasWidth = 1536;
const codexAtlasHeight = 1872;
const petRenderScale = 0.5;
const desktopPetPlaybackScale = 1.6;

export type PetSpriteStyle = {
  width: number;
  height: number;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
};

export type InteractivePetStateInput = {
  baseState: PetState;
  isHovered: boolean;
  dragDirection?: 'left' | 'right';
};

const codexAnimationSpecs: Record<PetState, AnimationSpec> = {
  idle: {
    state: 'idle',
    row: 0,
    frameCount: 6,
    durations: [280, 110, 110, 140, 140, 320]
  },
  'running-right': {
    state: 'running-right',
    row: 1,
    frameCount: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220]
  },
  'running-left': {
    state: 'running-left',
    row: 2,
    frameCount: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220]
  },
  waving: {
    state: 'waving',
    row: 3,
    frameCount: 4,
    durations: [140, 140, 140, 280]
  },
  jumping: {
    state: 'jumping',
    row: 4,
    frameCount: 5,
    durations: [140, 140, 140, 140, 280]
  },
  failed: {
    state: 'failed',
    row: 5,
    frameCount: 8,
    durations: [140, 140, 140, 140, 140, 140, 140, 240]
  },
  waiting: {
    state: 'waiting',
    row: 6,
    frameCount: 6,
    durations: [150, 150, 150, 150, 150, 260]
  },
  running: {
    state: 'running',
    row: 7,
    frameCount: 6,
    durations: [120, 120, 120, 120, 120, 220]
  },
  review: {
    state: 'review',
    row: 8,
    frameCount: 6,
    durations: [150, 150, 150, 150, 150, 280]
  }
};

const animationSpecs = Object.fromEntries(
  Object.entries(codexAnimationSpecs).map(([state, spec]) => [
    state,
    {
      ...spec,
      durations: spec.durations.map((duration) => Math.round(duration * desktopPetPlaybackScale))
    }
  ])
) as Record<PetState, AnimationSpec>;

export function getAnimationSpec(state: PetState): AnimationSpec {
  return animationSpecs[state];
}

export function getTodoDrivenPetState(items: TodoItem[]): PetState {
  return items.some((item) => !item.completed) ? 'review' : 'idle';
}

export function getInteractivePetState(input: InteractivePetStateInput): PetState {
  if (input.dragDirection === 'left') {
    return 'running-left';
  }
  if (input.dragDirection === 'right') {
    return 'running-right';
  }
  if (input.isHovered) {
    return 'waving';
  }
  return input.baseState;
}

export function getPetSpriteStyle(state: PetState, frame: number, spritesheetUrl: string): PetSpriteStyle {
  const spec = getAnimationSpec(state);
  const scaledCellWidth = codexCellWidth * petRenderScale;
  const scaledCellHeight = codexCellHeight * petRenderScale;

  return {
    width: scaledCellWidth,
    height: scaledCellHeight,
    backgroundImage: `url("${spritesheetUrl}")`,
    backgroundSize: `${codexAtlasWidth * petRenderScale}px ${codexAtlasHeight * petRenderScale}px`,
    backgroundPosition: `-${frame * scaledCellWidth}px -${spec.row * scaledCellHeight}px`
  };
}
