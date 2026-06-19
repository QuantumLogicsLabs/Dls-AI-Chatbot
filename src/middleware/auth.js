/**
 * src/middleware/auth.js
 * Verifies the JWT issued by the main DigitalLogicsStudio-Backend.
 * Accepts the token either via the `Authorization: Bearer <token>` header
 * or the `token` HTTP-only cookie — same contract as the main backend, so
 * no second login is required.
 */

import jwt from 'jsonwebtoken';

export function extractToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  return null;
}

export function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required. Provide a Bearer token or valid session cookie.',
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth.middleware] JWT_SECRET is not configured.');
    return res.status(500).json({
      error: 'Server misconfiguration: missing JWT secret.',
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      const message = err.name === 'TokenExpiredError'
        ? 'Session expired. Please log in again.'
        : 'Invalid authentication token.';
      return res.status(401).json({ error: message });
    }

    req.user = decoded;
    next();
  });
}
