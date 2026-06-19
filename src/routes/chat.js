/**
 * src/routes/chat.js
 * POST /api/ai/chat
 * POST /api/ai/chat/stream
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { chatRateLimiter } from '../middleware/rateLimit.js';
import { handleChat, handleChatStream } from '../controllers/chatController.js';

const router = express.Router();

router.post('/chat', requireAuth, chatRateLimiter, handleChat);
router.post('/chat/stream', requireAuth, chatRateLimiter, handleChatStream);

export default router;
