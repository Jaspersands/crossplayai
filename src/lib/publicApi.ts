import type {
  DictionaryMeta,
  DictionarySource,
  ParsedState,
  ProfileType,
  SolveInput,
  MoveCandidate,
} from '../types/game';
import { loadDictionary as loadDictionaryImpl } from './dictionary';
import { solveMoves as solveMovesImpl } from './solver';
import { parseScreenshot as parseScreenshotImpl } from '../parser/parseScreenshot';

export async function parseScreenshot(image: File, hint?: ProfileType): Promise<ParsedState> {
  return parseScreenshotImpl(image, hint);
}

export function solveMoves(input: SolveInput): MoveCandidate[] {
  return solveMovesImpl(input);
}

export async function loadDictionary(source?: DictionarySource): Promise<DictionaryMeta> {
  return loadDictionaryImpl(source);
}
