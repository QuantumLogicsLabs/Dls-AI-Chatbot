/**
 * scripts/ingest.js
 * One-time script to read DLD/DLS books from the /data folder,
 * chunk them, and upload to Pinecone using integrated inference
 * (llama-text-embed-v2 — Pinecone handles embedding automatically).
 *
 * Usage:
 *   node scripts/ingest.js
 *
 * Supported file types: .txt, .pdf
 * Place your books inside the /data folder before running.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Pinecone } = require('@pinecone-database/pinecone');

// ── Config ────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dls-chatbot';
const NAMESPACE = 'dls-books';
const CHUNK_SIZE = 500;      // words per chunk
const CHUNK_OVERLAP = 50;    // words overlap between chunks
const BATCH_SIZE = 50;       // records per upsert batch
const BATCH_DELAY_MS = 15000; // 15s delay between batches to stay under rate limit

// ── Pinecone client ───────────────────────────────────────────────────────────
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Splits text into overlapping word-based chunks.
 */
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 50) { // skip tiny chunks
      chunks.push(chunk.trim());
    }
    if (i + chunkSize >= words.length) break;
  }

  return chunks;
}

/**
 * Reads a .txt file and returns its text content.
 */
function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Reads a .pdf file and returns its text content.
 * Supports both pdf-parse v1 (default function) and v2 (PDFParse class with getText).
 */
async function readPdfFile(filePath) {
  const pdfLib = require('pdf-parse');

  // pdf-parse v1: module exports a function directly
  if (typeof pdfLib === 'function') {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfLib(buffer);
    return data.text || '';
  }

  // pdf-parse v2: exports { PDFParse } class with getText() method
  if (pdfLib.PDFParse) {
    const { PDFParse } = pdfLib;
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const result = await parser.getText();
    // result.pages is an array of { text, num }
    if (result.pages && Array.isArray(result.pages)) {
      return result.pages.map((p) => p.text || '').join('\n');
    }
    return result.text || '';
  }

  throw new Error('Unsupported pdf-parse version — cannot extract text.');
}

/**
 * Extracts a rough chapter name from filename.
 */
function getChapterFromFilename(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Uploads records in batches using Pinecone integrated inference.
 * Pinecone SDK v8 expects upsertRecords({ records: [...] })
 */
async function uploadBatch(index, records) {
  // SDK v8 signature: upsertRecords(options) where options = { records: RecordArray }
  // SDK v1-v7 signature: upsertRecords(records: RecordArray)
  try {
    await index.upsertRecords({ records });
  } catch (e) {
    if (e?.message?.includes('records is not iterable') || e?.message?.includes('options.records')) {
      // fallback: try passing array directly (older SDK)
      await index.upsertRecords(records);
    } else {
      throw e;
    }
  }
  console.log(`  ✓ Uploaded batch of ${records.length} records`);
}

/**
 * Sleep helper — used to respect Pinecone's rate limit.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 DLS Chatbot — Book Ingestion Script');
  console.log('======================================\n');

  // Check data folder exists
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`❌ /data folder not found at: ${DATA_DIR}`);
    console.log('   Create a /data folder and add your DLD/DLS books (.txt or .pdf) into it.');
    process.exit(1);
  }

  // Get list of supported files
  const files = fs.readdirSync(DATA_DIR).filter((f) =>
    ['.txt', '.pdf'].includes(path.extname(f).toLowerCase())
  );

  if (!files.length) {
    console.error('❌ No .txt or .pdf files found in /data folder.');
    console.log('   Add your DLD/DLS books to the /data folder and run again.');
    process.exit(1);
  }

  console.log(`📚 Found ${files.length} file(s): ${files.join(', ')}\n`);

  // Get Pinecone index with namespace
  const index = pinecone.index(INDEX_NAME).namespace(NAMESPACE);

  let totalChunks = 0;

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const ext = path.extname(file).toLowerCase();
    const chapter = getChapterFromFilename(file);

    console.log(`📖 Processing: ${file}`);

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

    // Build records for Pinecone integrated inference
    // "_node_type": "TextNode" is required for llama-text-embed-v2
    const records = chunks.map((chunk, idx) => ({
      _id: uuidv4(),
      text: chunk,
      source: file,
      chapter: chapter,
      chunk_index: idx,
    }));

    // Upload in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await uploadBatch(index, batch);
      // Respect Pinecone free-tier rate limit: pause between batches
      if (i + BATCH_SIZE < records.length) {
        process.stdout.write(`  ⏳ Rate-limit pause (${BATCH_DELAY_MS / 1000}s)...\r`);
        await sleep(BATCH_DELAY_MS);
      }
    }

    totalChunks += chunks.length;
    console.log(`  ✅ Done: ${file}\n`);
  }

  console.log('======================================');
  console.log(`✅ Ingestion complete!`);
  console.log(`   Total chunks uploaded: ${totalChunks}`);
  console.log(`   Index: ${INDEX_NAME} | Namespace: ${NAMESPACE}`);
  console.log('\nYour chatbot will now answer from your DLD/DLS books! 🎉\n');
}

main().catch((err) => {
  console.error('\n❌ Ingestion failed:', err.message || err);
  process.exit(1);
});
