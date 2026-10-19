import { describe, expect, it } from 'vitest';

import type { Settings } from '@support-agent/shared';

import { SETTINGS_FIELDS, buildSettingsPatch, settingsToForm } from './settings';

const SETTINGS: Settings = {
  bot_enabled: true,
  system_prompt: 'Answer only from context.',
  fallback_message: "I'll pass this to a human.",
  retrieval_top_k: 10,
  retrieval_score_threshold: 0.35,
  context_chunks: 4,
  max_reply_chars: 1_500,
  embedding_model: 'text-embedding-3-small',
  chat_model: 'gpt-4o-mini',
};

describe('settingsToForm', () => {
  it('maps every field to a form string', () => {
    const form = settingsToForm(SETTINGS);

    expect(form.bot_enabled).toBe('true');
    expect(form.retrieval_top_k).toBe('10');
    expect(form.retrieval_score_threshold).toBe('0.35');
    expect(form.system_prompt).toBe('Answer only from context.');
    expect(Object.keys(form).length).toBe(SETTINGS_FIELDS.length);
  });
});

describe('buildSettingsPatch', () => {
  it('returns only the changed keys, with numbers coerced', () => {
    const form = settingsToForm(SETTINGS);
    form.retrieval_top_k = '12';
    form.bot_enabled = 'false';

    expect(buildSettingsPatch(SETTINGS, form)).toEqual({
      ok: true,
      patch: { bot_enabled: false, retrieval_top_k: 12 },
    });
  });

  it('reports "no changes" when the form matches the settings', () => {
    const result = buildSettingsPatch(SETTINGS, settingsToForm(SETTINGS));

    expect(result).toEqual({ ok: false, error: 'no changes to save' });
  });

  it('rejects non-numeric and out-of-range numbers', () => {
    const empty = settingsToForm(SETTINGS);
    empty.context_chunks = '';
    expect(buildSettingsPatch(SETTINGS, empty)).toEqual({
      ok: false,
      error: 'Context chunks must be a number',
    });

    const outOfRange = settingsToForm(SETTINGS);
    outOfRange.context_chunks = '21';
    const result = buildSettingsPatch(SETTINGS, outOfRange);
    expect(result.ok).toBe(false);
  });

  it('never submits environment-managed (read-only) model fields', () => {
    const form = settingsToForm(SETTINGS);
    form.chat_model = 'gpt-4.1-nano';
    form.embedding_model = 'text-embedding-3-large';

    // Only read-only fields changed → nothing to save.
    expect(buildSettingsPatch(SETTINGS, form)).toEqual({
      ok: false,
      error: 'no changes to save',
    });

    form.retrieval_top_k = '12';
    expect(buildSettingsPatch(SETTINGS, form)).toEqual({
      ok: true,
      patch: { retrieval_top_k: 12 },
    });
  });

  it('rejects an emptied prompt (schema minimum)', () => {
    const form = settingsToForm(SETTINGS);
    form.system_prompt = '';

    const result = buildSettingsPatch(SETTINGS, form);
    expect(result.ok).toBe(false);
  });
});
