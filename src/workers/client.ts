import type {
  MoveCandidate,
  ParsedState,
  ParserWorkerRequest,
  ParserWorkerResponse,
  ProfileType,
  SolveInput,
  SolveWorkerRequest,
  SolveWorkerResponse,
} from '../types/game';

const parserWorker = new Worker(new URL('./parserWorker.ts', import.meta.url), { type: 'module' });
const solverWorker = new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' });

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

const parserPending = new Map<
  string,
  {
    resolve: (value: ParsedState) => void;
    reject: (reason?: unknown) => void;
  }
>();

const solverPending = new Map<
  string,
  {
    resolve: (value: MoveCandidate[] | null) => void;
    reject: (reason?: unknown) => void;
  }
>();

parserWorker.onmessage = (event: MessageEvent<ParserWorkerResponse>) => {
  const message = event.data;
  const pending = parserPending.get(message.id);
  if (!pending) {
    return;
  }

  parserPending.delete(message.id);

  if (message.type === 'error') {
    pending.reject(new Error((message.payload as { message: string }).message));
    return;
  }

  pending.resolve(message.payload as ParsedState);
};

solverWorker.onmessage = (event: MessageEvent<SolveWorkerResponse>) => {
  const message = event.data;
  const pending = solverPending.get(message.id);
  if (!pending) {
    return;
  }

  solverPending.delete(message.id);

  if (message.type === 'error') {
    pending.reject(new Error((message.payload as { message: string }).message));
    return;
  }

  if (message.type === 'lexiconReady') {
    pending.resolve(null);
    return;
  }

  pending.resolve(message.payload as MoveCandidate[]);
};

export function parseWithWorker(file: File, hint?: ProfileType): Promise<ParsedState> {
  return new Promise((resolve, reject) => {
    const id = nextId('parse');
    parserPending.set(id, { resolve, reject });

    const payload: ParserWorkerRequest = {
      id,
      type: 'parse',
      payload: {
        file,
        hint,
        openaiApiKey: import.meta.env.VITE_OPENAI_API_KEY as string | undefined,
      },
    };

    parserWorker.postMessage(payload);
  });
}

export function initSolverLexicon(
  lexicon: { id: string; words: string[] },
  blocklist: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = nextId('lexicon');
    solverPending.set(id, {
      resolve: () => resolve(),
      reject,
    });

    const payload: SolveWorkerRequest = {
      id,
      type: 'initLexicon',
      payload: {
        id: lexicon.id,
        words: lexicon.words,
        blocklist,
      },
    };

    solverWorker.postMessage(payload);
  });
}

export function solveWithWorker(input: SolveInput): Promise<MoveCandidate[]> {
  return new Promise((resolve, reject) => {
    const id = nextId('solve');
    solverPending.set(id, {
      resolve: (value) => resolve((value ?? []) as MoveCandidate[]),
      reject,
    });

    const payload: SolveWorkerRequest = {
      id,
      type: 'solve',
      payload: input,
    };

    solverWorker.postMessage(payload);
  });
}
