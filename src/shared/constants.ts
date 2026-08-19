/**
 * Pure constants shared by host and client — deliberately free of any
 * schemastery import so the client bundle purity gate lets both halves share
 * them.
 */

/** Settings namespace of this plugin (lowercase kebab, matches package short name). */
export const APPLY_PATCH_SETTINGS_NS = 'dsh-apply-patch'

/** Injection-scope choices, in display order. */
export const INJECTION_MODES = ['off', 'gpt-only', 'all'] as const

/** Injection-scope choice type. */
export type InjectionMode = (typeof INJECTION_MODES)[number]

/** Default: only gpt-* models see the tool; users opt into all or off explicitly. */
export const DEFAULT_INJECTION_MODE: InjectionMode = 'gpt-only'
