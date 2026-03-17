import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { benchmarkCorrection } from './benchmark-correction.mjs';

const ROOT = process.cwd();
const DEFAULT_MANIFEST_PATH = path.join(ROOT, 'fixtures', 'corrections', 'manifest.json');
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'fixtures', 'corrections', 'benchmark-baseline.json');
const DEFAULT_APP_URL = process.env.BENCHMARK_DATASET_URL || process.env.BENCHMARK_URL || 'http://127.0.0.1:5173';
const WARN_TOLERANCE = 0.0001;

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    appUrl: DEFAULT_APP_URL,
    baselinePath: DEFAULT_BASELINE_PATH,
    updateBaseline: false,
  };

  for (const arg of argv) {
    if (!arg) {
      continue;
    }

    if (arg === '--update-baseline') {
      options.updateBaseline = true;
      continue;
    }

    if (arg.startsWith('--app-url=')) {
      options.appUrl = arg.slice('--app-url='.length);
      continue;
    }

    if (arg.startsWith('--baseline-path=')) {
      options.baselinePath = path.resolve(arg.slice('--baseline-path='.length));
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    options.manifestPath = path.resolve(arg);
  }

  return options;
}

function toFixtureList(manifestPath, manifest) {
  if (!manifest || !Array.isArray(manifest.items)) {
    throw new Error(`Invalid manifest at ${manifestPath}`);
  }

  const correctionsRoot = path.dirname(manifestPath);
  return manifest.items
    .filter((item) => item?.imageFile && item?.labelFile)
    .map((item) => ({
      sourceFilename: item.sourceFilename ?? path.basename(item.imageFile),
      imagePath: path.resolve(correctionsRoot, item.imageFile),
      correctionPath: path.resolve(correctionsRoot, item.labelFile),
      profile: item.profile ?? null,
    }))
    .sort((lhs, rhs) => lhs.sourceFilename.localeCompare(rhs.sourceFilename));
}

function aggregateReports(reports) {
  const fixtureCount = reports.length;

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let boardLetterCorrect = 0;
  let boardLetterTotal = 0;
  let rackCorrect = 0;
  let rackTotal = 0;

  let occupancyPrecisionMacroSum = 0;
  let occupancyRecallMacroSum = 0;
  let occupancyF1MacroSum = 0;
  let boardLetterMacroSum = 0;
  let rackMacroSum = 0;

  const perFixture = [];

  for (const report of reports) {
    const o = report.boardOccupancy;
    tp += o.tp;
    fp += o.fp;
    fn += o.fn;
    tn += o.tn;

    boardLetterCorrect += report.boardLetter.correct;
    boardLetterTotal += report.boardLetter.total;
    rackCorrect += report.rack.correct;
    rackTotal += report.rack.total;

    const occupancyF1 = (o.precision + o.recall) > 0
      ? (2 * o.precision * o.recall) / (o.precision + o.recall)
      : 0;

    occupancyPrecisionMacroSum += o.precision;
    occupancyRecallMacroSum += o.recall;
    occupancyF1MacroSum += occupancyF1;
    boardLetterMacroSum += report.boardLetter.accuracy;
    rackMacroSum += report.rack.accuracy;

    const errorCellCount =
      (report.errorCells?.fpCells?.length ?? 0) +
      (report.errorCells?.fnCells?.length ?? 0) +
      (report.errorCells?.wrongLetterCells?.length ?? 0);

    perFixture.push({
      source: path.basename(report.input?.imagePath ?? ''),
      boardOccupancy: {
        precision: round(o.precision, 4),
        recall: round(o.recall, 4),
        tp: o.tp,
        fp: o.fp,
        fn: o.fn,
      },
      boardLetterAccuracy: round(report.boardLetter.accuracy, 4),
      rackAccuracy: round(report.rack.accuracy, 4),
      errorCellCount,
    });
  }

  const precisionMicro = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recallMicro = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Micro = precisionMicro + recallMicro > 0
    ? (2 * precisionMicro * recallMicro) / (precisionMicro + recallMicro)
    : 0;

  const boardLetterAccuracyMicro = boardLetterTotal > 0 ? boardLetterCorrect / boardLetterTotal : 0;
  const rackAccuracyMicro = rackTotal > 0 ? rackCorrect / rackTotal : 0;

  return {
    fixtureCount,
    boardOccupancy: {
      micro: {
        precision: round(precisionMicro, 4),
        recall: round(recallMicro, 4),
        f1: round(f1Micro, 4),
        tp,
        fp,
        fn,
        tn,
      },
      macro: {
        precision: fixtureCount > 0 ? round(occupancyPrecisionMacroSum / fixtureCount, 4) : 0,
        recall: fixtureCount > 0 ? round(occupancyRecallMacroSum / fixtureCount, 4) : 0,
        f1: fixtureCount > 0 ? round(occupancyF1MacroSum / fixtureCount, 4) : 0,
      },
    },
    boardLetterAccuracy: {
      micro: round(boardLetterAccuracyMicro, 4),
      macro: fixtureCount > 0 ? round(boardLetterMacroSum / fixtureCount, 4) : 0,
      correct: boardLetterCorrect,
      total: boardLetterTotal,
    },
    rackAccuracy: {
      micro: round(rackAccuracyMicro, 4),
      macro: fixtureCount > 0 ? round(rackMacroSum / fixtureCount, 4) : 0,
      correct: rackCorrect,
      total: rackTotal,
    },
    topErrorFixtures: perFixture
      .slice()
      .sort((lhs, rhs) => rhs.errorCellCount - lhs.errorCellCount)
      .slice(0, 10),
    perFixture,
  };
}

