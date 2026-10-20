import { settingsUpdateSchema, type Settings, type SettingsPatch } from '@support-agent/shared';

/**
 * Settings-screen helpers (T-304): field metadata + form ↔ patch mapping.
 * The produced patch is validated with the same shared schema the API uses.
 */

export interface SettingsField {
  key: keyof Settings;
  label: string;
  kind: 'boolean' | 'number' | 'text' | 'textarea';
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Values the API stores but never reads: the active model ids come from the
   * server environment (`LLM_PROVIDER` + model variables). Shown read-only so
   * the dashboard cannot pretend to change them (frontend audit P2).
   */
  readOnly?: boolean;
}

/** Display order + input type per setting (keys/defaults: data-model § settings). */
export const SETTINGS_FIELDS: SettingsField[] = [
  {
    key: 'bot_enabled',
    label: 'Bot enabled (global kill switch)',
    kind: 'boolean',
    hint: 'Saves the moment it flips — no separate save needed.',
  },
  {
    key: 'system_prompt',
    label: 'System prompt',
    kind: 'textarea',
    hint: 'Grounded-answering rules; up to 20,000 characters.',
  },
  {
    key: 'fallback_message',
    label: 'Fallback message',
    kind: 'textarea',
    hint: 'Posted when the bot cannot answer (low score or guard).',
  },
  { key: 'retrieval_top_k', label: 'Retrieval top K', kind: 'number', min: 1, max: 50 },
  {
    key: 'retrieval_score_threshold',
    label: 'Retrieval score threshold',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  { key: 'context_chunks', label: 'Context chunks', kind: 'number', min: 1, max: 20 },
  { key: 'max_reply_chars', label: 'Max reply chars', kind: 'number', min: 100, max: 4_000 },
  {
    key: 'embedding_model',
    label: 'Embedding model',
    kind: 'text',
    readOnly: true,
    hint: 'Set via the server environment (EMBEDDING_MODEL) — informational only.',
  },
  {
    key: 'chat_model',
    label: 'Chat model',
    kind: 'text',
    readOnly: true,
    hint: 'Set by the server environment (CHAT_MODEL) or provider default — informational only.',
  },
];

export type SettingsForm = Record<keyof Settings, string>;

/** Current settings → form values (booleans become `'true'`/`'false'`). */
export function settingsToForm(settings: Settings): SettingsForm {
  const form = {} as SettingsForm;
  for (const field of SETTINGS_FIELDS) {
    form[field.key] = String(settings[field.key]);
  }
  return form;
}

/**
 * Changed fields only → validated patch. Numbers are coerced first (empty or
 * non-numeric input is an error), booleans compare as `'true'`; the result
 * runs through `settingsUpdateSchema` so ranges can't drift from the API.
 */
export function buildSettingsPatch(
  original: Settings,
  form: SettingsForm,
): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {};

  for (const field of SETTINGS_FIELDS) {
    if (field.readOnly) {
      // Never submit environment-managed values, even if the form drifts.
      continue;
    }
    const current: string | number | boolean = original[field.key];
    const raw = form[field.key];

    if (field.kind === 'boolean') {
      const value = raw === 'true';
      if (value !== current) {
        patch[field.key] = value;
      }
      continue;
    }

    if (field.kind === 'number') {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) {
        return { ok: false, error: `${field.label} must be a number` };
      }
      if (value !== current) {
        patch[field.key] = value;
      }
      continue;
    }

    if (raw !== current) {
      patch[field.key] = raw;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'no changes to save' };
  }

  const parsed = settingsUpdateSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid settings' };
  }
  return { ok: true, patch: parsed.data };
}
