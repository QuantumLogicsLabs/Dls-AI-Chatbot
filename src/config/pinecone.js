/**
 * src/config/pinecone.js
 * Initializes and exports a singleton Pinecone client and index reference.
 * Uses Pinecone's built-in llama-text-embed-v2 model for embeddings,
 * so no separate embedding API is needed.
 */

const { Pinecone } = require('@pinecone-database/pinecone');

if (!process.env.PINECONE_API_KEY) {
  console.error('[pinecone.config] PINECONE_API_KEY is missing from environment variables.');
}

const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dls-chatbot';
const TOP_K = parseInt(process.env.PINECONE_TOP_K, 10) || 5;

/**
 * Returns the Pinecone index with integrated inference (built-in embedding).
 */
function getPineconeIndex() {
  return pineconeClient.index(INDEX_NAME).namespace('dls-books');
}

module.exports = {
  pineconeClient,
  getPineconeIndex,
  INDEX_NAME,
  TOP_K,
};
