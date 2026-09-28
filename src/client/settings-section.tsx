/**
 * The Apply Patch settings page (设置 -> 侧栏「Apply Patch」).
 *
 * Registers into the settings.section slot, so the page owns one entry in the
 * settings sidebar and renders in the panel's content column. Content: one
 * dropdown (关闭 / 仅GPT模型 / 所有模型) reading and writing the
 * `dsh-apply-patch` entry config through the client `configForms` scope — the
 * same transport the built-in settings pages use, so a change here restarts
 * the host entry with the new mode.
 */
import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
type ClientContext = Context
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_INJECTION_MODE, INJECTION_MODES, type InjectionMode } from '../shared/constants'
import { LOCALE_NS } from './locales'
import './settings-section.css'

/** One write in the client config-form protocol (`settings/mutate` ops). */
export type ConfigFormOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** Snapshot of one bound client config form. */
export interface ConfigFormSnapshot {
  status?: string
  writable: boolean
  /** Effective document (the stored override merged over the composition default). */
  value?: { mode?: InjectionMode } | undefined
  /** Optimistic-concurrency revision this read is based on. */
  revision?: unknown
  [key: string]: unknown
}

/**
 * Bound client config form — the `configForms.get(<entry id>)` scope.
 *
 * dsh 0.1.7 replaced the old `settingsScope` service with `configForms`: the
 * scope is bound by entry id (not namespace) and writes ride
 * `mutate(ops, revision)` instead of `set(field, value)`. Declared structurally
 * because this package's devDependency typings predate it; keep in sync with
 * the `configForms` scope the official settings pages bind.
 */
export interface ConfigFormScopeFace {
  getSnapshot(): ConfigFormSnapshot
  subscribe(listener: () => void): () => void
  /** @returns false when the write was rejected as stale (revision moved on). */
  mutate(ops: ConfigFormOp[], revision?: unknown): Promise<boolean>
}

export interface SettingsSectionProps {
  /** The bound dsh-apply-patch config form (from the slot entry's inject face). */
  scope: ConfigFormScopeFace
}

/** Label lookup for the three modes. */
const MODE_KEYS: Record<InjectionMode, string> = {
  off: 'modeOff',
  'gpt-only': 'modeGptOnly',
  all: 'modeAll',
}

export function makeSettingsSection(ctx: ClientContext): (props: SettingsSectionProps) => JSX.Element | null {
  const t: Translate = (() => {
    try {
      return ctx.locale.bind(LOCALE_NS) as unknown as Translate
    } catch {
      return (key: string) => key
    }
  })()

  return function ApplyPatchSettingsSection(props: SettingsSectionProps): JSX.Element | null {
    const { scope } = props
    const snapshot = useSyncExternalStore(
      (listener) => scope.subscribe(listener),
      () => scope.getSnapshot(),
    )
    const [busy, setBusy] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const current: InjectionMode = snapshot.value?.mode ?? DEFAULT_INJECTION_MODE

    const changeMode = useCallback(async (next: InjectionMode) => {
      setBusy(true)
      setError(null)
      setSaved(false)
      try {
        // Write against the revision this render was based on: the host rejects a
        // stale write instead of silently overwriting a concurrent change.
        const revision = scope.getSnapshot().revision
        const landed = await scope.mutate([{ op: 'set', path: ['mode'], value: next }], revision)
        if (!landed) throw new Error(t('saveConflict'))
        setSaved(true)
      } catch (cause) {
        setError(t('saveFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        setBusy(false)
      }
    }, [scope, t])

    if (snapshot.status === 'unavailable') return null
    const writable = snapshot.writable

    return (
      <div className="ap-page">
        <header className="ap-page-head">
          <h3 className="ap-page-title">{t('settingsTitle')}</h3>
          <p className="ap-page-sub">{t('sectionSub')}</p>
        </header>
        <div className="ap-body">
          {!writable && (
            <p className="ap-settings-readonly" role="status">{t('readOnly')}</p>
          )}
          <div className="ap-field">
            <label className="ap-field-label" htmlFor="ap-injection-mode">
              {t('modeLabel')}
            </label>
            <select
              id="ap-injection-mode"
              className="ap-select"
              value={current}
              disabled={busy || !writable}
              onChange={(event) => void changeMode(event.target.value as InjectionMode)}
            >
              {INJECTION_MODES.map((mode) => (
                <option key={mode} value={mode}>{t(MODE_KEYS[mode])}</option>
              ))}
            </select>
            <p className="ap-field-hint">{t('modeHint')}</p>
            {busy && <p className="ap-status" role="status">{t('saving')}</p>}
            {!busy && saved && !error && <p className="ap-status ap-status-ok" role="status">{t('saved')}</p>}
            {error !== null && <p className="ap-status ap-status-error" role="alert">{error}</p>}
          </div>
        </div>
      </div>
    )
  }
}
