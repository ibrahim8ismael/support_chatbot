import { estimateTokens } from '../../common/text/tokens';
import type { RawBlock } from './parsers/types';

/**
 * Chunking (pipeline doc step 4): target ≈ 700 tokens with ≈ 100 tokens of
 * overlap, chunks never cross a section unknowingly — a chunk that starts
 * mid-section gets its heading prepended as context. A trailing chunk smaller
 * than 200 tokens merges into its predecessor.
 */
export const CHUNK_TARGET_TOKENS = 700;
export const CHUNK_OVERLAP_TOKENS = 100;
export const CHUNK_MIN_TOKENS = 200;

export interface ChunkDraft {
  content: string;
  tokenCount: number;
  metadata: { heading?: string; page?: number };
}

interface Unit {
  text: string;
  heading?: string | undefined;
  page?: number | undefined;
  /** First unit after a heading change — no heading prepend needed. */
  startsSection: boolean;
  /** Carried over from the previous chunk for continuity. */
  overlap?: boolean;
}

export function chunkBlocks(blocks: RawBlock[]): ChunkDraft[] {
  const units = toUnits(blocks);
  if (units.length === 0) {
    return [];
  }

  const drafts: Array<{ units: Unit[]; text: string }> = [];
  let current: Unit[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length > 0) {
      drafts.push({ units: current, text: composeChunk(current) });
      current = [];
      currentTokens = 0;
    }
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit.text);
    const last = current[current.length - 1];
    const pageChanged =
      last?.page !== undefined && unit.page !== undefined && last.page !== unit.page;

    if (current.length > 0 && (pageChanged || currentTokens + unitTokens > CHUNK_TARGET_TOKENS)) {
      const previous = current;
      flush();
      current = overlapTail(previous);
      currentTokens = current.reduce((sum, carried) => sum + estimateTokens(carried.text), 0);
    }
    current.push(unit);
    currentTokens += unitTokens;
  }
  flush();

  mergeSmallTail(drafts);

  return drafts.map(({ units: draftUnits, text }) => ({
    content: text,
    tokenCount: estimateTokens(text),
    metadata: metadataOf(draftUnits),
  }));
}

/**
 * Flatten blocks into units. Oversized blocks split on sentence boundaries;
 * a single sentence over the budget is hard-wrapped on words (rare: PDFs).
 */
function toUnits(blocks: RawBlock[]): Unit[] {
  const units: Unit[] = [];
  let currentHeading: string | undefined;

  for (const block of blocks) {
    const startsSection = block.heading !== currentHeading;
    currentHeading = block.heading;
    let first = true;

    for (const piece of splitBlockText(block.text)) {
      units.push({
        text: piece,
        heading: block.heading,
        page: block.page,
        startsSection: startsSection && first,
      });
      first = false;
    }
  }

  return units;
}

function splitBlockText(text: string): string[] {
  if (estimateTokens(text) <= CHUNK_TARGET_TOKENS) {
    return [text];
  }

  const pieces: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
    if (estimateTokens(sentence) <= CHUNK_TARGET_TOKENS) {
      pieces.push(sentence);
      continue;
    }

    let line = '';
    for (const word of sentence.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && estimateTokens(candidate) > CHUNK_TARGET_TOKENS) {
        pieces.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      pieces.push(line);
    }
  }
  return pieces;
}

/** Tail of the previous chunk (up to the overlap budget) for continuity. */
function overlapTail(units: Unit[]): Unit[] {
  const tail: Unit[] = [];
  let tokens = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) {
      continue;
    }
    const next = tokens + estimateTokens(unit.text);
    if (next > CHUNK_OVERLAP_TOKENS) {
      break;
    }
    tail.unshift({ ...unit, overlap: true });
    tokens = next;
  }

  return tail;
}

function composeChunk(units: Unit[]): string {
  const body = units.map((unit) => unit.text).join('\n\n');
  const first = units.find((unit) => !unit.overlap) ?? units[0];
  if (first && !first.startsSection && first.heading && !body.startsWith(first.heading)) {
    return `${first.heading}\n\n${body}`;
  }
  return body;
}

function metadataOf(units: Unit[]): ChunkDraft['metadata'] {
  const first = units.find((unit) => !unit.overlap) ?? units[0];
  const metadata: ChunkDraft['metadata'] = {};
  if (first?.heading) {
    metadata.heading = first.heading;
  }
  if (first?.page !== undefined) {
    metadata.page = first.page;
  }
  return metadata;
}

/**
 * Merge a small trailing chunk into its predecessor — repeatedly, so a series
 * of small page chunks collapses into a normal-sized chunk. Overlap units are
 * dropped: their text is already present in the predecessor.
 */
function mergeSmallTail(drafts: Array<{ units: Unit[]; text: string }>): void {
  while (drafts.length > 1) {
    const last = drafts[drafts.length - 1];
    const previous = drafts[drafts.length - 2];
    if (!last || !previous || estimateTokens(last.text) >= CHUNK_MIN_TOKENS) {
      return;
    }
    previous.units.push(...last.units.filter((unit) => !unit.overlap));
    previous.text = composeChunk(previous.units);
    drafts.pop();
  }
}
