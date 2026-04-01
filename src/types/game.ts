export type ProfileType = 'ios' | 'android';

export type Cell = {
  letter: string | null;
  isBlank: boolean;
};

export type Board = Cell[][];

export type RackTile = {
  letter: string;
  isBlank: boolean;
};

export type ConfidenceCell = {
  row: number;
  col: number;
  confidence: number;
};

export type ParsedState = {
  profile: ProfileType;
  board: Board;
  rack: RackTile[];
  confidence: number;
  lowConfidenceCells: ConfidenceCell[];
};

export type Direction = 'across' | 'down';

export type MoveCandidate = {
  word: string;
  row: number;
  col: number;
  direction: Direction;
  score: number;
  crossWordCount: number;
  crossWordLetters: number;
  adjacentExistingTileCount: number;
  maxAdjacentExistingTiles: number;
  threadedTileCount: number;
  leaveValue: number;
  totalEval: number;
};

export type SolveInput = {
  board: Board;
  rack: RackTile[];
  lexiconId: string;
  topN: number;
};

export type DictionarySource =
  | { type: 'url'; url: string; name?: string }
  | { type: 'text'; text: string; name?: string };

export type DictionaryMeta = {
  id: string;
  name: string;
  wordCount: number;
  loadedFromCache: boolean;
  source: string;
};

export type SolveWorkerRequest = {
  id: string;
  type: 'solve';
  payload: SolveInput;
} | {
  id: string;
  type: 'initLexicon';
  payload: {
    id: string;
    words: string[];
    blocklist?: string[];
  };
};

export type SolveWorkerResponse = {
  id: string;
  type: 'solveResult' | 'lexiconReady' | 'error';
  payload: MoveCandidate[] | { message: string };
};

export type ParserWorkerRequest = {
  id: string;
  type: 'parse';
  payload: {
    file: File;
    hint?: ProfileType;
    openaiApiKey?: string;
  };
};

export type ParserWorkerResponse = {
  id: string;
  type: 'parseResult' | 'error';
  payload: ParsedState | { message: string };
};

export type PremiumType = 'TW' | 'DW' | 'TL' | 'DL' | null;

export type CorrectionExportCell = {
  letter: string | null;
  isBlank: boolean;
  premium: PremiumType;
};

export type CorrectionExportRackTile = {
  letter: string | null;
  isBlank: boolean;
};

export type CorrectionExportPayload = {
  version: string;
  source: {
    filename: string;
    profile: ProfileType;
    exportedAt: string;
  };
  board: CorrectionExportCell[][];
  rack: CorrectionExportRackTile[];
  parser: {
    confidence: number;
    lowConfidenceCells: ConfidenceCell[];
  };
};
