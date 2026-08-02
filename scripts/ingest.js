/**
 * scripts/ingest.js
 * Reads DLD/DLS books from the /data folder (Dls-AI-DataSets submodule),
 * chunks them, and uploads to Pinecone using integrated inference
 * (llama-text-embed-v2 — Pinecone handles embedding automatically).
 *
 * Incremental by default: skips files whose content SHA matches
 * scripts/ingest-manifest.json. Use --force to re-ingest everything.
 *
 * Usage:
 *   node scripts/ingest.js
 *   node scripts/ingest.js --force
 *   npm run ingest
 *   npm run ingest:force
 *
 * Supported file types: .txt only
 */

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');

// ── Config ────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const MANIFEST_PATH = path.join(__dirname, 'ingest-manifest.json');
const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dls-chatbot';
const NAMESPACE = 'dls-books';
const ALLOWED_EXTENSIONS = ['.txt'];
const CHUNK_SIZE = 500; // words per chunk
const CHUNK_OVERLAP = 50; // words overlap between chunks
const BATCH_SIZE = 50; // records per upsert batch
const BATCH_DELAY_MS = 15000; // 15s delay between batches to stay under rate limit
const IGNORE_EMBEDDING_QUOTA_ERRORS =
  String(process.env.INGEST_IGNORE_EMBEDDING_QUOTA || '').toLowerCase() === 'true';

const FORCE = process.argv.includes('--force');

// ── Pinecone client ───────────────────────────────────────────────────────────
if (!process.env.PINECONE_API_KEY) {
  console.error('❌ PINECONE_API_KEY is missing. Set it in .env or the environment.');
  process.exit(1);
}

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 50) {
      chunks.push(chunk.trim());
    }
    if (i + chunkSize >= words.length) break;
  }

  return chunks;
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

async function readPdfFile(filePath) {
  const pdfLib = require('pdf-parse');

  if (typeof pdfLib === 'function') {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfLib(buffer);
    return data.text || '';
  }

  if (pdfLib.PDFParse) {
    const { PDFParse } = pdfLib;
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const result = await parser.getText();
    if (result.pages && Array.isArray(result.pages)) {
      return result.pages.map((p) => p.text || '').join('\n');
    }
    return result.text || '';
  }

  throw new Error('Unsupported pdf-parse version — cannot extract text.');
}

