/**
 * src/config/groq.js
 * Initializes and exports a singleton Groq client instance.
 */

import Groq from 'groq-sdk';

if (!process.env.GROQ_API_KEY) {
  // Fail fast and loud — every request would 500 anyway without this.
  console.error('[groq.config] GROQ_API_KEY is missing from environment variables.');
}

export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const GROQ_DEFAULTS = {
  model: process.env.GROQ_MODEL || 'llama3-70b-8192',
  maxTokens: parseInt(process.env.GROQ_MAX_TOKENS, 10) || 1024,
  temperature: process.env.GROQ_TEMPERATURE !== undefined
    ? parseFloat(process.env.GROQ_TEMPERATURE)
    : 0.5,
};