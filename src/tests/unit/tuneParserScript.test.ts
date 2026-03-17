// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../..');
const TUNE_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'tune-parser-from-corrections.mjs');

type FixtureCell = {
  letter: string | null;
  isBlank: boolean;
  premium: null;
};

type CorrectionPayload = {
  source: {
    profile: 'ios';
  };
  board: FixtureCell[][];
  rack: Array<{
    letter: string;
    isBlank: boolean;
  }>;
};

function buildBoard(centerLetter: string): FixtureCell[][] {
  const board: FixtureCell[][] = Array.from({ length: 15 }, () =>
    Array.from({ length: 15 }, () => ({ letter: null, isBlank: false, premium: null })),
  );
  board[7][7] = { letter: centerLetter, isBlank: false, premium: null };
  return board;
}

async function writeMinimalPng(filePath: string): Promise<void> {
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f5kAAAAASUVORK5CYII=',
    'base64',
  );
  await writeFile(filePath, onePixelPng);
}

describe('tune-parser-from-corrections script', () => {
  it(
    'writes a tuning report with split and validation metrics',
    async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'crossplayai-tune-smoke-'));
      const correctionsRoot = path.join(tempRoot, 'fixtures', 'corrections');
      const imagesDir = path.join(correctionsRoot, 'images');
      const labelsDir = path.join(correctionsRoot, 'labels');
      const srcConfigDir = path.join(tempRoot, 'src', 'config');
      const srcDataDir = path.join(tempRoot, 'src', 'data');

      await mkdir(imagesDir, { recursive: true });
      await mkdir(labelsDir, { recursive: true });
      await mkdir(srcConfigDir, { recursive: true });
      await mkdir(srcDataDir, { recursive: true });

      const imageA = 'fixture-a.png';
      const imageB = 'fixture-b.png';
      await writeMinimalPng(path.join(imagesDir, imageA));
      await writeMinimalPng(path.join(imagesDir, imageB));

      const correctionA: CorrectionPayload = {
        source: { profile: 'ios' },
        board: buildBoard('A'),
        rack: [
          { letter: 'A', isBlank: false },
          { letter: 'R', isBlank: false },
          { letter: 'E', isBlank: false },
          { letter: '', isBlank: true },
          { letter: '', isBlank: false },
          { letter: '', isBlank: false },
          { letter: '', isBlank: false },
        ],
      };

      const correctionB: CorrectionPayload = {
        source: { profile: 'ios' },
        board: buildBoard('B'),
        rack: [
          { letter: 'B', isBlank: false },
          { letter: 'E', isBlank: false },
          { letter: 'F', isBlank: false },
          { letter: '', isBlank: true },
          { letter: '', isBlank: false },
          { letter: '', isBlank: false },
          { letter: '', isBlank: false },
        ],
      };

      const labelA = 'fixture-a.corrections.json';
      const labelB = 'fixture-b.corrections.json';
      await writeFile(path.join(labelsDir, labelA), `${JSON.stringify(correctionA, null, 2)}\n`, 'utf8');
      await writeFile(path.join(labelsDir, labelB), `${JSON.stringify(correctionB, null, 2)}\n`, 'utf8');

      const manifestPath = path.join(correctionsRoot, 'manifest.json');
      const manifest = {
        generatedAt: new Date('2026-03-14T00:00:00.000Z').toISOString(),
        itemCount: 2,
        items: [
          {
            sourceFilename: 'fixture-a.png',
            imageFile: `images/${imageA}`,
            labelFile: `labels/${labelA}`,
            profile: 'ios',
          },
          {
            sourceFilename: 'fixture-b.png',
            imageFile: `images/${imageB}`,
            labelFile: `labels/${labelB}`,
            profile: 'ios',
          },
        ],
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

      await execFileAsync(
        'node',
        [
          TUNE_SCRIPT_PATH,
          manifestPath,
          '--validation-ratio=0.2',
          '--split-seed=test-seed',
        ],
        {
          cwd: tempRoot,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const reportPath = path.join(correctionsRoot, 'tuning-report.json');
      const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
        split?: {
          ratio?: number;
          seed?: string;
          trainFixtureCount?: number;
          validationFixtureCount?: number;
        };
        validationMetrics?: unknown;
      };

      expect(report.split?.ratio).toBe(0.2);
      expect(report.split?.seed).toBe('test-seed');
      expect(report.split?.trainFixtureCount).toBe(1);
      expect(report.split?.validationFixtureCount).toBe(1);
      expect(report.validationMetrics).toBeTruthy();
    },
    120_000,
  );
});
