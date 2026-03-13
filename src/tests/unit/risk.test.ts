import { describe, expect, it } from 'vitest';
import { assessWordRisk } from '../../lib/risk';

describe('risk labeling', () => {
  it('flags blocklisted word as high risk', () => {
    const blocklist = new Set(['XBOX']);
    const risk = assessWordRisk('XBOX', { blocklist });

    expect(risk.label).toBe('high');
    expect(risk.score).toBeGreaterThan(0.65);
  });

  it('keeps common short words low risk', () => {
    const risk = assessWordRisk('TRAIN', { blocklist: new Set() });

    expect(risk.label).toBe('low');
    expect(risk.score).toBeLessThan(0.35);
  });
});
