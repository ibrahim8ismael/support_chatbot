'use client';

import {
  Alert,
  Button,
  Card,
  Description,
  Input,
  Label,
  Spinner,
  Switch,
  TextArea,
  TextField,
} from '@heroui/react';
import { Stethoscope } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

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
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Runtime tuning: kill switch, retrieval thresholds, prompts and models. Secrets (API keys,
          Chatwoot tokens) are environment-only and never appear here.
        </p>
      </div>

      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {notice ? (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{notice}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : settings && form ? (
        <>
          <Card className="max-w-3xl">
            <Card.Header>
              <Card.Title className="text-base">Runtime settings</Card.Title>
              <Card.Description>
                Changes apply to new bot answers after saving; values are validated by the API.
              </Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-5">
              {SETTINGS_FIELDS.map((field) => {
                if (field.kind === 'boolean') {
                  return (
                    <Switch
                      key={field.key}
                      isSelected={form[field.key] === 'true'}
                      onChange={(enabled) => updateField(field.key, enabled ? 'true' : 'false')}
                    >
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Switch.Content>
                        <Label>{field.label}</Label>
                        {field.hint ? <Description>{field.hint}</Description> : null}
                      </Switch.Content>
                    </Switch>
                  );
                }

                return (
                  <TextField
                    key={field.key}
                    value={form[field.key]}
                    onChange={(value) => updateField(field.key, value)}
                  >
                    <Label>{field.label}</Label>
                    {field.kind === 'textarea' ? (
                      <TextArea rows={field.key === 'system_prompt' ? 8 : 3} />
                    ) : (
                      <Input
                        type={field.kind === 'number' ? 'number' : 'text'}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                      />
                    )}
                    {field.hint ? <Description>{field.hint}</Description> : null}
                  </TextField>
                );
              })}
            </Card.Content>
            <Card.Footer className="flex flex-wrap items-center gap-3">
              <Button isPending={saving} onPress={() => void save()}>
                Save changes
              </Button>
              <Button
                variant="secondary"
                isPending={healthBusy}
                onPress={() => void runHealthCheck()}
              >
                <Stethoscope className="size-4" aria-hidden />
                Run LLM health check
              </Button>
            </Card.Footer>
          </Card>

          {health ? (
            <Alert status="success" className="max-w-3xl">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  LLM ok: {health.embedding.model} ({health.embedding.dimensions}d,{' '}
                  {health.embedding.latencyMs} ms) + {health.chat.model} ({health.chat.latencyMs}{' '}
                  ms) — {health.totalLatencyMs} ms total
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          {healthError ? (
            <Alert status="danger" className="max-w-3xl">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{healthError}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
