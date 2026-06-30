# DLS AI Chatbot

An intelligent, context-aware AI assistant built for **Digital Logics Studio (Boolforge)**. Powered by the [Groq API](https://console.groq.com/), it delivers fast, curriculum-grounded responses on digital logic, Boolean algebra, number systems, sequential circuits, and all topics covered in the DLS curriculum. Answers are backed by a Pinecone vector database of DLD/DLS textbooks, so the bot retrieves real curriculum content instead of relying only on the base model's general knowledge. The repo also includes a local chatbot UI at [index.html](index.html).

---

## Overview

The DLS AI Chatbot is a dedicated microservice that plugs into the existing Boolforge + DigitalLogicsStudio-Backend ecosystem. It exposes a REST endpoint that the frontend calls whenever a user sends a message. On each request, it builds a personalized system prompt from the user's learning context (current topic, recent topics, tools used, difficulty level), retrieves relevant excerpts from your ingested DLD/DLS books via Pinecone, and sends both to Groq for a grounded, curriculum-accurate completion.

```
Dls-AI-Chatbot/
├── data/
│   └── README.md                # Where to drop DLD/DLS books for ingestion
├── scripts/
│   └── ingest.js                # Chunks books and uploads to Pinecone
├── src/
│   ├── config/
│   │   ├── groq.js              # Groq client initialization
│   │   └── pinecone.js          # Pinecone client + index reference
│   ├── controllers/
│   │   └── chatController.js    # Request handler, builds RAG-augmented prompt
│   ├── middleware/
│   │   ├── auth.js              # Reuses JWT verification from main backend
│   │   └── rateLimit.js         # Per-user message throttling
│   ├── prompts/
│   │   └── systemPrompt.js      # Personalized system prompt builder
│   ├── routes/
│   │   └── chat.js              # POST /api/ai/chat, POST /api/ai/chat/stream
│   ├── services/
│   │   └── retrieval.js         # Pinecone similarity search for RAG context
│   └── app.js
├── index.html                   # Standalone local testing UI
├── .env.example
├── server.js
├── package.json
└── README.md
```

---

## Features

- **Personalized responses** — The system prompt is dynamically assembled from the user's JWT profile, current topic, recently visited pages, and tools they have interacted with.
- **Retrieval-Augmented Generation (RAG)** — Ingested DLD/DLS textbooks are chunked and stored in Pinecone. Every question triggers a similarity search, and the most relevant book excerpts are injected into the prompt before the model answers, grounding responses in actual curriculum content instead of the model's general training data.
- **Groq-powered speed** — Uses `llama-3.3-70b-versatile` via Groq's inference API for near-instant completions, even for complex logic explanations.
- **Curriculum-aware context** — The chatbot knows the full DLS topic tree (Boolean Algebra, Number Systems, Arithmetic Circuits, Memory, Sequential Circuits) and steers answers to match the learner's current module.
- **Streaming support** — SSE streaming endpoint for character-by-character output.
- **Local onboarding** — The bundled UI asks for the learner's name, level, and starting topic before chatting.
- **Rate limiting** — Per-user token bucket prevents API quota abuse without interrupting legitimate learning sessions.
- **JWT-gated** — Reuses the same HTTP-only cookie and JWT secret from the main backend in production, while allowing localhost development access for the local UI.
- **Graceful RAG fallback** — If Pinecone is unreachable or returns no relevant matches, the bot still answers using the base system prompt and Groq's general knowledge. Retrieval failures never block a response.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express |
| AI Provider | Groq Cloud API |
| Model | `llama-3.3-70b-versatile` (default) |
| Vector Database | Pinecone (serverless, integrated inference) |
| Embedding Model | `llama-text-embed-v2` (handled automatically by Pinecone) |
| PDF Parsing | `pdf-parse` |
| Auth | JWT (shared secret with main backend) |
| Rate Limiting | `express-rate-limit` |
| HTTP Client | `groq-sdk` (official) |
| Streaming | Server-Sent Events (SSE) |

---

## Environment

Create a `.env` file from `.env.example`:

```env
PORT=5100
NODE_ENV=development

# Groq
GROQ_API_KEY=your-groq-api-key-here
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_MAX_TOKENS=1024
GROQ_TEMPERATURE=0.5

# Shared with main backend — must match exactly
JWT_SECRET=replace-with-the-same-secret-as-main-backend

# CORS — point at the Boolforge frontend
CLIENT_URL=http://localhost:3000

# Rate limiting (requests per user per minute)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=20

# Pinecone (RAG vector database)
PINECONE_API_KEY=your-pinecone-api-key-here
PINECONE_INDEX_NAME=dls-chatbot
PINECONE_TOP_K=5
```

> **Note:** `GROQ_TEMPERATURE=0.5` is intentionally moderate — low enough for factually grounded logic explanations, high enough to keep prose natural. Raise it toward `0.8` for more conversational tone, lower toward `0.2` for stricter technical answers.

> **Pinecone setup:** create a serverless index named to match `PINECONE_INDEX_NAME`, using the "Integrated" embedding configuration with model `llama-text-embed-v2`. No separate embedding API call is needed — Pinecone embeds both the ingested chunks and the incoming query automatically.

---

## Installation

```bash
# From the monorepo root (sibling to DigitalLogicsStudio-Backend)
cd Dls-AI-Chatbot

npm install
```

---

## Ingesting Curriculum Books (RAG setup)

Before the bot can answer from your textbooks, you need to ingest them into Pinecone:

1. Drop `.pdf` or `.txt` files into the `/data` folder. See `data/README.md` for suggested books.
2. Run the ingestion script:
   ```bash
   npm run ingest
   ```
   or directly:
   ```bash
   node scripts/ingest.js
   ```
3. The script chunks each book (500 words per chunk, 50-word overlap), labels chunks with the source filename, and uploads them to the `dls-books` namespace in your Pinecone index, in batches of 50 with a 15-second pause between batches to respect rate limits.
4. Confirm the upload in your Pinecone dashboard — vector count in the `dls-books` namespace should match the total chunks printed at the end of the script.

Re-run `npm run ingest` any time you add new books. Book files are git-ignored (copyright) — only `data/README.md` is tracked.

---

## Running

Development (with auto-restart):

```bash
npm run dev
```

Production:

```bash
npm start
```

The service listens on `PORT` (default `5100`) and is completely independent of the main backend process. Run both simultaneously.

Local UI:

```text
http://localhost:5100
```

The local UI is included in the repo and served as a static file from Express.

---

## API Reference

### `POST /api/ai/chat`

Send a user message and receive a personalized, curriculum-grounded AI response.

**Auth:** Required in production — valid JWT in `Authorization: Bearer <token>` header or the `token` HTTP-only cookie (same as the main backend). In local development, localhost requests are allowed without a token so you can test the UI quickly.

**Request body:**

```json
{
  "message": "How does a JK flip-flop differ from a SR flip-flop?",
  "context": {
    "name": "Ali",
    "currentTopic": "sequential-circuits",
    "recentTopics": ["boolean-algebra", "arithmetic-circuits"],
    "toolsUsed": ["circuit-forge"],
    "difficulty": "intermediate"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | The user's question or message |
| `context.name` | string | No | Learner's name for personalization (used when no JWT is present, e.g. local UI) |
| `context.currentTopic` | string | No | Slug of the page the user is currently on |
| `context.recentTopics` | string[] | No | Ordered list of recently visited topic slugs (max 10 used) |
| `context.toolsUsed` | string[] | No | Tools the user has interacted with this session (max 10 used) |
| `context.difficulty` | string | No | One of `beginner`, `intermediate`, `advanced`. Defaults to `intermediate` if missing or invalid |

Internally, every request also triggers a Pinecone similarity search against the `message` text. Matching book excerpts above the relevance threshold are injected into the prompt automatically — no extra fields are needed to enable this.

**Response `200`:**

```json
{
  "reply": "A SR flip-flop has an undefined (invalid) state when both S and R are HIGH simultaneously...",
  "model": "llama-3.3-70b-versatile",
  "tokensUsed": 312
}
```

**Response `429`:**

```json
{
  "error": "Too many requests. Please wait a moment before asking again."
}
```

---

### `POST /api/ai/chat/stream`

Same request contract as `/api/ai/chat`, including RAG retrieval. Returns a `text/event-stream` (SSE) response that streams the reply token by token.

**Frontend usage:**

```js
const response = await fetch('/api/ai/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, context })
});
```

---

## Personalization System

`src/prompts/systemPrompt.js` assembles the base system prompt at request time:

```
You are DLS Mentor, an expert teaching assistant for Digital Logics Studio —
an interactive platform for learning digital logic and Boolean algebra.

