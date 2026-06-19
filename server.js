/**
 * server.js
 * Entry point — loads environment variables and starts the HTTP server.
 * Runs completely independently of the main DigitalLogicsStudio-Backend
 * process; only the JWT_SECRET is shared between the two.
 */

import 'dotenv/config';
import app from './src/app.js'; 

const PORT = process.env.PORT || 5100;

const server = app.listen(PORT, () => {
  console.log(`[dls-ai-chatbot] listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

process.on('SIGTERM', () => {
  console.log('[dls-ai-chatbot] SIGTERM received, shutting down gracefully.');
  server.close(() => process.exit(0));
});

process.on('unhandledRejection', (reason) => {
  console.error('[dls-ai-chatbot] Unhandled promise rejection:', reason);
});