function buildBaselinePayload(summary, manifestPath) {
  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    manifestPath,
    fixtureCount: summary.fixtureCount,
    targets: {
      boardOccupancyPrecisionMicro: summary.boardOccupancy.micro.precision,
      boardOccupancyRecallMicro: summary.boardOccupancy.micro.recall,
      boardLetterAccuracyMicro: summary.boardLetterAccuracy.micro,
      rackAccuracyMicro: summary.rackAccuracy.micro,
    },
  };
}

function compareWithBaseline(summary, baseline) {
  if (!baseline?.targets) {
    return {
      compared: false,
      warnings: ['WARN: baseline file missing or invalid; skipping comparison.'],
    };
  }

  const checks = [
    {
      key: 'boardOccupancyPrecisionMicro',
      label: 'Board occupancy precision (micro)',
      current: summary.boardOccupancy.micro.precision,
    },
    {
      key: 'boardOccupancyRecallMicro',
      label: 'Board occupancy recall (micro)',
      current: summary.boardOccupancy.micro.recall,
    },
    {
      key: 'boardLetterAccuracyMicro',
      label: 'Board letter accuracy (micro)',
      current: summary.boardLetterAccuracy.micro,
    },
    {
      key: 'rackAccuracyMicro',
      label: 'Rack accuracy (micro)',
      current: summary.rackAccuracy.micro,
    },
  ];

  const warnings = [];
  for (const check of checks) {
    const expected = Number(baseline.targets[check.key]);
    if (!Number.isFinite(expected)) {
      warnings.push(`WARN: baseline target missing for ${check.label}.`);
      continue;
    }

    if (check.current + WARN_TOLERANCE < expected) {
      warnings.push(
        `WARN: ${check.label} regressed (${round(check.current, 4)} < baseline ${round(expected, 4)}).`,
      );
    }
  }

  return {
    compared: true,
    warnings,
  };
}

export async function runDatasetBenchmark(options, dependencies = {}) {
  const resolvedOptions = {
    manifestPath: options?.manifestPath ?? DEFAULT_MANIFEST_PATH,
    appUrl: options?.appUrl ?? DEFAULT_APP_URL,
    baselinePath: options?.baselinePath ?? DEFAULT_BASELINE_PATH,
    updateBaseline: Boolean(options?.updateBaseline),
  };
  const benchmarkFn = dependencies.benchmarkFn ?? benchmarkCorrection;
  const shouldUseBrowser = dependencies.useBrowser ?? benchmarkFn === benchmarkCorrection;
  const launchBrowser = dependencies.launchBrowser ?? (() => chromium.launch({ headless: true }));

  const manifest = await readJson(resolvedOptions.manifestPath, null);
  const fixtures = toFixtureList(resolvedOptions.manifestPath, manifest);
  if (fixtures.length === 0) {
    throw new Error(`No fixtures with image+label found in ${resolvedOptions.manifestPath}`);
  }

  const browser = shouldUseBrowser ? await launchBrowser() : undefined;
  const reports = [];

  try {
    for (const fixture of fixtures) {
      const report = await benchmarkFn({
        imagePath: fixture.imagePath,
        correctionPath: fixture.correctionPath,
        appUrl: resolvedOptions.appUrl,
        browser,
      });
      reports.push(report);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const summary = aggregateReports(reports);
  const baselinePayload = buildBaselinePayload(summary, resolvedOptions.manifestPath);

  if (resolvedOptions.updateBaseline) {
    await fs.writeFile(resolvedOptions.baselinePath, `${JSON.stringify(baselinePayload, null, 2)}\n`, 'utf8');
  }

  const baseline = await readJson(resolvedOptions.baselinePath, null);
  const baselineComparison = compareWithBaseline(summary, baseline);

  return {
    generatedAt: new Date().toISOString(),
    manifestPath: resolvedOptions.manifestPath,
    appUrl: resolvedOptions.appUrl,
    baselinePath: resolvedOptions.baselinePath,
    updateBaseline: resolvedOptions.updateBaseline,
    summary,
    baselineComparison,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = await runDatasetBenchmark(options);
  console.log(JSON.stringify(output, null, 2));
  for (const warning of output.baselineComparison.warnings) {
    console.warn(warning);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
