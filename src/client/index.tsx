/**
 * @fonlan/dsh-apply-patch client half: the plugin's own Settings Card
 * (设置 → 插件 → 插件配置 → Apply Patch) with the single injection-scope
 * dropdown.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { APPLY_PATCH_SETTINGS_NS } from '../shared/constants'
import { LOCALE_NS, zh, en } from './locales'
import { makeSettingsCard, type SettingsScopeFace } from './settings-card'

/** Slots face (local, erased at build). */
interface Slots {
  inject(name: string, callback: () => unknown): unknown
  register(def: { name: string; key: string; inject?: () => unknown }, component: unknown): unknown
}

/** Services required before mounting (provided by the client runtime). */
export const inject = ['slots', 'locale', 'settingsScope']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const off = ctx.locale.register(LOCALE_NS, { zh, en })
    return () => off()
  }, 'dsh-apply-patch: dictionaries')

  const SettingsCard = makeSettingsCard(ctx)

  const services = ctx as unknown as {
    slots: Slots
    settingsScope: { bind(spec: { namespace: string }): SettingsScopeFace }
  }
  const scope = services.settingsScope.bind({ namespace: APPLY_PATCH_SETTINGS_NS })

  services.slots.inject('settings.plugin.item', () =>
    services.slots.register(
      {
        name: 'settings.plugin.item',
        key: APPLY_PATCH_SETTINGS_NS,
        inject: () => ({ scope }),
      },
      SettingsCard,
    ),
  )
}
