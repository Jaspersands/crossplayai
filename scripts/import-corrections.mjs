import { mkdir, readdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const SOURCE_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.homedir(), 'Downloads', 'corrections');

const DEST_ROOT = path.join(ROOT, 'fixtures', 'corrections');
const DEST_LABELS = path.join(DEST_ROOT, 'labels');
const DEST_IMAGES = path.join(DEST_ROOT, 'images');
const MANIFEST_FILE = path.join(DEST_ROOT, 'manifest.json');

const SEARCH_DIRS = [
  path.dirname(SOURCE_DIR),
  path.join(path.dirname(SOURCE_DIR), 'pictures'),
  path.join(path.dirname(SOURCE_DIR), 'Pictures'),
  SOURCE_DIR,
  path.join(os.homedir(), 'Pictures'),
  path.join(os.homedir(), 'Desktop'),
];

function normalizeName(name) {
  return name.normalize('NFC').toLowerCase();
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function findImage(sourceFilename) {
  for (const dir of SEARCH_DIRS) {
    const direct = path.join(dir, sourceFilename);
    if (await fileExists(direct)) {
      return direct;
    }

    let entries = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    const normalizedTarget = normalizeName(sourceFilename);
    const match = entries.find((entry) => normalizeName(entry) === normalizedTarget);
    if (match) {
      const matchedPath = path.join(dir, match);
      if (await fileExists(matchedPath)) {
        return matchedPath;
      }
    }
  }

  return null;
}

function buildImageOutputName(labelFileName, sourceFilename) {
  const labelBase = labelFileName.replace(/\.corrections\.json$/i, '');
  const ext = path.extname(sourceFilename) || '.png';
  return `${labelBase}${ext}`;
}

async function main() {
  await mkdir(DEST_LABELS, { recursive: true });
  await mkdir(DEST_IMAGES, { recursive: true });

  const allFiles = await readdir(SOURCE_DIR);
  const jsonFiles = allFiles.filter((file) => file.endsWith('.corrections.json')).sort();

  if (jsonFiles.length === 0) {
    console.error(`No correction JSON files found in ${SOURCE_DIR}`);
    process.exitCode = 1;
    return;
  }

  const manifest = [];
  const missingImages = [];
  const existingImages = await readdir(DEST_IMAGES);
  const existingImageByBase = new Map();
  for (const fileName of existingImages) {
    const parsed = path.parse(fileName);
    existingImageByBase.set(normalizeName(parsed.name), fileName);
  }

  for (const jsonFile of jsonFiles) {
    const sourceJsonPath = path.join(SOURCE_DIR, jsonFile);
    const raw = await readFile(sourceJsonPath, 'utf8');
    const parsed = JSON.parse(raw);

    const sourceFilename = parsed?.source?.filename;
    const profile = parsed?.source?.profile ?? 'unknown';
    const exportedAt = parsed?.source?.exportedAt ?? null;

    if (!sourceFilename) {
      console.warn(`Skipping ${jsonFile}: missing source.filename`);
      continue;
    }

    const destJsonPath = path.join(DEST_LABELS, jsonFile);
    await copyFile(sourceJsonPath, destJsonPath);

    const imagePath = await findImage(sourceFilename);
    let imageFile = null;

    if (imagePath) {
      imageFile = buildImageOutputName(jsonFile, sourceFilename);
      const destImagePath = path.join(DEST_IMAGES, imageFile);
      await copyFile(imagePath, destImagePath);
      existingImageByBase.set(
        normalizeName(path.parse(imageFile).name),
        imageFile,
      );
    } else {
      const labelBase = jsonFile.replace(/\.corrections\.json$/i, '');
      const fallbackImage = existingImageByBase.get(normalizeName(labelBase)) ?? null;
      if (fallbackImage) {
        imageFile = fallbackImage;
      } else {
        missingImages.push({ jsonFile, sourceFilename });
      }
    }

    manifest.push({
      labelFile: path.relative(DEST_ROOT, destJsonPath),
      imageFile: imageFile ? path.relative(DEST_ROOT, path.join(DEST_IMAGES, imageFile)) : null,
      sourceFilename,
      profile,
      exportedAt,
      parserConfidence: parsed?.parser?.confidence ?? null,
      lowConfidenceCount: Array.isArray(parsed?.parser?.lowConfidenceCells)
        ? parsed.parser.lowConfidenceCells.length
        : 0,
    });
  }

  await writeFile(
    MANIFEST_FILE,
    `${JSON.stringify({
      sourceDir: SOURCE_DIR,
      importedAt: new Date().toISOString(),
      count: manifest.length,
      missingImages,
      items: manifest,
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(`Imported ${manifest.length} correction labels into ${DEST_LABELS}`);
  const withImages = manifest.filter((item) => item.imageFile).length;
  console.log(`Matched screenshots: ${withImages}/${manifest.length}`);

  if (missingImages.length > 0) {
    console.warn('Missing source screenshots for:');
    for (const miss of missingImages) {
      console.warn(`- ${miss.sourceFilename} (from ${miss.jsonFile})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
