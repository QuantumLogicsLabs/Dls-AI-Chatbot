import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { chatRateLimiter } from '../src/middleware/rateLimit.js';

// Mocking Groq SDK so we don't hit the real live API billing quota during tests
vi.mock('../src/config/groq.js', () => {
  return {
    GROQ_DEFAULTS: {
      model: 'mock-llama-model',
      maxTokens: 1024,
      temperature: 0.5,
    },
    groqClient: {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (options) => {
            // If the streaming flag is passed, return an async generator mock
            if (options.stream) {
              return (async function* () {
                yield { choices: [{ delta: { content: 'Hello ' } }] };
                yield { choices: [{ delta: { content: 'world!' } }] };
              })();
            }
            // Standard non-streaming mock payload
            return {
              choices: [{ message: { content: 'Mocked AI Response' } }],
              usage: { total_tokens: 15 },
            };
          }),
        },
      },
    },
  };
});

describe('DLS AI Chatbot Service Integration Tests', () => {
  const JWT_SECRET = 'test-secret-key-12345';
  let validToken;

  beforeAll(() => {
    // Inject the necessary environment variables required by your middlewares
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.RATE_LIMIT_WINDOW_MS = '10000'; // 10s window
    process.env.RATE_LIMIT_MAX = '3'; // Low ceiling to easily trigger 429 tests

    // Sign a mock token mimicking the main DigitalLogicsStudio-Backend payload
    validToken = jwt.sign({ id: 'user_123', name: 'Test Student' }, JWT_SECRET, {
      expiresIn: '1h',
    });
  });

  // 1. GET /health
  it('GET /health returns 200 and operational metadata', async () => {
    const res = await request(app).get('/health');
    
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      service: 'dls-ai-chatbot',
    });
  });

  // 2. Invalid/missing JWT correctly returns 401
  it('POST /api/ai/chat returns 401 unauthorized if JWT is missing or invalid', async () => {
    // Missing Token entirely
    const noTokenRes = await request(app)
      .post('/api/ai/chat')
      .send({ message: 'Hi' });
    expect(noTokenRes.status).toBe(401);
    expect(noTokenRes.body.error).toContain('Authentication required');

    // Invalid Secret Token
    const badToken = jwt.sign({ id: 'hacker' }, 'wrong-secret');
    const badTokenRes = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${badToken}`)
      .send({ message: 'Hi' });
    expect(badTokenRes.status).toBe(401);
    expect(badTokenRes.body.error).toContain('Invalid authentication token');
  });

  // 3. POST /api/ai/chat returns a sensible reply with a valid JWT
  it('POST /api/ai/chat returns a sensible reply when authorized via Bearer header', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ message: 'What is a logic gate?' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply', 'Mocked AI Response');
    expect(res.body).toHaveProperty('model', 'mock-llama-model');
    expect(res.body).toHaveProperty('tokensUsed', 15);
  });

  // 4. POST /api/ai/chat/stream streams data: events and ends with {"done": true}
  it('POST /api/ai/chat/stream streams SSE token events and closes cleanly', async () => {
    const res = await request(app)
      .post('/api/ai/chat/stream')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ message: 'Stream this message please' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    // Process the text chunks into individual event lines
    const textChunks = res.text.split('\n\n').filter(Boolean);
    
    expect(textChunks[0]).toBe('data: {"token":"Hello "}');
    expect(textChunks[1]).toBe('data: {"token":"world!"}');
    expect(textChunks[2]).toBe('data: {"done":true}');
  });

  // 5. Rate limiting still triggers a 429 after RATE_LIMIT_MAX requests
  it('Rate limiting triggers a 429 status after exhausting maximum allowed requests', async () => {

  if (typeof chatRateLimiter?.resetKey === 'function') {
    chatRateLimiter.resetKey('user_123');
  }

  const triggerThreshold = 20; 

  for (let i = 0; i < triggerThreshold; i++) {
    const okRes = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ message: `Request count ${i}` });
 
        if (okRes.status !== 200) {
        console.error(`Failed early at iteration ${i} with body:`, okRes.body);
        }
        
        expect(okRes.status).toBe(200);
    }

    // The next request must trigger a 429
    const limitedRes = await request(app)
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ message: 'Over the limit request' });

    expect(limitedRes.status).toBe(429);
    });
});
