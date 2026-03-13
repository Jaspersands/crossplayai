import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, 'fixtures', 'calibration');
const OUTPUT_FILE = path.join(ROOT, 'src', 'config', 'profileThresholds.json');

const PROFILES = ['ios', 'android'];

function average(values) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function main() {
  const files = await readdir(FIXTURE_DIR);
  const jsonFiles = files.filter((file) => file.endsWith('.json'));

  if (jsonFiles.length === 0) {
    console.error('No fixture JSON files found in fixtures/calibration');
    process.exitCode = 1;
    return;
  }

  const grouped = {
    ios: [],
    android: [],
  };

  for (const file of jsonFiles) {
    const fullPath = path.join(FIXTURE_DIR, file);
    const raw = await readFile(fullPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!PROFILES.includes(parsed.profile)) {
      console.warn(`Skipping ${file}: invalid profile`);
      continue;
    }

    grouped[parsed.profile].push(parsed);
  }

  const output = {};

  for (const profile of PROFILES) {
    const rows = grouped[profile];
    if (rows.length === 0) {
      console.warn(`No ${profile} fixtures found; keeping defaults requires manual merge.`);
      continue;
    }

    output[profile] = {
      boardOccupiedDarkRatio: round(average(rows.map((row) => row.boardOccupiedDarkRatio))),
      boardOccupiedVariance: round(average(rows.map((row) => row.boardOccupiedVariance)), 2),
      rackOccupiedDarkRatio: round(average(rows.map((row) => row.rackOccupiedDarkRatio))),
      rackOccupiedVariance: round(average(rows.map((row) => row.rackOccupiedVariance)), 2),
      lowConfidence: round(average(rows.map((row) => row.lowConfidence))),
    };
  }

  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote calibrated thresholds to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
