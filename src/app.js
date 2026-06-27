/**
 * src/app.js
 * Express application setup: middleware, CORS, and route mounting.
 * Exported separately from server.js so it can be imported in tests
 * without binding a port.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const chatRoutes = require('./routes/chat');

const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// Serve the local test UI (index.html) from the project root
app.use(express.static(path.join(__dirname, '..')));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'dls-ai-chatbot' });
});

app.use('/api/ai', chatRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Centralized error handler (e.g. malformed JSON body)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }
  console.error('[app] Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