function getChapterFromFilename(filename) {
  return path
    .basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function deterministicId(source, chunkIndex) {
  return crypto.createHash('sha256').update(`${source}:${chunkIndex}`).digest('hex');
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch (err) {
    console.warn(`⚠️  Could not parse ingest manifest (${err.message}); starting fresh.`);
    return {};
  }
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

async function uploadBatch(index, records) {
  try {
    await index.upsertRecords({ records });
  } catch (e) {
    if (
      e?.message?.includes('records is not iterable') ||
      e?.message?.includes('options.records')
    ) {
      await index.upsertRecords(records);
    } else {
      throw e;
    }
  }
  console.log(`  ✓ Uploaded batch of ${records.length} records`);
}

/**
 * Removes prior vectors for a source file so changed content does not leave orphans.
 */
async function deleteBySource(index, source) {
  try {
    await index.deleteMany({ filter: { source: { $eq: source } } });
    console.log(`  🗑  Cleared previous vectors for source=${source}`);
  } catch (err) {
    // Some Pinecone configs disallow metadata-filter deletes; continue with upsert.
    console.warn(`  ⚠️  Could not delete by source (${err.message}); upserting anyway.`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEmbeddingQuotaExhaustedError(err) {
  const details = JSON.stringify({
    message: err?.message,
    error: err?.error,
    status: err?.status,
  });

  return /RESOURCE_EXHAUSTED/i.test(details) &&
    (/embedding token limit/i.test(details) || /llama-text-embed-v2/i.test(details) || /status\":429/i.test(details));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 DLS Chatbot — Book Ingestion Script');
  console.log('======================================');
  console.log(`Mode: ${FORCE ? 'force (re-ingest all)' : 'incremental'}\n`);

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`❌ /data folder not found at: ${DATA_DIR}`);
    console.log('   Init the Dls-AI-DataSets submodule, or add .txt/.pdf books to /data.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort();

  if (!files.length) {
    console.error('❌ No .txt files found in /data folder.');
    console.log('   Add .txt files to the data submodule and run again.');
    process.exit(1);
  }

  console.log(`📚 Found ${files.length} file(s)\n`);

  const index = pinecone.index(INDEX_NAME).namespace(NAMESPACE);
  const manifest = FORCE ? {} : loadManifest();

  let totalChunks = 0;
  let ingestedFiles = 0;
  let skippedFiles = 0;
  let duplicateFiles = 0;
  const seenHashes = new Map(); // sha256 -> canonical source filename

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const ext = path.extname(file).toLowerCase();
    const chapter = getChapterFromFilename(file);
    const fileHash = sha256File(filePath);

    console.log(`📖 ${file}`);

    const canonicalSource = seenHashes.get(fileHash);
    if (canonicalSource && canonicalSource !== file) {
      const alreadyMarkedDuplicate =
        !FORCE &&
        manifest[file]?.sha256 === fileHash &&
        manifest[file]?.duplicateOf === canonicalSource;

      // If this source was ever ingested with its own vectors, clear them once.
      if (!alreadyMarkedDuplicate && manifest[file]) {
        await deleteBySource(index, file);
      }

      manifest[file] = {
        sha256: fileHash,
        chunkCount: 0,
        duplicateOf: canonicalSource,
        deduplicatedAt: new Date().toISOString(),
      };
      saveManifest(manifest);

      duplicateFiles += 1;
      console.log(`  ⏭  Duplicate content of ${canonicalSource} (sha256 match) — skipping\n`);
      continue;
    }

    if (!canonicalSource) {
      seenHashes.set(fileHash, file);
    }

    if (!FORCE && manifest[file]?.sha256 === fileHash) {
      console.log(`  ⏭  Unchanged (sha256 match) — skipping\n`);
      skippedFiles += 1;
      continue;
    }

    const isUpdate = Boolean(manifest[file]);
    if (isUpdate || FORCE) {
      await deleteBySource(index, file);
    }

    let text = '';
    try {
      if (ext === '.txt') {
        text = readTextFile(filePath);
      } else if (ext === '.pdf') {
        text = await readPdfFile(filePath);
      }
    } catch (err) {
      console.error(`  ❌ Failed to read ${file}:`, err.message);
      continue;
    }

    if (!text.trim()) {
      console.warn(`  ⚠️  ${file} appears to be empty, skipping.`);
      continue;
    }

    const chunks = chunkText(text);
    console.log(`  → ${chunks.length} chunks created`);

    const records = chunks.map((chunk, idx) => ({
      _id: deterministicId(file, idx),
      text: chunk,
      source: file,
      chapter: chapter,
      chunk_index: idx,
      content_sha256: fileHash,
    }));

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await uploadBatch(index, batch);
      if (i + BATCH_SIZE < records.length) {
        process.stdout.write(`  ⏳ Rate-limit pause (${BATCH_DELAY_MS / 1000}s)...\r`);
        await sleep(BATCH_DELAY_MS);
      }
    }

    // Persist after each successful file so a mid-run failure does not mark unfinished work done.
    manifest[file] = {
      sha256: fileHash,
      chunkCount: chunks.length,
      ingestedAt: new Date().toISOString(),
    };
    saveManifest(manifest);

    totalChunks += chunks.length;
    ingestedFiles += 1;
    console.log(`  ✅ Done: ${file}\n`);
  }

  // Drop manifest entries for files that no longer exist in /data
  let pruned = 0;
  for (const key of Object.keys(manifest)) {
    if (!files.includes(key)) {
      await deleteBySource(index, key);
      delete manifest[key];
      pruned += 1;
    }
  }
  if (pruned > 0) {
    saveManifest(manifest);
    console.log(`🧹 Removed ${pruned} stale source(s) from Pinecone + manifest\n`);
  }

  console.log('======================================');
  console.log(`✅ Ingestion complete!`);
  console.log(`   Files ingested: ${ingestedFiles}`);
  console.log(`   Files skipped:  ${skippedFiles}`);
  console.log(`   Files deduped:  ${duplicateFiles}`);
  console.log(`   Chunks uploaded this run: ${totalChunks}`);
  console.log(`   Manifest: ${MANIFEST_PATH}`);
  console.log(`   Index: ${INDEX_NAME} | Namespace: ${NAMESPACE}`);
  console.log('\nYour chatbot will now answer from your DLD/DLS books! 🎉\n');
}

main().catch((err) => {
  if (IGNORE_EMBEDDING_QUOTA_ERRORS && isEmbeddingQuotaExhaustedError(err)) {
    console.warn('\n⚠️  Ingestion skipped due to Pinecone embedding quota exhaustion.');
    console.warn('   INGEST_IGNORE_EMBEDDING_QUOTA=true is set, so exiting successfully.');
    console.warn('   Upgrade plan or wait for monthly quota reset to resume embedding ingest.\n');
    process.exit(0);
  }

  console.error('\n❌ Ingestion failed:', err.message || err);
  process.exit(1);
});
