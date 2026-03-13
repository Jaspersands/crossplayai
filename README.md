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

This updates:
- `src/config/parserTuning.json` (tile occupancy/blank thresholds)
- `src/data/letterPrototypes.json` (label-trained glyph prototypes)
- `fixtures/corrections/tuning-report.json` (training summary)

## Notes

- v1 is optimized for mobile screenshots (iOS + Android).
- OCR and risk labels are heuristic and intended to be user-correctable.
- Crossplay dictionary filtering may differ from TWL06; risk tags help flag likely rejects.
