'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Settings } from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';
import {
  SETTINGS_FIELDS,
  buildSettingsPatch,
  settingsToForm,
  type SettingsForm,
} from '@/lib/settings';

interface LlmHealthCheck {
  status: 'ok';
  embedding: { model: string; dimensions: number; latencyMs: number };
  chat: { model: string; latencyMs: number };
  totalLatencyMs: number;
}

/**
 * Settings (T-304): typed runtime tunables (data-model § settings). Reads are
 * open to every signed-in role; writes are editor/admin, and the LLM smoke
 * check is admin-only (security.md § 2) — both are surfaced as inline notes
 * when the API answers 403.
 */
export function SettingsView() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<LlmHealthCheck | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  const handleError = useCallback(
    (cause: unknown): void => {
      if (cause instanceof ApiError && cause.status === 401) {
        router.push('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void apiFetch<Settings>('/settings')
      .then((result) => {
        if (!cancelled) {
          setSettings(result);
          setForm(settingsToForm(result));
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          handleError(cause);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [handleError]);

  async function save(): Promise<void> {
    if (!settings || !form) {
      return;
    }
    setError(null);
    setNotice(null);

    const built = buildSettingsPatch(settings, form);
    if (!built.ok) {
      setError(built.error);
      return;
    }

    setSaving(true);
    try {
      const updated = await apiFetch<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify(built.patch),
      });
      setSettings(updated);
      setForm(settingsToForm(updated));
      setNotice(`Saved ${Object.keys(built.patch).length} change(s).`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setError('Settings writes are editor/admin only.');
      } else {
        handleError(cause);
      }
    } finally {
      setSaving(false);
    }
  }

  async function runHealthCheck(): Promise<void> {
    setHealth(null);
    setHealthError(null);
    setHealthBusy(true);
    try {
      setHealth(await apiFetch<LlmHealthCheck>('/settings/health-llm'));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setHealthError('The LLM health check is admin-only.');
      } else if (cause instanceof ApiError) {
        setHealthError(cause.message);
      } else {
        handleError(cause);
      }
    } finally {
      setHealthBusy(false);
    }
  }

  function updateField(key: keyof Settings, value: string): void {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setNotice(null);
  }

  return (
    <>
      <h1>Settings</h1>
      <p style={{ color: 'var(--legacy-muted)' }}>
        Runtime tuning: kill switch, retrieval thresholds, prompts and models. Secrets (API keys,
        Chatwoot tokens) are environment-only and never appear here.
      </p>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      {notice ? <p style={{ color: 'var(--legacy-muted)' }}>{notice}</p> : null}
      {loading ? <p style={{ color: 'var(--legacy-muted)' }}>Loading…</p> : null}

      {settings && form ? (
        <>
          <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
            {SETTINGS_FIELDS.map((field) => (
              <label key={field.key} style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13 }}>
                  {field.label}
                  {field.hint ? (
                    <span style={{ color: 'var(--legacy-muted)' }}> — {field.hint}</span>
                  ) : null}
                </span>
                {field.kind === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={form[field.key] === 'true'}
                    onChange={(event) =>
                      updateField(field.key, event.target.checked ? 'true' : 'false')
                    }
                    style={{ justifySelf: 'start' }}
                  />
                ) : field.kind === 'textarea' ? (
                  <textarea
                    rows={field.key === 'system_prompt' ? 8 : 3}
                    value={form[field.key]}
                    onChange={(event) => updateField(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    type={field.kind === 'number' ? 'number' : 'text'}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={form[field.key]}
                    onChange={(event) => updateField(field.key, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
            <button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" disabled={healthBusy} onClick={() => void runHealthCheck()}>
              {healthBusy ? 'Checking…' : 'Run LLM health check'}
            </button>
          </div>

          {health ? (
            <p style={{ color: 'var(--legacy-muted)' }}>
              LLM ok: {health.embedding.model} ({health.embedding.dimensions}d,{' '}
              {health.embedding.latencyMs} ms) + {health.chat.model} ({health.chat.latencyMs} ms) —{' '}
              {health.totalLatencyMs} ms total
            </p>
          ) : null}
          {healthError ? <p style={{ color: 'crimson' }}>{healthError}</p> : null}
        </>
      ) : null}
    </>
  );
}
