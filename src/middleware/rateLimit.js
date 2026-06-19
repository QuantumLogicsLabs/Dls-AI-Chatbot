/**
 * src/middleware/rateLimit.js
 * Per-user token-bucket-style rate limiting so a busy classroom can't
 * exhaust the shared Groq daily quota. Keyed by the authenticated user's
 * id (falls back to IP if, for some reason, this runs before auth).
 */

import rateLimit from 'express-rate-limit';

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX, 10) || 20;

export const chatRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user && (req.user.id || req.user._id)) {
      return String(req.user.id || req.user._id);
    }
    return req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests. Please wait a moment before asking again.',
    });
  },
});