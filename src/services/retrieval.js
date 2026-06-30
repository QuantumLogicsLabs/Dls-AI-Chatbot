/**
 * src/services/retrieval.js
 * Queries Pinecone using integrated inference (llama-text-embed-v2).
 * Converts the user's question into a vector and retrieves the top-K
 * most relevant chunks from the DLD/DLS books.
 */

const { getPineconeIndex, TOP_K } = require('../config/pinecone');

/**
 * Searches Pinecone for relevant book chunks matching the query.
 * @param {string} query - The user's question
 * @returns {Promise<string>} - Formatted context string to inject into prompt
 */
async function retrieveContext(query) {
  try {
    const index = getPineconeIndex();

    // Use Pinecone's integrated inference — no separate embedding call needed
    const results = await index.searchRecords({
      query: {
        inputs: { text: query },
        topK: TOP_K,
      },
      fields: ['text', 'source', 'chapter'],
    });

    const matches = results?.result?.hits || [];

    if (!matches.length) {
      return null;
    }

    // Format retrieved chunks into a readable context block
    const contextChunks = matches
      .filter((match) => match._score > 0.5) // only use relevant results
      .map((match, i) => {
        const source = match.fields?.source || 'Unknown source';
        const chapter = match.fields?.chapter || '';
        const text = match.fields?.text || '';
        const label = chapter ? `${source} — ${chapter}` : source;
        return `[${i + 1}] ${label}:\n${text}`;
      });

    if (!contextChunks.length) return null;

    return contextChunks.join('\n\n');
  } catch (err) {
    console.error('[retrieval] Pinecone search failed:', err?.message || err);
    return null; // Gracefully fall back — bot still answers without RAG context
  }
}

module.exports = { retrieveContext };
