/**
 * Shared settings contract for @fonlan/dsh-apply-patch.
 *
 * One namespace, one field: `mode` — when the `apply_patch` tool is injected
 * into a session's toolset. Both halves (host + client) key off the same
 * strings, so this file stays free of any schemastery import (the client bundle
 * purity gate and the client tsconfig both rely on that): the Config schema the
 * host validates with lives in `src/host/settings-schema.ts`.
 */
import {
  APPLY_PATCH_SETTINGS_NS,
  DEFAULT_INJECTION_MODE,
  INJECTION_MODES,
  type InjectionMode,
} from './constants.js'

export { APPLY_PATCH_SETTINGS_NS, DEFAULT_INJECTION_MODE, INJECTION_MODES }
export type { InjectionMode }

/** Resolved settings document shape. */
export interface ApplyPatchSettings {
  mode: InjectionMode
}

/** Base layer the host registers beneath the user document (composition default). */
export const APPLY_PATCH_SETTINGS_BASE: ApplyPatchSettings = {
  mode: DEFAULT_INJECTION_MODE,
}
