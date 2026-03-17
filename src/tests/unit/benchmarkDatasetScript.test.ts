// @vitest-environment node

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../../..');
const DATASET_SCRIPT_URL = pathToFileURL(path.join(REPO_ROOT, 'scripts', 'benchmark-corrections-dataset.mjs')).href;

type BenchmarkReport = {
  input: {
    imagePath: string;
    correctionPath: string;
    appUrl: string;
  };
  boardOccupancy: {
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    precision: number;
    recall: number;
  };
  boardLetter: {
    correct: number;
    total: number;
    accuracy: number;
  };
  rack: {
    correct: number;
    total: number;
    accuracy: number;
  };
  errorCells: {
    fpCells: Array<{ row: number; col: number; pred: string }>;
    fnCells: Array<{ row: number; col: number; truth: string }>;
    wrongLetterCells: Array<{ row: number; col: number; truth: string; pred: string }>;
  };
};

function makeReport(input: BenchmarkReport['input'], metrics: Omit<BenchmarkReport, 'input'>): BenchmarkReport {
  return {
    input,
    ...metrics,
  };
}

describe('benchmark-corrections-dataset script', () => {
  it('aggregates manifest fixtures and stays warn-only on baseline regression', async () => {
    const { runDatasetBenchmark } = (await import(DATASET_SCRIPT_URL)) as {
      runDatasetBenchmark: (options: {
        manifestPath: string;
        baselinePath: string;
        appUrl: string;
      }, dependencies: {
        benchmarkFn: (args: {
          imagePath: string;
          correctionPath: string;
          appUrl: string;
          browser?: unknown;
        }) => Promise<BenchmarkReport>;
          useBrowser: boolean;
      }) => Promise<{
        summary: {
          fixtureCount: number;
        };
        baselineComparison: {
          warnings: string[];
        };
      }>;
    };

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'crossplayai-benchmark-smoke-'));
    const correctionsRoot = path.join(tempRoot, 'fixtures', 'corrections');
    await mkdir(correctionsRoot, { recursive: true });

    const manifestPath = path.join(correctionsRoot, 'manifest.json');
    const baselinePath = path.join(correctionsRoot, 'benchmark-baseline.json');
    const manifest = {
      generatedAt: new Date('2026-03-14T00:00:00.000Z').toISOString(),
      itemCount: 2,
      items: [
        {
          sourceFilename: 'fixture-a.png',
          imageFile: 'images/fixture-a.png',
          labelFile: 'labels/fixture-a.corrections.json',
          profile: 'ios',
        },
        {
          sourceFilename: 'fixture-b.png',
          imageFile: 'images/fixture-b.png',
          labelFile: 'labels/fixture-b.corrections.json',
          profile: 'ios',
        },
      ],
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(
      baselinePath,
      `${JSON.stringify({
        version: '1',
        generatedAt: new Date('2026-03-14T00:00:00.000Z').toISOString(),
        manifestPath,
        fixtureCount: 2,
        targets: {
          boardOccupancyPrecisionMicro: 0.95,
          boardOccupancyRecallMicro: 0.9,
          boardLetterAccuracyMicro: 0.9,
          rackAccuracyMicro: 0.9,
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const reportsBySource = new Map<string, BenchmarkReport>([
      ['fixture-a.png', makeReport(
        {
          imagePath: path.join(correctionsRoot, 'images', 'fixture-a.png'),
          correctionPath: path.join(correctionsRoot, 'labels', 'fixture-a.corrections.json'),
          appUrl: 'http://127.0.0.1:5173',
        },
        {
          boardOccupancy: { tp: 10, fp: 0, fn: 2, tn: 213, precision: 1, recall: 10 / 12 },
          boardLetter: { correct: 9, total: 10, accuracy: 0.9 },
          rack: { correct: 6, total: 7, accuracy: 6 / 7 },
          errorCells: {
            fpCells: [],
            fnCells: [{ row: 3, col: 4, truth: 'A' }],
            wrongLetterCells: [{ row: 5, col: 8, truth: 'R', pred: 'P' }],
          },
        },
      )],
      ['fixture-b.png', makeReport(
        {
          imagePath: path.join(correctionsRoot, 'images', 'fixture-b.png'),
          correctionPath: path.join(correctionsRoot, 'labels', 'fixture-b.corrections.json'),
          appUrl: 'http://127.0.0.1:5173',
        },
        {
          boardOccupancy: { tp: 8, fp: 2, fn: 4, tn: 211, precision: 0.8, recall: 8 / 12 },
          boardLetter: { correct: 6, total: 10, accuracy: 0.6 },
          rack: { correct: 4, total: 7, accuracy: 4 / 7 },
          errorCells: {
            fpCells: [{ row: 9, col: 9, pred: 'E' }],
            fnCells: [{ row: 10, col: 1, truth: 'T' }],
            wrongLetterCells: [{ row: 11, col: 2, truth: 'L', pred: 'I' }],
          },
        },
      )],
    ]);

    const result = await runDatasetBenchmark(
      {
        manifestPath,
        baselinePath,
        appUrl: 'http://127.0.0.1:5173',
      },
      {
        benchmarkFn: async ({ imagePath }) => {
          const source = path.basename(imagePath);
          const report = reportsBySource.get(source);
          if (!report) {
            throw new Error(`Missing mocked report for ${source}`);
          }
          return report;
        },
        useBrowser: false,
      },
    );

    expect(result.summary.fixtureCount).toBe(2);
    expect(result.baselineComparison.warnings.length).toBeGreaterThan(0);
  });

  it('can update baseline from aggregated metrics', async () => {
    const { runDatasetBenchmark } = (await import(DATASET_SCRIPT_URL)) as {
      runDatasetBenchmark: (options: {
        manifestPath: string;
        baselinePath: string;
        appUrl: string;
        updateBaseline: boolean;
      }, dependencies: {
        benchmarkFn: (args: {
          imagePath: string;
          correctionPath: string;
          appUrl: string;
          browser?: unknown;
        }) => Promise<BenchmarkReport>;
          useBrowser: boolean;
      }) => Promise<void>;
    };

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'crossplayai-benchmark-baseline-'));
    const correctionsRoot = path.join(tempRoot, 'fixtures', 'corrections');
    await mkdir(correctionsRoot, { recursive: true });

    const manifestPath = path.join(correctionsRoot, 'manifest.json');
    const baselinePath = path.join(correctionsRoot, 'benchmark-baseline.json');

    const manifest = {
      generatedAt: new Date('2026-03-14T00:00:00.000Z').toISOString(),
      itemCount: 1,
      items: [
        {
          sourceFilename: 'fixture-a.png',
          imageFile: 'images/fixture-a.png',
          labelFile: 'labels/fixture-a.corrections.json',
          profile: 'ios',
        },
      ],
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await runDatasetBenchmark(
      {
        manifestPath,
        baselinePath,
        appUrl: 'http://127.0.0.1:5173',
        updateBaseline: true,
      },
      {
        benchmarkFn: async ({ imagePath, correctionPath, appUrl }) => makeReport(
          {
            imagePath,
            correctionPath,
            appUrl,
          },
          {
            boardOccupancy: { tp: 12, fp: 0, fn: 0, tn: 213, precision: 1, recall: 1 },
            boardLetter: { correct: 12, total: 12, accuracy: 1 },
            rack: { correct: 7, total: 7, accuracy: 1 },
            errorCells: {
              fpCells: [],
              fnCells: [],
              wrongLetterCells: [],
            },
          },
        ),
        useBrowser: false,
      },
    );

    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
      targets?: {
        boardOccupancyPrecisionMicro?: number;
      };
    };

    expect(baseline.targets?.boardOccupancyPrecisionMicro).toBe(1);
  });
});
