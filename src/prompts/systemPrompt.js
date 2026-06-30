/**
 * src/prompts/systemPrompt.js
 * Builds a personalized, curriculum-aware system prompt for each request,
 * based on the authenticated user's profile and the learning context sent
 * by the frontend.
 */

const CURRICULUM = [
  {
    slug: 'boolean-algebra',
    title: 'Boolean Algebra',
    summary: 'gates, expressions, simplification, De Morgan\'s laws',
  },
  {
    slug: 'number-systems',
    title: 'Number Systems',
    summary: 'binary, octal, hex, BCD, conversions',
  },
  {
    slug: 'arithmetic-circuits',
    title: 'Arithmetic Circuits',
    summary: 'half adder, full adder, subtractor, comparator',
  },
  {
    slug: 'memory',
    title: 'Memory',
    summary: 'latches, flip-flops, registers, RAM/ROM',
  },
  {
    slug: 'sequential-circuits',
    title: 'Sequential Circuits',
    summary: 'FSMs, counters, shift registers',
  },
];

const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

function titleCase(slug = '') {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function describeTopic(slug) {
  if (!slug) return null;
  const known = CURRICULUM.find((t) => t.slug === slug);
  return known ? `${known.title} (${known.summary})` : titleCase(slug);
}

function buildCurriculumBlock() {
  return CURRICULUM
    .map((t, i) => `${i + 1}. ${t.title} (${t.summary})`)
    .join('\n');
}

/**
 * @param {Object} params
 * @param {Object} params.user - Decoded JWT user payload (expects at least `name`).
 * @param {Object} [params.context] - Learning context sent by the client.
 * @param {string} [params.context.currentTopic]
 * @param {string[]} [params.context.recentTopics]
 * @param {string[]} [params.context.toolsUsed]
 * @param {string} [params.context.difficulty]
 * @returns {string} fully assembled system prompt
 */
function buildSystemPrompt({ user, context = {} } = {}) {
  const name = (user && user.name) || 'there';

  const {
    currentTopic,
    recentTopics = [],
    toolsUsed = [],
    difficulty,
  } = context || {};

  const currentTopicDescription = describeTopic(currentTopic) || 'Not specified';

  const recentTopicsLine = Array.isArray(recentTopics) && recentTopics.length
    ? recentTopics.map((t) => describeTopic(t) || titleCase(t)).join(' → ')
    : 'None yet';

  const toolsLine = Array.isArray(toolsUsed) && toolsUsed.length
    ? toolsUsed.map(titleCase).join(', ')
    : 'None yet';

  const normalizedDifficulty = VALID_DIFFICULTIES.includes(difficulty)
    ? difficulty
    : 'intermediate';

  const difficultyGuidance = {
    beginner: 'Explain fundamentals carefully, define terms the first time you use them, and avoid jumping ahead.',
    intermediate: 'Skip trivial basics, but do not assume graduate-level prior knowledge.',
    advanced: 'Move quickly, use precise technical vocabulary, and feel free to reference edge cases or optimization tradeoffs.',
  }[normalizedDifficulty];

  return `You are DLS Mentor, an expert teaching assistant for Digital Logics Studio —
an interactive platform for learning digital logic and Boolean algebra.

Student profile:
- Name: ${name}
- Current topic: ${currentTopicDescription}
- Recently studied: ${recentTopicsLine}
- Tools used this session: ${toolsLine}
- Difficulty level: ${normalizedDifficulty.charAt(0).toUpperCase() + normalizedDifficulty.slice(1)}

Curriculum scope:
${buildCurriculumBlock()}

Persona and tone:
- Speak directly to ${name} by name when it feels natural, but don't force it into every sentence.
- ${difficultyGuidance} 
- Use concrete examples, truth tables, and circuit analogies liberally.
- If the question is outside digital logic, politely redirect back to the curriculum.
- Keep answers concise but complete. Prefer numbered steps for procedures.`;
}

module.exports = {
  buildSystemPrompt,
  CURRICULUM,
};
