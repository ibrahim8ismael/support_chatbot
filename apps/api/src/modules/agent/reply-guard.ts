/**
 * Post-generation output checks (security.md): length cap, blocklist regex for
 * internals, no document filenames, no URLs that are not in the knowledge.
 * A violation escalates instead of improvising — the caller posts the fallback.
 */

export interface GuardInput {
  reply: string;
  /** `settings.max_reply_chars` — hard cap on what customers see. */
  maxChars: number;
  /** Filenames of the documents used in the prompt (never customer-visible). */
  filenames: string[];
  /** Contents of the chunks placed in the prompt (the allowed-URL set). */
  chunkContents: string[];
}

export type GuardResult =
  { ok: true; reply: string } | { ok: false; reason: string; reply: string };

const INTERNALS_PATTERN = /system prompt|knowledge base|prompt template|<kb\b|\[knowledge\]/i;
const URL_PATTERN = /https?:\/\/[^\s<>()"']+/g;

export function guardReply(input: GuardInput): GuardResult {
  const reply = input.reply.trim();
  if (!reply) {
    return { ok: false, reason: 'model returned an empty reply', reply };
  }

  const internals = INTERNALS_PATTERN.exec(reply);
  if (internals) {
    return { ok: false, reason: `reply mentions internals ("${internals[0]}")`, reply };
  }

  for (const filename of input.filenames) {
    if (new RegExp(escapeRegExp(filename), 'i').test(reply)) {
      return { ok: false, reason: `reply cites document "${filename}"`, reply };
    }
  }

  for (const url of reply.match(URL_PATTERN) ?? []) {
    if (!input.chunkContents.some((content) => content.includes(url))) {
      return {
        ok: false,
        reason: `reply contains a URL that is not in the knowledge (${url})`,
        reply,
      };
    }
  }

  return { ok: true, reply: capLength(reply, input.maxChars) };
}

/** Cut to the cap at a word boundary (≥ 60 % of the budget), ellipsis included. */
function capLength(reply: string, maxChars: number): string {
  if (reply.length <= maxChars) {
    return reply;
  }
  const budget = maxChars - 1;
  const sliced = reply.slice(0, budget);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace >= budget * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut.trimEnd()}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
