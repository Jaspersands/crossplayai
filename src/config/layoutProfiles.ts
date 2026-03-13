import type { ProfileType } from '../types/game';

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutProfile = {
  boardRect: NormalizedRect;
  rackRect: NormalizedRect;
  tileGap: number;
  expectedAspect: number;
};

export const LAYOUT_PROFILES: Record<ProfileType, LayoutProfile> = {
  ios: {
    boardRect: {
      x: 0.01,
      y: 0.29,
      width: 0.98,
      height: 0.47,
    },
    rackRect: {
      x: 0.0,
      y: 0.81,
      width: 1.0,
      height: 0.09,
    },
    tileGap: 0.02,
    expectedAspect: 2.16,
  },
  android: {
    boardRect: {
      x: 0.01,
      y: 0.29,
      width: 0.98,
      height: 0.47,
    },
    rackRect: {
      x: 0.0,
      y: 0.80,
      width: 1.0,
      height: 0.10,
    },
    tileGap: 0.018,
    expectedAspect: 2.25,
  },
};

export function detectProfile(width: number, height: number, hint?: ProfileType): ProfileType {
  if (hint) {
    return hint;
  }

  const ratio = height / width;
  const iosDelta = Math.abs(ratio - LAYOUT_PROFILES.ios.expectedAspect);
  const androidDelta = Math.abs(ratio - LAYOUT_PROFILES.android.expectedAspect);

  return iosDelta <= androidDelta ? 'ios' : 'android';
}
