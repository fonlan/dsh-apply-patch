/**
 * Shared settings contract for @fonlan/dsh-apply-patch.
 *
 * One namespace, one field: `mode` — when the `apply_patch` tool is injected
 * into a session's toolset. Both halves (host + client) key off the same
 * strings.
 */
import z from '@deepseek-ai/schemastery'
import {
  APPLY_PATCH_SETTINGS_NS,
  DEFAULT_INJECTION_MODE,
  INJECTION_MODES,
  type InjectionMode,
} from './constants.js'

export { APPLY_PATCH_SETTINGS_NS, DEFAULT_INJECTION_MODE, INJECTION_MODES }
export type { InjectionMode }

/** Settings document schema: the single dropdown field. */
export const ApplyPatchSettingsSchema = z.object({
  mode: z.union([...INJECTION_MODES]).default(DEFAULT_INJECTION_MODE),
})

/** Resolved settings document shape. */
export interface ApplyPatchSettings {
  mode: InjectionMode
}

/** Base layer the host registers beneath the user document (composition default). */
export const APPLY_PATCH_SETTINGS_BASE: ApplyPatchSettings = {
  mode: DEFAULT_INJECTION_MODE,
}
