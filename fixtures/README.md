# Calibration Fixtures

Place 15-30 labeled screenshot fixtures in `fixtures/calibration/`.

Each fixture should be a JSON file with this shape:

```json
{
  "profile": "ios",
  "boardOccupiedDarkRatio": 0.061,
  "boardOccupiedVariance": 430,
  "rackOccupiedDarkRatio": 0.079,
  "rackOccupiedVariance": 370,
  "lowConfidence": 0.72
}
```

You can mix `ios` and `android` fixture files.

Then run:

```bash
npm run calibrate:profiles
```

The script updates `src/config/profileThresholds.json` with averaged values.

## Correction Fixtures

Correction exports from `/corrections` can be imported into `fixtures/corrections/`.

Default import source: `~/Downloads/corrections`

```bash
npm run import:corrections
```

Custom source path:

```bash
npm run import:corrections -- /absolute/path/to/corrections
```

Import output:
- `fixtures/corrections/labels/*.corrections.json`
- `fixtures/corrections/images/*`
- `fixtures/corrections/manifest.json`

Train parser tuning from imported corrections:

```bash
npm run tune:parser
```

This generates:
- `src/config/parserTuning.json`
- `src/data/letterPrototypes.json`
- `fixtures/corrections/tuning-report.json`
