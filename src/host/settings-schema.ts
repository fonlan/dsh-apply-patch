/**
 * The plugin's `Config` schema — the host-only half of the settings contract.
 *
 * dsh >= 0.1.7 owns plugin settings as entry config: the loader validates the
 * profile patch (or the settings page) with this schema and hands the resolved
 * document to `apply()`. The declared document type is the PLAIN shape
 * (`ApplyPatchSettings`), while `volatile()` makes the *resolved* field a live
 * handle — see readMode in ../index.ts, which unwraps it.
 *
 * Kept out of src/shared/ on purpose: the client tsconfig compiles src/shared/**
 * too, and a schemastery schema there fails its type resolution.
 */
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_INJECTION_MODE,
  INJECTION_MODES,
  type ApplyPatchSettings,
} from '../shared/config.js'

/** Settings document schema: the single dropdown field. */
export const ApplyPatchSettingsSchema: z<ApplyPatchSettings> = z.object({
  // Volatile: the settings plane (page / settings.replace) only writes
  // volatile-marked fields. The modes are listed as individual `z.const`s (not
  // a spread of INJECTION_MODES) so the schema keeps the literal union as its
  // output type — a spread widens it and the `z<ApplyPatchSettings>` annotation
  // (which the declaration build requires for a portable type name) is then
  // rejected. INJECTION_MODES stays the single source of truth for the values;
  // keep both lists in step.
  mode: z
    .union([z.const(INJECTION_MODES[0]), z.const(INJECTION_MODES[1]), z.const(INJECTION_MODES[2])])
    .default(DEFAULT_INJECTION_MODE)
    .volatile(),
})
