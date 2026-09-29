/**
 * The plugin's `Config` schema — the host-only half of the settings contract.
 *
 * dsh >= 0.1.7 owns plugin settings as entry config: the loader validates the
 * profile patch (or the settings page) with this schema and hands the resolved
 * document to `apply()`. Resolution is not a plain-value pass-through: a
 * `volatile()` field arrives as a live handle (`{ get() }`, cosmokit's
 * `Volatile<T>`), so `apply()` takes `ResolvedApplyPatchSettings` while
 * `ApplyPatchSettings` stays the plain shape of a hand-written document — see
 * readMode in ../index.ts, which unwraps either.
 *
 * The schema carries an explicit annotation because this repo's node_modules
 * holds several schemastery copies: the bare inferred type resolves through a
 * copy this package does not import, so `tsc -p tsconfig.build.json`
 * (`declaration: true`) cannot name it (TS2742). Naming the type through the
 * package's own default export (`z<...>`), with locally declared type
 * arguments, keeps the emitted declaration portable.
 *
 * Kept out of src/shared/ on purpose: the client tsconfig compiles src/shared/**
 * too, and a schemastery schema there fails its type resolution.
 */
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_INJECTION_MODE,
  INJECTION_MODES,
  type InjectionMode,
} from '../shared/config.js'

/**
 * One `volatile()` config field as the loader hands it to `apply()`: a live
 * handle, not the value it currently holds. Spelled structurally rather than as
 * cosmokit's `Volatile<T>` on purpose — cosmokit is a transitive dependency
 * here, and importing it would put a second schemastery/cosmokit pair into the
 * emitted declaration.
 */
export interface LiveSettingsField<T> {
  get(): T
}

/** The resolved document `apply()` receives: `mode` is a live handle. */
export type ResolvedApplyPatchSettings = {
  mode: LiveSettingsField<InjectionMode>
}

/**
 * The schema's own type: `mode` is accepted as a plain value (nullable before
 * its default applies) and resolved to the live handle above. Exported under a
 * stable name so the declaration build can write it (see the module note).
 *
 * Only the first two type arguments are spelled: `Schema`'s third `Mode`
 * parameter only exists from schemastery 3.18.3 on, while the package's peer
 * range starts at ^3.18.2. Omitting it defaults to `'plain'` — which is exactly
 * what this object schema is — on every supported version.
 */
export type ApplyPatchSettingsSchemaType = z<
  { mode?: InjectionMode | null },
  ResolvedApplyPatchSettings
>

/** Settings document schema: the single dropdown field. */
export const ApplyPatchSettingsSchema: ApplyPatchSettingsSchemaType = z.object({
  // Volatile: the settings plane (page / settings.replace) only writes
  // volatile-marked fields. The modes are listed as individual `z.const`s (not
  // a spread of INJECTION_MODES) so the schema keeps the literal union as its
  // output type — a spread widens it. INJECTION_MODES stays the single source
  // of truth for the values; keep both lists in step.
  mode: z
    .union([z.const(INJECTION_MODES[0]), z.const(INJECTION_MODES[1]), z.const(INJECTION_MODES[2])])
    .default(DEFAULT_INJECTION_MODE)
    .volatile(),
})
