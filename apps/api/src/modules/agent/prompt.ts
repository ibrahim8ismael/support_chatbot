import type { RetrievedChunk } from '@support-agent/shared';

import type { ChatTurn } from '../llm/llm.types';

/**
 * Answer prompt rendering (rag-pipeline.md#prompt-template). The template is a
 * versioned file seeded into `settings.system_prompt`; knowledge is inserted as
 * delimited data — never as instructions (security.md).
 */

/** Prior turns included under [CONVERSATION SO FAR]. */
const RECENT_TURNS = 8;
/** Short messages ("and the price?") are usually referential. */
const REFERENTIAL_QUESTION_CHARS = 60;
/** Retrieval queries are embedded, not read — keep them bounded. */
const MAX_QUERY_CHARS = 1_000;
const CONTEXT_TURNS_FOR_QUERY = 2;

/** The `<kb>` block in the template, with its trailing repetition marker. */
const KB_BLOCK = /<kb id="\{\{chunk_id\}\}">\n?\{\{chunk_content\}\}\n?<\/kb>\n?\.\.\./;

const SCALAR_PLACEHOLDER = /\{\{(company_name|max_reply_chars|last_turns|message)\}\}/g;

export interface AnswerPromptInput {
  /** `settings.system_prompt` (seeded from `answer.v1`). */
  template: string;
  companyName: string;
  maxReplyChars: number;
  chunks: RetrievedChunk[];
  history: ChatTurn[];
  question: string;
}

/** Render the system prompt: scalar placeholders + one `<kb>` block per chunk. */
export function renderAnswerPrompt(input: AnswerPromptInput): string {
  const scalars: Record<string, string> = {
    company_name: input.companyName,
    max_reply_chars: String(input.maxReplyChars),
    last_turns: formatTurns(input.history),
    message: input.question,
  };
  // One pass: values (customer text, chunk ids) must never be re-scanned as
  // placeholders, so the replacer returns them literally.
  const rendered = input.template.replace(
    SCALAR_PLACEHOLDER,
    (_match, key: string) => scalars[key] ?? '',
  );
  return fillKnowledge(rendered, input.chunks);
}

/**
 * Replace the template's `<kb>` block with one block per chunk. A template
 * edited beyond recognition still gets the knowledge appended: grounding must
 * never silently disappear.
 */
export function fillKnowledge(template: string, chunks: RetrievedChunk[]): string {
  const blocks = chunks
    .map((chunk) => `<kb id="${chunk.chunkId}">\n${chunk.content}\n</kb>`)
    .join('\n');
  if (KB_BLOCK.test(template)) {
    return template.replace(KB_BLOCK, () => blocks);
  }
  const withoutMarkers = template
    .replace(/\{\{chunk_content\}\}/g, '')
    .replace(/\{\{chunk_id\}\}/g, '');
  if (chunks.length === 0) {
    return withoutMarkers;
  }
  return `${withoutMarkers}\n[KNOWLEDGE]\n${blocks}`;
}

/**
 * Query build for retrieval (FR-4): the message itself, plus the recent
 * customer turns while the message is short enough to be referential. The
 * model-based rewrite is P1 — this stays deterministic.
 */
export function buildRetrievalQuery(question: string, history: ChatTurn[]): string {
  const trimmed = question.trim();
  const recent = history
    .filter((turn) => turn.role === 'user')
    .slice(-CONTEXT_TURNS_FOR_QUERY)
    .map((turn) => turn.content.trim())
    .filter(Boolean);

  const parts =
    trimmed.length < REFERENTIAL_QUESTION_CHARS && recent.length > 0
      ? [...recent, trimmed]
      : [trimmed];
  const joined = parts.join('\n');
  return joined.length <= MAX_QUERY_CHARS ? joined : joined.slice(joined.length - MAX_QUERY_CHARS);
}

function formatTurns(history: ChatTurn[]): string {
  const recent = history.slice(-RECENT_TURNS);
  if (recent.length === 0) {
    return '(no earlier messages)';
  }
  return recent
    .map((turn) => `${turn.role === 'user' ? 'Customer' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}
