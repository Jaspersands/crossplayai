/// <reference lib="webworker" />

import { parseScreenshot } from '../parser/parseScreenshot';
import type { ParserWorkerRequest, ParserWorkerResponse } from '../types/game';

self.onmessage = async (event: MessageEvent<ParserWorkerRequest>) => {
  const message = event.data;

  if (message.type !== 'parse') {
    return;
  }

  try {
    const parsed = await parseScreenshot(message.payload.file, message.payload.hint);
    const response: ParserWorkerResponse = {
      id: message.id,
      type: 'parseResult',
      payload: parsed,
    };
    self.postMessage(response);
  } catch (error) {
    const response: ParserWorkerResponse = {
      id: message.id,
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Screenshot parsing failed',
      },
    };
    self.postMessage(response);
  }
};

export {};
