import { describe, expect, it } from 'vitest';

import {
  SANDBOX_MAX_CASES_PER_RUN,
  sandboxCaseInputSchema,
  sandboxCaseUpdateSchema,
  sandboxResultReviewSchema,
  sandboxRunInputSchema,
} from '@support-agent/shared';

const KB_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '22222222-2222-4222-8222-222222222222';

describe('sandboxCaseInputSchema', () => {
  it('applies safe defaults for optional fields', () => {
    const parsed = sandboxCaseInputSchema.parse({
      question: 'How do I reset my password?',
      kbIds: [KB_ID],
    });

    expect(parsed.expectedBehavior).toBe('answer');
    expect(parsed.history).toBeUndefined();
    expect(parsed.isEnabled).toBeUndefined();
  });

  it('rejects an empty KB selection', () => {
    const result = sandboxCaseInputSchema.safeParse({
      question: 'How do I reset my password?',
      kbIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields', () => {
    const result = sandboxCaseInputSchema.safeParse({
      question: 'How do I reset my password?',
      kbIds: [KB_ID],
      surprise: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('sandboxCaseUpdateSchema', () => {
  it('requires at least one field', () => {
    const result = sandboxCaseUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts a single field', () => {
    const result = sandboxCaseUpdateSchema.safeParse({ isEnabled: false });
    expect(result.success).toBe(true);
  });
});

describe('sandboxRunInputSchema', () => {
  it('accepts an explicit case selection', () => {
    const parsed = sandboxRunInputSchema.parse({ kbIds: [KB_ID], caseIds: [CASE_ID] });
    expect(parsed.caseIds).toEqual([CASE_ID]);
  });

  it('caps the case selection', () => {
    const result = sandboxRunInputSchema.safeParse({
      kbIds: [KB_ID],
      caseIds: Array.from({ length: SANDBOX_MAX_CASES_PER_RUN + 1 }, () => CASE_ID),
    });
    expect(result.success).toBe(false);
  });
});

describe('sandboxResultReviewSchema', () => {
  it('accepts a note with the verdict', () => {
    const parsed = sandboxResultReviewSchema.parse({
      status: 'fail',
      note: 'Missed the refund window',
    });
    expect(parsed).toEqual({ status: 'fail', note: 'Missed the refund window' });
  });

  it('rejects unknown review statuses', () => {
    const result = sandboxResultReviewSchema.safeParse({ status: 'maybe' });
    expect(result.success).toBe(false);
  });
});
