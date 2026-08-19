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
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  APPLY_PATCH_SETTINGS_NS,
  APPLY_PATCH_SETTINGS_BASE,
  ApplyPatchSettingsSchema,
  type ApplyPatchSettings,
  type InjectionMode,
} from './shared/config.js'
import { registerApplyPatchTool, type ToolFaces } from './host/tool.js'
import { installInjector, shouldOfferTool } from './host/injector.js'

export const name = '@fonlan/dsh-apply-patch'

export const inject = [
  'tools',
  'fs',
  'systemPrompt',
  'settings',
  'sandboxPolicy',
]

export const Config = z.object({})

/** Session cwd helper: the agent's workspace root. */
function sessionCwd(exec: { agent?: { session?: { header?: { cwd?: string } } } }): string | undefined {
  const cwd = exec.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

export function apply(ctx: Context): void {
  // 1. Settings namespace: the one dropdown (off / gpt-only / all).
  const scope = ctx.settings.register(
    settingsNamespace(APPLY_PATCH_SETTINGS_NS),
    ApplyPatchSettingsSchema,
    {
      base: APPLY_PATCH_SETTINGS_BASE,
      applies: 'live',
    },
  )

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
  let mode: InjectionMode = scope.get().mode
  const disposeWatch = scope.watch((next) => {
    mode = next.mode
  })
  const disposeInjector = installInjector(ctx, () => mode)

  ctx.effect(() => {
    return () => {
      disposeTool()
      disposeWatch()
      disposeInjector()
    }
  }, 'dsh-apply-patch: teardown')
}

export { ApplyPatchSettingsSchema, APPLY_PATCH_SETTINGS_NS, shouldOfferTool }
export type { ApplyPatchSettings, InjectionMode }
