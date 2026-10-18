import { z } from 'zod';

import type { AgentChunk } from '@support-agent/shared';

import type { LlmService } from '../src/modules/llm/llm.service';

/**
 * Groundedness judge (rag-pipeline.md § Quality): an LLM call that checks every
 * claim in a reply traces to the retrieved chunks. It runs on the same provider
 * as the agent — with `LLM_PROVIDER=mock` the verdict is the mock's canned
 * structured output, which exercises the plumbing but is not a quality signal.
 */

export const judgeVerdictSchema = z.object({
  verdict: z.enum(['grounded', 'unsupported']),
  unsupported_claims: z.array(z.string()),
});

export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

const JUDGE_SYSTEM = [
  'You are a strict grounding judge for a customer-support bot.',
  'You receive the customer question, the knowledge chunks the bot was given, and the answer it produced.',
  'A statement is grounded only when the chunks support it; greetings and politeness are always fine.',
  'Return "grounded" only if every factual claim in the answer traces to the chunks.',
  'Otherwise return "unsupported" and list each unsupported claim.',
].join(' ');

export interface JudgeInput {
  question: string;
  answer: string;
  chunks: AgentChunk[];
}

/** The user message: chunks as data blocks, followed by the answer. */
export function buildJudgeMessage(input: JudgeInput): string {
  const knowledge = input.chunks
    .map((chunk, index) => `[${index + 1}] (${chunk.document})\n${chunk.content}`)
    .join('\n\n');

  return [
    `Question: ${input.question}`,
    '',
    'Knowledge chunks:',
    knowledge || '(none)',
    '',
    `Answer: ${input.answer}`,
  ].join('\n');
}

export async function judgeAnswer(
  llm: LlmService,
  input: JudgeInput,
): Promise<{ verdict: JudgeVerdict; model: string }> {
  const result = await llm.classify({
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: buildJudgeMessage(input) }],
    schema: judgeVerdictSchema,
  });
  return { verdict: result.object, model: result.model };
}
