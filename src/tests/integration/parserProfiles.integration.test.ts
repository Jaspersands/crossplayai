import { describe, expect, it } from 'vitest';
import { detectProfile } from '../../config/layoutProfiles';

describe('parser profile detection', () => {
  it('detects ios-like screenshot ratios', () => {
    const profile = detectProfile(1170, 2532);
    expect(profile).toBe('ios');
  });

  it('detects android-like screenshot ratios', () => {
    const profile = detectProfile(1080, 2400);
    expect(profile).toBe('android');
  });

  it('respects explicit hint over auto detection', () => {
    const profile = detectProfile(1080, 2400, 'ios');
    expect(profile).toBe('ios');
  });
});
