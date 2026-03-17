import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

function normalizeLetter(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
}

function usage() {
  console.error(
    'Usage: node scripts/benchmark-correction.mjs <imagePath> <correctionJsonPath> [appUrl]\n' +
      'Example: node scripts/benchmark-correction.mjs "/abs/image.png" "/abs/image.corrections.json" http://127.0.0.1:5173',
  );
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function ensureFile(filePath) {
  await fs.access(filePath);
  return path.resolve(filePath);
}

export async function benchmarkCorrection({
  imagePath,
  correctionPath,
  appUrl = process.env.BENCHMARK_URL || 'http://127.0.0.1:5173',
  browser,
}) {
  const correction = await readJson(correctionPath);
  const ownedBrowser = browser ?? await chromium.launch({ headless: true });
  const page = await ownedBrowser.newPage();
  page.setDefaultTimeout(180_000);

  try {
    await page.goto(appUrl, { waitUntil: 'networkidle' });
    await page.locator('input[type="file"]').setInputFiles(imagePath);
    await page.waitForSelector('text=Review OCR output and confirm board state.', { timeout: 180_000 });

    const predicted = await page.evaluate(() => {
      const board = [];
      for (let row = 1; row <= 15; row += 1) {
        const rowValues = [];
        for (let col = 1; col <= 15; col += 1) {
          const input = document.querySelector(`input[aria-label="Cell ${row}-${col}"]`);
          const letter = (input?.value || '').toUpperCase();
          const toggle = input
            ?.closest('.board-cell')
            ?.querySelector('button[title="Toggle blank tile"]');
          const isBlank = Boolean(toggle && toggle.textContent?.trim() === 'Blank');
          rowValues.push({ letter, isBlank });
        }
        board.push(rowValues);
      }

      const rack = [];
      for (let index = 1; index <= 7; index += 1) {
        const input = document.querySelector(`input[aria-label="Rack tile ${index}"]`);
        const letter = (input?.value || '').toUpperCase();
        const checkbox = input
          ?.closest('.rack-tile')
          ?.querySelector('input[type="checkbox"]');
        rack.push({
          letter,
          isBlank: Boolean(checkbox?.checked),
        });
      }

      return { board, rack };
    });

    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    let boardLetterCorrect = 0;
    let boardLetterTotal = 0;
    const fpCells = [];
    const fnCells = [];
    const wrongLetterCells = [];

    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        const truthCell = correction.board?.[row]?.[col] ?? { letter: null, isBlank: false };
        const predCell = predicted.board?.[row]?.[col] ?? { letter: '', isBlank: false };

        const truthLetter = normalizeLetter(truthCell.letter ?? '');
        const predLetter = normalizeLetter(predCell.letter ?? '');
        const truthToken = truthCell.isBlank ? '?' : truthLetter;
        const predToken = predCell.isBlank ? '?' : predLetter;
        const truthOccupied = Boolean(truthCell.isBlank || truthLetter);
        const predOccupied = Boolean(predCell.isBlank || predLetter);

        if (predOccupied && truthOccupied) {
          tp += 1;
        } else if (predOccupied && !truthOccupied) {
          fp += 1;
          fpCells.push({ row: row + 1, col: col + 1, pred: predToken });
        } else if (!predOccupied && truthOccupied) {
          fn += 1;
          fnCells.push({ row: row + 1, col: col + 1, truth: truthToken });
        } else {
          tn += 1;
        }

        if (truthOccupied) {
          boardLetterTotal += 1;
          if (truthToken === predToken) {
            boardLetterCorrect += 1;
          } else if (predOccupied) {
            wrongLetterCells.push({
              row: row + 1,
              col: col + 1,
              truth: truthToken,
              pred: predToken,
            });
          }
        }
      }
    }

    let rackCorrect = 0;
    for (let index = 0; index < 7; index += 1) {
      const truthTile = correction.rack?.[index] ?? { letter: '', isBlank: false };
      const predTile = predicted.rack?.[index] ?? { letter: '', isBlank: false };
      const truthToken = truthTile.isBlank ? '?' : normalizeLetter(truthTile.letter ?? '');
      const predToken = predTile.isBlank ? '?' : normalizeLetter(predTile.letter ?? '');
      if (truthToken === predToken) {
        rackCorrect += 1;
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

    const report = {
      input: {
        imagePath,
        correctionPath,
        appUrl,
      },
      boardOccupancy: {
        tp,
        fp,
        fn,
        tn,
        precision,
        recall,
      },
      boardLetter: {
        correct: boardLetterCorrect,
        total: boardLetterTotal,
        accuracy: boardLetterTotal > 0 ? boardLetterCorrect / boardLetterTotal : 0,
      },
      rack: {
        correct: rackCorrect,
        total: 7,
        accuracy: rackCorrect / 7,
      },
      errorCells: {
        fpCells,
        fnCells,
        wrongLetterCells,
      },
      parsedRack: predicted.rack,
    };

    return report;
  } finally {
    await page.close();
    if (!browser) {
      await ownedBrowser.close();
    }
  }
}

async function main() {
  const [imageArg, correctionArg, appUrlArg] = process.argv.slice(2);
  if (!imageArg || !correctionArg) {
    usage();
    process.exitCode = 1;
    return;
  }

  const imagePath = await ensureFile(imageArg);
  const correctionPath = await ensureFile(correctionArg);
  const appUrl = appUrlArg || process.env.BENCHMARK_URL || 'http://127.0.0.1:5173';
  const report = await benchmarkCorrection({
    imagePath,
    correctionPath,
    appUrl,
  });
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
