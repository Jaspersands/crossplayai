import { RISK_HIGH_THRESHOLD, RISK_MEDIUM_THRESHOLD } from '../config/solver';
import type { RiskAssessment, RiskContext } from '../types/game';

const TRADEMARK_PATTERNS = [
  /XBOX/i,
  /IPHONE/i,
  /ANDROID/i,
  /NETFLIX/i,
  /KLEENEX/i,
  /GOOGLE/i,
];

const SENSITIVE_PATTERNS = [/FUC/i, /CUNT/i, /NIGG/i, /SLUT/i, /NAZI/i];

const RARE_BIGRAMS = ['QZ', 'QJ', 'JX', 'ZX', 'VV', 'JJ', 'QW'];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function assessWordRisk(word: string, context: RiskContext): RiskAssessment {
  const normalized = word.toUpperCase();
  let score = 0;
  const reasons: string[] = [];

  if (context.blocklist.has(normalized)) {
    score += 0.75;
    reasons.push('Listed in local Crossplay blocklist.');
  }

  if (normalized.length >= 11) {
    score += 0.1;
    reasons.push('Very long word that may be filtered as obscure.');
  }

  const rareLetters = normalized.match(/[JQXZ]/g)?.length ?? 0;
  if (rareLetters >= 2) {
    score += 0.15;
    reasons.push('Contains multiple rare letters (J/Q/X/Z).');
  }

  const vowelCount = normalized.match(/[AEIOU]/g)?.length ?? 0;
  const vowelRatio = normalized.length > 0 ? vowelCount / normalized.length : 0;
  if (vowelRatio < 0.2 && normalized.length >= 6) {
    score += 0.12;
    reasons.push('Heavy consonant cluster can indicate niche word.');
  }

  if (RARE_BIGRAMS.some((pattern) => normalized.includes(pattern))) {
    score += 0.1;
    reasons.push('Contains unusual letter sequence.');
  }

  if (TRADEMARK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    score += 0.35;
    reasons.push('Looks similar to a trademarked brand name.');
  }

  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    score += 0.5;
    reasons.push('Contains a potentially offensive pattern.');
  }

  const bounded = clamp(score);

  if (bounded >= RISK_HIGH_THRESHOLD) {
    return { label: 'high', score: bounded, reasons };
  }
  if (bounded >= RISK_MEDIUM_THRESHOLD) {
    return { label: 'medium', score: bounded, reasons };
  }

  return {
    label: 'low',
    score: bounded,
    reasons: reasons.length > 0 ? reasons : ['No significant rejection signals detected.'],
  };
}
