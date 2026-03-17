# CrossplayAI

Local web app that reads a **mobile Crossplay NYT Scrabble screenshot**, lets you correct OCR output, and computes ranked move suggestions with score + leave + defense + Crossplay-risk labels.

## Stack

- React 18 + Vite + TypeScript
- Zustand state management
- `opencv.js` image preprocessing
- `tesseract.js` OCR
- Solver + parsing in Web Workers
- Vitest + Playwright tests

## Requirements

- Node 18+
- npm

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## External Tile OCR (Optional)

Board and rack parsing can use an external vision model per fixed tile slot (15x15 board + 7 rack slots), with local OCR fallback.

Local open-source OCR (recommended) via Ollama:

```bash
# install/start ollama, then pull a vision model
ollama pull llava:7b

# .env.local
VITE_EXTERNAL_OCR_PROVIDER=ollama
VITE_EXTERNAL_OCR_MODEL=llava:7b
VITE_EXTERNAL_OCR_ENDPOINT=http://127.0.0.1:11434/api/chat
VITE_REQUIRE_EXTERNAL_OCR=true
```

OpenAI provider (optional):

Create a `.env.local` file:

```bash
VITE_EXTERNAL_OCR_PROVIDER=openai
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_EXTERNAL_OCR_MODEL=gpt-4.1-mini
```

Optional tuning:

```bash
VITE_EXTERNAL_OCR_ENDPOINT=https://api.openai.com/v1/chat/completions
VITE_EXTERNAL_OCR_BATCH_SIZE=16
VITE_EXTERNAL_OCR_MAX_CONCURRENT_BATCHES=2
VITE_EXTERNAL_OCR_TIMEOUT_MS=25000
```

Optional strict mode (fail parse if external OCR is not configured/available):

```bash
VITE_REQUIRE_EXTERNAL_OCR=true
```

## Dictionary

- Default source: `https://www.freescrabbledictionary.com/twl06/download/twl06.txt`
- Fallback local copy: `public/data/twl06.txt`
- Dictionary is cached in browser local storage.

## Test and Build

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

If Playwright browser binaries are missing, install them once:

```bash
npx playwright install chromium
```

## Fixture Calibration

Drop fixture JSON files in `fixtures/calibration/` using the format in `fixtures/README.md`, then run:

```bash
npm run calibrate:profiles
```

This updates `src/config/profileThresholds.json`.

## Correction Fixtures

To import correction exports from the `/corrections` page (default source: `~/Downloads/corrections`):

```bash
npm run import:corrections
```

To import from a custom folder:

```bash
npm run import:corrections -- /absolute/path/to/corrections
```

Imported files are stored in `fixtures/corrections/`:
- `labels/` for correction JSON files
- `images/` for matched source screenshots
- `manifest.json` for image/label pairing metadata

## Tune OCR From Corrections

After importing correction fixtures, run:

```bash
npm run tune:parser
```

Optional train/validation split controls:

```bash
npm run tune:parser -- --validation-ratio=0.2 --split-seed=crossplayai-v1
```

This updates:
- `src/config/parserTuning.json` (tile occupancy/blank thresholds)
- `src/data/letterPrototypes.json` (label-trained glyph prototypes)
- `src/data/tileClassifierModel.json` (local per-cell occupancy model)
- `fixtures/corrections/tuning-report.json` (training summary)

`fixtures/corrections/tuning-report.json` now includes:
- `split` (ratio/seed/train-vs-validation fixture counts)
- `validationMetrics` (held-out occupancy/board-letter/rack metrics)

## Benchmark A Screenshot Against Corrections

With `npm run dev` running, benchmark parser output against a correction JSON:

```bash
npm run benchmark:correction -- \
  "/absolute/path/to/screenshot.png" \
  "/absolute/path/to/screenshot.corrections.json" \
  "http://127.0.0.1:5173"
```

The command prints occupancy precision/recall, board letter accuracy, rack accuracy, and exact FP/FN/wrong-letter cells.

## Benchmark Entire Corrections Dataset (Warn-Only Gate)

With `npm run dev` running:

```bash
npm run benchmark:dataset
```

This evaluates every fixture in `fixtures/corrections/manifest.json` and prints:
- occupancy micro/macro metrics
- board letter accuracy
- rack accuracy
- top error fixtures

Baseline is compared from `fixtures/corrections/benchmark-baseline.json`. Regressions emit `WARN` lines only (exit code remains `0`).

To intentionally refresh baseline:

```bash
npm run benchmark:dataset:update-baseline
```

## Notes

- v1 is optimized for mobile screenshots (iOS + Android).
- OCR and risk labels are heuristic and intended to be user-correctable.
- Crossplay dictionary filtering may differ from TWL06; risk tags help flag likely rejects.
