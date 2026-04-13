import { unzip, zip, strToU8, strFromU8 } from 'fflate';
import type {
  AssetManifest,
  SpatialBlock,
  SpatialCanvasDocument,
  SpatialInkStroke,
} from './spatial-types';
import { DEFAULT_CANVAS_WIDTH } from './spatial-types';

interface ManifestJson {
  version: 2;
  canvasWidth: number;
  assets: AssetManifest;
}

const BLOCK_DELIMITER_RE = /^<!--\s*@block\s+id="([^"]+)"\s+y="(-?\d+(?:\.\d+)?)"\s*-->$/;

function buildContentMd(blocks: SpatialBlock[]): string {
  // Each block is preceded by a delimiter comment carrying its id and Y
  // position so deserialize can recover both without needing a separate
  // block map file. Blocks are separated by a single blank line (one "\n\n"
  // between each delimiter/content pair — matches markdownFromChunks).
  const parts: string[] = [];
  for (const b of blocks) {
    parts.push(`<!-- @block id="${b.id}" y="${b.yPosition}" -->`);
    parts.push(b.content);
  }
  return parts.join('\n');
}

function parseContentMd(
  md: string,
  lineHeightPx: number,
): SpatialBlock[] {
  if (md.length === 0) return [];
  const lines = md.split('\n');
  const blocks: SpatialBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(BLOCK_DELIMITER_RE);
    if (!m) {
      // Skip stray blank lines between blocks.
      i++;
      continue;
    }
    const id = m[1];
    const y = parseFloat(m[2]);
    i++;
    // Collect content lines until the next delimiter or EOF. A single trailing
    // blank line between blocks (the separator) is dropped.
    const contentLines: string[] = [];
    while (i < lines.length && !BLOCK_DELIMITER_RE.test(lines[i])) {
      contentLines.push(lines[i]);
      i++;
    }
    // Trim exactly one trailing blank separator line if present.
    if (
      contentLines.length > 0 &&
      contentLines[contentLines.length - 1] === '' &&
      (i < lines.length || contentLines.length > 1)
    ) {
      contentLines.pop();
    }
    const content = contentLines.join('\n');
    const lineCount = content === '' ? 0 : content.split('\n').length;
    const height = lineCount * lineHeightPx;
    blocks.push({ id, type: 'text', yPosition: y, height, content });
  }

  return blocks;
}

async function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
}

/**
 * Serialize a SpatialCanvasDocument into a .graphite ZIP blob. Asset bytes
 * are not yet produced by any editor flow; the manifest still lists them so
 * consumers can resolve references once asset uploads are wired.
 */
export async function serializeToGraphite(
  doc: SpatialCanvasDocument,
): Promise<Uint8Array> {
  const manifest: ManifestJson = {
    version: 2,
    canvasWidth: doc.canvasWidth,
    assets: doc.assets,
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'content.md': strToU8(buildContentMd(doc.blocks)),
    'ink.json': strToU8(JSON.stringify(doc.inkStrokes)),
  };
  return zipAsync(files);
}

/**
 * Inverse of serializeToGraphite. Unknown files inside the archive are
 * ignored so future format additions remain backwards-compatible.
 */
export async function deserializeFromGraphite(
  data: Uint8Array,
): Promise<SpatialCanvasDocument> {
  const files = await unzipAsync(data);

  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('graphite: missing manifest.json');
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as ManifestJson;

  const contentBytes = files['content.md'];
  const contentMd = contentBytes ? strFromU8(contentBytes) : '';
  // Use a conservative line-height estimate for rebuilt blocks; consumers that
  // care about layout will re-measure via the block-heights plugin anyway.
  const blocks = parseContentMd(contentMd, 24);

  const inkBytes = files['ink.json'];
  const inkStrokes: SpatialInkStroke[] = inkBytes
    ? (JSON.parse(strFromU8(inkBytes)) as SpatialInkStroke[])
    : [];

  return {
    version: 2,
    canvasWidth: manifest.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    blocks,
    inkStrokes,
    assets: manifest.assets ?? { entries: [] },
  };
}

/**
 * Flattened plain text for the FTS5 body column. Only text-type blocks
 * contribute; images (and future asset types) are ignored.
 */
export function extractSearchableText(doc: SpatialCanvasDocument): string {
  return doc.blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.content)
    .join('\n');
}
