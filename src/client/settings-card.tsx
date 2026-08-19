/**
 * The Apply Patch Settings Card (设置 → 插件 → 插件配置 → Apply Patch).
 *
 * One dropdown: 关闭 / 仅GPT模型 / 所有模型. Reads and writes the
 * `dsh-apply-patch` settings namespace through the bound settings scope —
 * the same transport the built-in plugin cards use, so a change here is live
 * for the next request.
 */
import { useCallback, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { INJECTION_MODES, type InjectionMode } from '../shared/constants'
import { LOCALE_NS } from './locales'
import './settings-card.css'

/** Client settings scope face (subset of @deepseek-ai/dsh-client-runtime). */
export interface SettingsScopeFace {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    writable: boolean
    value?: { mode?: InjectionMode } | undefined
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export interface SettingsCardProps {
  /** The bound `dsh-apply-patch` settings scope (from the slot entry's inject face). */
  scope: SettingsScopeFace
}

/** Label lookup for the three modes. */
const MODE_KEYS: Record<InjectionMode, string> = {
  off: 'modeOff',
  'gpt-only': 'modeGptOnly',
  all: 'modeAll',
}

export function makeSettingsCard(ctx: ClientContext): (props: SettingsCardProps) => JSX.Element | null {
  const t: Translate = (() => {
    try {
      return ctx.locale.bind(LOCALE_NS) as unknown as Translate
    } catch {
      return (key: string) => key
    }
  })()

  return function ApplyPatchSettingsCard(props: SettingsCardProps): JSX.Element | null {
    const { scope } = props
    const snapshot = useSyncExternalStore(
      (listener) => scope.subscribe(listener),
      () => scope.getSnapshot(),
    )
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const current: InjectionMode = snapshot.value?.mode ?? 'gpt-only'

    const changeMode = useCallback(async (next: InjectionMode) => {
      setBusy(true)
      setError(null)
      setSaved(false)
      try {
        await scope.set('mode', next)
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
      <li className="ap-settings-card" data-open={open ? '' : undefined}>
        <button
          type="button"
          className="ap-settings-head"
          aria-expanded={open}
          aria-label={(open ? t('collapse') : t('expand')) + '：' + t('settingsTitle')}
          onClick={() => setOpen(!open)}
        >
          <span className="ap-settings-head-text">
            <span className="ap-settings-title">{t('settingsTitle')}</span>
            <span className="ap-settings-sub">{t('settingsCardDescription')}</span>
          </span>
          <span className="ap-settings-chevron" data-open={open ? '' : undefined} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        {open && (
          <div className="ap-settings-body">
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
        )}
      </li>
    )
  }
}
