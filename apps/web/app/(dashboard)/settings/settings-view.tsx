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
import { ShieldCheck, Stethoscope } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { Settings } from '@support-agent/shared';

import { canWrite, useSessionUser } from '@/components/session';
import { PageHeader } from '@/components/ui/page-header';
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
 * check is admin-only (security.md § 2) — controls are gated up front and
 * `403`s are still surfaced as inline notes. Model ids are read-only here:
 * the active models come from the server environment (frontend audit P2).
 */
export function SettingsView() {
  const router = useRouter();
  const user = useSessionUser();
  const writable = canWrite(user?.role);
  const canHealth = user?.role === 'admin';
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

  /**
   * The global kill switch is an emergency control: persist the flip right
   * away (like the per-inbox switch) instead of waiting for "Save changes",
   * and snap back to the server state when the write fails (audit HIGH).
   */
  async function toggleBotEnabled(enabled: boolean): Promise<void> {
    updateField('bot_enabled', enabled ? 'true' : 'false');
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const updated = await apiFetch<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify({ bot_enabled: enabled }),
      });
      setSettings(updated);
      setForm((current) =>
        current ? { ...current, bot_enabled: String(updated.bot_enabled) } : current,
      );
      setNotice(
        updated.bot_enabled
          ? 'Bot enabled — new answers resume with the saved settings.'
          : 'Bot disabled globally — new answers stop immediately.',
      );
    } catch (cause) {
      setForm((current) =>
        current ? { ...current, bot_enabled: String(settings?.bot_enabled ?? enabled) } : current,
      );
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

  // Buttons mirror the patch builder: nothing to save → disabled, invalid
  // values stay enabled so pressing surfaces the exact error (audit P3).
  const patchState = settings && form ? buildSettingsPatch(settings, form) : null;
  const noChanges =
    patchState !== null && !patchState.ok && patchState.error === 'no changes to save';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Runtime tuning: kill switch, retrieval thresholds and prompts. Model ids come from the server environment. Secrets (API keys, Chatwoot tokens) are environment-only and never appear here."
      />

      <div className="flex max-w-3xl items-start gap-3 rounded-xl bg-signature-cream p-5 text-ink">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#41454d]" aria-hidden />
        <div>
          <p className="text-sm font-medium">Secrets stay in the environment</p>
          <p className="mt-1 text-xs leading-5 text-[#41454d]">
            API keys and Chatwoot tokens are never rendered in this form. Changes here apply to new
            bot answers after saving.
          </p>
        </div>
      </div>

      {user && !writable ? (
        <Alert status="warning" className="max-w-3xl">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Read-only for your role</Alert.Title>
            <Alert.Description>
              Settings changes are editor/admin — ask an admin for a role if you need to change
              them.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {error ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {notice ? (
        <Alert status="success" role="status">
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
                  const isKillSwitch = field.key === 'bot_enabled';
                  return (
                    <Switch
                      key={field.key}
                      isSelected={form[field.key] === 'true'}
                      isDisabled={saving || !writable}
                      onChange={(enabled) => {
                        if (isKillSwitch) {
                          void toggleBotEnabled(enabled);
                        } else {
                          updateField(field.key, enabled ? 'true' : 'false');
                        }
                      }}
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
                    isReadOnly={field.readOnly === true}
                    isDisabled={field.readOnly !== true && (saving || !writable)}
                    onChange={(value) => {
                      if (field.readOnly !== true) {
                        updateField(field.key, value);
                      }
                    }}
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
              <Button
                isPending={saving}
                isDisabled={saving || !writable || noChanges}
                onPress={() => void save()}
              >
                Save changes
              </Button>
              <Button
                variant="secondary"
                isPending={healthBusy}
                isDisabled={user !== null && !canHealth}
                onPress={() => void runHealthCheck()}
              >
                <Stethoscope className="size-4" aria-hidden />
                Run LLM health check
              </Button>
              {user !== null && !canHealth ? (
                <span className="text-xs text-muted">The LLM health check is admin-only.</span>
              ) : null}
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
            <Alert status="danger" role="alert" className="max-w-3xl">
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
