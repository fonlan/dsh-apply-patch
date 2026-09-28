/**
 * @fonlan/dsh-apply-patch client half: the plugin's own settings page
 * (设置 -> 侧栏「Apply Patch」) with the single injection-scope dropdown.
 * The page lives in ./settings-section.
 */
import type { Context } from '@deepseek-ai/cordis'
type ClientContext = Context
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { APPLY_PATCH_SETTINGS_NS } from '../shared/constants'
import { LOCALE_NS, zh, en } from './locales'
import { makeSettingsSection, type ConfigFormScopeFace } from './settings-section'

/** The settings sidebar entry this page owns (must stay stable). */
const SECTION_ID = 'apply-patch'

/** Slots face (local, erased at build). */
interface Slots {
  inject(name: string, callback: () => unknown): unknown
  register(
    def: {
      name: string
      id: string
      order: number
      label: () => string
      locale?: string
      inject?: () => unknown
    },
    component: unknown,
  ): unknown
}

/**
 * The client `configForms` service (subset).
 *
 * dsh 0.1.7 dropped the old `settingsScope` service and binds plugin settings
 * forms by entry id instead. Declared structurally because this package's
 * devDependency typings predate it — the same shape the sibling plugins
 * (dsh-gitmemo, dsh-quick-commands, dsh-task-kanban) bind on 0.1.7.
 */
interface ConfigForms {
  /** Bound form for one entry id (the entry's Config schema drives the writes). */
  get(entryId: string): ConfigFormScopeFace
  /** Run `register` while the host serves any of `entryIds`; returns the withdrawal. */
  whileServed(entryIds: string[], register: () => unknown): () => void
}

/** Services required before mounting (provided by the client runtime). */
export const inject = ['slots', 'locale', 'configForms']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const off = ctx.locale.register(LOCALE_NS, { zh, en })
    return () => off()
  }, 'dsh-apply-patch: dictionaries')

  const services = ctx as unknown as { slots: Slots; configForms?: ConfigForms }
  const forms = services.configForms
  // A host without the config-form service (pre-0.1.7) keeps the plugin active
  // but cannot render this page — never touch an absent service directly.
  if (forms === undefined) return

  const t = ctx.locale.bind(LOCALE_NS) as unknown as (key: string) => string
  const SettingsSection = makeSettingsSection(ctx)
  const scope = forms.get(APPLY_PATCH_SETTINGS_NS)

  // Register into the settings.section list slot while the host serves this
  // entry: it gives the plugin its own page in the settings sidebar, rendered
  // into the panel's content column. The bound config form reaches the page
  // through the inject face.
  ctx.effect(
    () =>
      forms.whileServed([APPLY_PATCH_SETTINGS_NS], () =>
        services.slots.inject('settings.section', () =>
          services.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: 310,
              label: () => t('settingsTitle'),
              locale: LOCALE_NS,
              inject: () => ({ scope }),
            },
            SettingsSection,
          ),
        ),
      ),
    'dsh-apply-patch: settings page',
  )
}
