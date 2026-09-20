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
import { makeSettingsSection, type SettingsScopeFace } from './settings-section'

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

/** Services required before mounting (provided by the client runtime). */
export const inject = ['slots', 'locale', 'settingsScope', 'connection', 'remote']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const off = ctx.locale.register(LOCALE_NS, { zh, en })
    return () => off()
  }, 'dsh-apply-patch: dictionaries')

  const t = ctx.locale.bind(LOCALE_NS) as unknown as (key: string) => string
  const SettingsSection = makeSettingsSection(ctx)

  const services = ctx as unknown as {
    slots: Slots
    settingsScope: { bind(spec: { namespace: string }): SettingsScopeFace }
  }
  const scope = services.settingsScope.bind({ namespace: APPLY_PATCH_SETTINGS_NS })

  // Register into the settings.section list slot: it gives the plugin its own
  // page in the settings sidebar, rendered into the panel's content column.
  // The bound settings scope reaches the page through the inject face.
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
  )
}