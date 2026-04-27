// ── AI summary generation (Phase 5) ─────────────────────────────────────────
// Calls Anthropic Claude Haiku 4.5 directly via fetch — deliberately no SDK so
// the bundle/lockfile stays unchanged. Generates a 2-3 sentence summary of a
// Zendesk ticket from its subject + recent comment thread.
//
// Caching note: Haiku 4.5's minimum cacheable prefix is 4096 tokens. The
// system prompt below is well under that, so `cache_control` is omitted —
// adding it would be silently a no-op (cache_creation_input_tokens stays 0,
// no cost benefit, and the marker is a maintenance-debt signal). If a future
// edit pads the system prompt past 4K tokens (with style rules, few-shot
// examples, etc.), uncomment the cache_control line to start benefiting.
// ────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 256;

const SYSTEM_PROMPT = `You summarize Zendesk tickets for HR operations agents at Deel.

Write 2-3 plain-text sentences covering:
1. What the requester wants or what's wrong.
2. The current status / who or what we're blocked on.
3. The next concrete action the agent should take.

Be specific. Reference dates, amounts, country codes, and ticket-state words exactly as they appear. Skip filler ("This ticket is about…", "The agent should…"). Don't repeat the subject verbatim. No bullet points, no markdown, no preamble.`;

export function isAISummaryConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Compose a compact user message: subject + status + ticket vitals + the last
// 5 comments (truncated). Keep it short — the LLM only needs enough signal,
// not the full thread, and shorter input = faster + cheaper.
function buildUserContent({ ticket, comments }) {
  const lines = [];
  lines.push(`Subject: ${ticket.subject || '(no subject)'}`);
  if (ticket.zdStatus) lines.push(`Status: ${ticket.zdStatus}`);
  if (ticket.priority) lines.push(`Priority: ${ticket.priority}`);
  if (ticket.country) lines.push(`Country (detected): ${ticket.country}`);
  if (ticket.type) lines.push(`Type: ${ticket.type}`);
  if (ticket.assigneeName || ticket.assigneeEmail) {
    lines.push(`Assignee: ${ticket.assigneeName || ticket.assigneeEmail}`);
  }
  if (ticket.requesterName || ticket.requesterEmail) {
    lines.push(`Requester: ${ticket.requesterName || ticket.requesterEmail}`);
  }
  if (ticket.createdAt) lines.push(`Created: ${ticket.createdAt}`);
  lines.push('');
  lines.push('Recent messages (oldest → newest):');

  const recent = (comments || []).slice(-5).reverse();
  for (const c of recent) {
    const author = c.authorName || `User #${c.authorId || '?'}`;
    const role = c.authorRole === 'agent' || c.authorRole === 'admin' ? 'Agent' : 'Requester';
    const visibility = c.public === false ? 'INTERNAL' : 'PUBLIC';
    const body = (c.body || '').replace(/\s+/g, ' ').slice(0, 600);
    lines.push(`---`);
    lines.push(`[${visibility}] ${author} (${role}): ${body}`);
  }
  lines.push('');
  lines.push('Summary:');
  return lines.join('\n');
}

// Generate a summary for one ticket. Returns { summary, source, generatedAt,
// usage }. Throws on configuration errors so the route can return 503 instead
// of caching a "(error)" string. Network/API errors bubble up with the
// status code attached so the route can pass it through.
export async function generateTicketSummary({ ticket, comments }) {
  if (!isAISummaryConfigured()) {
    const err = new Error('ANTHROPIC_API_KEY is not configured');
    err.status = 503;
    throw err;
  }

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Plain string `system` is fine here — block-array form would only matter
    // if we wanted cache_control, which we deliberately omit (see header).
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent({ ticket, comments }) }],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    // Ticket summaries shouldn't take more than a few seconds — bound the
    // wait so a hung Anthropic API doesn't pin a queue request open.
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Anthropic API ${res.status}: ${text.substring(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = (data?.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  if (!text) {
    const err = new Error('Anthropic returned an empty summary');
    err.status = 502;
    throw err;
  }

  return {
    summary: text,
    source: 'claude-haiku-4-5',
    generatedAt: new Date().toISOString(),
    usage: {
      inputTokens: data?.usage?.input_tokens ?? null,
      outputTokens: data?.usage?.output_tokens ?? null,
    },
  };
}