Student profile:
- Name: {user.name or context.name or "there"}
- Current topic: {context.currentTopic}
- Recently studied: Boolean Algebra → Arithmetic Circuits
- Tools used this session: Circuit Forge
- Difficulty level: {context.difficulty || "Intermediate"}

Curriculum scope:
1. Boolean Algebra (gates, expressions, simplification, De Morgan's)
2. Number Systems (binary, octal, hex, BCD, conversions)
3. Arithmetic Circuits (half adder, full adder, subtractor, comparator)
4. Memory (latches, flip-flops, registers, RAM/ROM)
5. Sequential Circuits (FSMs, counters, shift registers)

Persona and tone:
- Speak directly to {name} by name when it feels natural.
- Adjust depth based on difficulty level.
- Use concrete examples, truth tables, and circuit analogies liberally.
- If the question is outside digital logic, politely redirect back to the curriculum.
- Keep answers concise but complete. Prefer numbered steps for procedures.
```

`src/controllers/chatController.js` then wraps this with retrieved book content before sending to Groq:

```
{base system prompt}
---
RELEVANT CURRICULUM CONTENT (retrieved from DLD/DLS books):
Use the following excerpts to answer the student's question accurately.
If the answer is directly in the content below, prioritize it over general knowledge.
[1] Brian_Holdsworth_Digital_Logic_Design — Chapter 5:
{retrieved excerpt text}
---
```

If Pinecone returns no relevant matches (or the call fails), this block is omitted and the bot falls back to the base system prompt with Groq's general knowledge.

All user-supplied values (name, topic, recent topics, tools used) are sanitized before interpolation to strip newlines and control characters, preventing prompt injection via these fields.

---

## Frontend Integration

Add the following to Boolforge's `src/services/` directory:

```js
// src/services/aiService.js
import axios from 'axios';

const AI_URL = process.env.REACT_APP_AI_URL || 'http://localhost:5100/api/ai';

export const sendMessage = (message, context) =>
  axios.post(`${AI_URL}/chat`, { message, context }, { withCredentials: true });
```

Add `REACT_APP_AI_URL=http://localhost:5100/api/ai` to Boolforge's `.env`.

For local testing, open `http://localhost:5100` directly — Express serves `index.html` as a static file from the project root.

---

## Adding to the Monorepo

The recommended folder layout alongside the existing projects:

```
DigitalLogicsStudio/          ← Boolforge (React frontend)
DigitalLogicsStudio-Backend/  ← Express + MongoDB backend
Dls-AI-Chatbot/                ← this service
```

All three run independently. No changes to the main backend are required — the AI service shares only the `JWT_SECRET` value.

---

## Model Selection

Groq supports several models. Swap `GROQ_MODEL` in `.env` to change:

| Model | Best for | Context window |
|---|---|---|
| `llama-3.3-70b-versatile` | Deep, accurate explanations (default) | 131,072 tokens |
| `llama-3.1-8b-instant` | Fast, lightweight answers | 131,072 tokens |
| `openai/gpt-oss-120b` | Long multi-turn conversations | 131,072 tokens |
| `openai/gpt-oss-20b` | Instruction-tuned, concise answers | 131,072 tokens |

---

## Rate Limits & Quota

Check the [Groq limits page](https://console.groq.com/settings/limits) for current daily request and token-per-minute caps on your plan. The built-in per-user rate limiter (`RATE_LIMIT_MAX=20` per minute) ensures a busy classroom does not exhaust the daily quota.

Pinecone's free tier also has its own request rate limits — `scripts/ingest.js` pauses 15 seconds between upload batches to stay under them during ingestion. Query-time retrieval (one search per chat message) is lightweight and unlikely to hit limits under normal classroom use.

---

## Notes

- `.env` is git-ignored; `.env.example` is tracked.
- Book files in `/data` (`.pdf`, `.txt`) are git-ignored for copyright reasons. Only `data/README.md` is tracked.
- `package-lock.json` is tracked for reproducible installs.
- The service is stateless per request — conversation history is not persisted server-side, and RAG retrieval runs fresh on every message with no memory of prior turns. If you want multi-turn memory, send the last N message pairs in the request body and include them in the prompt builder.
- The bundled local UI is meant for quick testing and onboarding, while the API remains the integration surface for Boolforge or any other frontend.

---

## License

Proprietary License. All rights reserved.
