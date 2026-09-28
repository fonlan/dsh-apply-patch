/**
 * @fonlan/dsh-apply-patch host half.
 *
 * Registers the codex-style `apply_patch` tool over DSH's built-in sandbox
 * (ctx.fs for Add/Update/Move writes, ctx.shell for Delete), plus the
 * `dsh-apply-patch` settings namespace whose single `mode` field controls
 * injection scope (off / gpt-only / all). The tool is only offered to the
 * model on sessions whose resolved model passes the scope check.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import {
  APPLY_PATCH_SETTINGS_NS,
  DEFAULT_INJECTION_MODE,
  INJECTION_MODES,
  type ApplyPatchSettings,
  type InjectionMode,
} from './shared/config.js'
import { ApplyPatchSettingsSchema } from './host/settings-schema.js'
import { registerApplyPatchTool, type ToolFaces } from './host/tool.js'
import { installInjector, shouldOfferTool } from './host/injector.js'

export const name = '@fonlan/dsh-apply-patch'

export const inject = [
  'tools',
  'fs',
  'systemPrompt',
  'sandboxPolicy',
]

// The plugin's Config is the settings form: dsh >= 0.1.7 derives the settings
// page from this schema, and a config change restarts the entry, so `apply`
// always sees the current mode.
export const Config = ApplyPatchSettingsSchema

/** Session cwd helper: the agent's workspace root. */
function sessionCwd(exec: { agent?: { session?: { header?: { cwd?: string } } } }): string | undefined {
  const cwd = exec.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** Live handle schemastery wraps around one `volatile()` config field. */
interface VolatileField<T> {
  get(): T
}

/**
 * The registered symbol cosmokit marks a volatile cell with.
 *
 * `Symbol.for` makes it reachable across module copies (the `link:` install
 * loads its own cosmokit), which is how dsh-settings distinguishes a cell from
 * the plain value — same check as the sibling dsh-ssh host half.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Whether a resolved config field is a live volatile cell rather than its value. */
function isVolatileCell(value: unknown): value is VolatileField<unknown> {
  if (typeof value !== 'object' || value === null) return false
  return VOLATILE_WRITE in value || typeof (value as { get?: unknown }).get === 'function'
}

/**
 * Read the injection mode from the entry config.
 *
 * A `volatile()` field does NOT arrive as its value on dsh >= 0.1.7: it arrives
 * as a live cosmokit cell (`{ get() }`, `typeof === 'object'`,
 * `JSON.stringify` → `{}`). Reading `config.mode` directly therefore yielded the
 * cell, `shouldOfferTool` fell through to its gpt-only branch, and the "off" /
 * "all" choices made on the settings page (or in the profile patch) were
 * ignored. The cell is read on every call so a settings edit takes effect
 * without re-registering the tool.
 * @param config - the entry config this host half was applied with.
 * @returns the current mode, or the composition default for anything unusable.
 */
export function readMode(config: ApplyPatchSettings | undefined): InjectionMode {
  const field = (config as { mode?: unknown } | undefined)?.mode
  if (field === undefined || field === null) return DEFAULT_INJECTION_MODE
  const value = isVolatileCell(field) ? field.get() : field
  return INJECTION_MODES.includes(value as InjectionMode) ? (value as InjectionMode) : DEFAULT_INJECTION_MODE
}

export function apply(ctx: Context, config: ApplyPatchSettings): void {
  // 1. Injection scope comes from the entry config (settings page / patch yaml):
  // the mode is re-read from the live volatile handle on every request.
  const mode = () => readMode(config)

  // 2. Optional sandboxed shell (needed only for *** Delete File:).
  const shellService = ctx.get('shell')
  const sandboxPolicyService = ctx.get('sandboxPolicy')

  // 3. Register the tool. Injection scope is read live at execute time.
  const faces: ToolFaces = {
    fs: ctx.fs,
    shell: shellService as ToolFaces['shell'],
    resolvePolicy(exec) {
      if (sandboxPolicyService === undefined) return undefined
      return sandboxPolicyService.resolve({
        ...exec.agent !== undefined ? { session: exec.agent.session } : {},
      })
    },
    resolveCwd(exec) {
      return sessionCwd(exec)
    },
  }
  const disposeTool = registerApplyPatchTool(ctx, faces)

  // 4. Conditional injection by model + settings mode.
  const disposeInjector = installInjector(ctx, mode)

  ctx.effect(() => {
    return () => {
      disposeTool()
      disposeInjector()
    }
  }, 'dsh-apply-patch: teardown')
}

export { ApplyPatchSettingsSchema, APPLY_PATCH_SETTINGS_NS, shouldOfferTool }
export type { ApplyPatchSettings, InjectionMode }
