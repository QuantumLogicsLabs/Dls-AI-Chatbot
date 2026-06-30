/**
 * src/controllers/chatController.js
 * Request handlers for POST /api/ai/chat and POST /api/ai/chat/stream.
 * Now RAG-enabled: retrieves relevant DLD/DLS book chunks from Pinecone
 * before sending the prompt to Groq.
 */

const { groqClient, GROQ_DEFAULTS } = require('../config/groq');
const { buildSystemPrompt } = require('../prompts/systemPrompt');
const { retrieveContext } = require('../services/retrieval');

function validateBody(req, res) {
  const { message } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: '"message" is required and must be a non-empty string.' });
    return null;
  }

  if (message.length > 4000) {
    res.status(400).json({ error: '"message" is too long (max 4000 characters).' });
    return null;
  }

  const context = (req.body && typeof req.body.context === 'object' && req.body.context) || {};
  return { message: message.trim(), context };
}

/**
 * Builds the final system prompt, injecting retrieved book context if available.
 */
async function buildRAGPrompt({ user, context, message }) {
  const systemPrompt = buildSystemPrompt({ user, context });

  // Search Pinecone for relevant chunks from DLD/DLS books
  const bookContext = await retrieveContext(message);

  if (!bookContext) {
    return systemPrompt; // No relevant chunks found — use base prompt
  }

  return `${systemPrompt}

---
RELEVANT CURRICULUM CONTENT (retrieved from DLD/DLS books):
Use the following excerpts to answer the student's question accurately.
If the answer is directly in the content below, prioritize it over general knowledge.

${bookContext}
---`;
}

/**
 * POST /api/ai/chat
 * Standard, non-streaming completion with RAG.
 */
async function handleChat(req, res) {
  const validated = validateBody(req, res);
  if (!validated) return;

  const { message, context } = validated;
  const systemPrompt = await buildRAGPrompt({ user: req.user, context, message });

  try {
    const completion = await groqClient.chat.completions.create({
      model: GROQ_DEFAULTS.model,
      max_tokens: GROQ_DEFAULTS.maxTokens,
      temperature: GROQ_DEFAULTS.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({
        error: 'Received an empty response from the AI provider. Please try again.',
      });
    }

    return res.status(200).json({
      reply,
      model: GROQ_DEFAULTS.model,
      tokensUsed: completion?.usage?.total_tokens ?? null,
    });
  } catch (err) {
    console.error('[chatController.handleChat] Groq request failed:', err?.message || err);
    return res.status(503).json({
      error: 'The AI assistant is temporarily unavailable. Please try again shortly.',
    });
  }
}

/**
 * POST /api/ai/chat/stream
 * Streaming SSE completion with RAG.
 */
async function handleChatStream(req, res) {
  const validated = validateBody(req, res);
  if (!validated) return;

  const { message, context } = validated;
  const systemPrompt = await buildRAGPrompt({ user: req.user, context, message });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    const stream = await groqClient.chat.completions.create({
      model: GROQ_DEFAULTS.model,
      max_tokens: GROQ_DEFAULTS.maxTokens,
      temperature: GROQ_DEFAULTS.temperature,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    for await (const chunk of stream) {
      if (closed) break;
      const token = chunk?.choices?.[0]?.delta?.content;
      if (token) {
        sendEvent({ token });
      }
    }

    if (!closed) {
      sendEvent({ done: true });
      res.end();
    }
  } catch (err) {
    console.error('[chatController.handleChatStream] Groq stream failed:', err?.message || err);
    if (!closed) {
      sendEvent({ error: 'The AI assistant is temporarily unavailable. Please try again shortly.' });
      res.end();
    }
  }
}

module.exports = {
  handleChat,
  handleChatStream,
};
