/**
 * Model-conditional tool injection.
 *
 * The `apply_patch` tool is only useful to models that know its format
 * (OpenAI's GPT family, which were trained on codex's apply_patch). The
 * settings dropdown controls the injection scope:
 *
 *   - `off`      — the tool is never offered to any model.
 *   - `gpt-only` — offered only to models whose id starts with `gpt-`.
 *   - `all`      — offered to every model.
 *
 * Mechanics: the tool list is assembled per agent step via the
 * `system-prompt/assemble` waterfall. The model that will run the NEXT
 * request is resolved there too: the model-selection layer (host-apiproxy's
 * `installModelSelection`, mounted by the web and headless entry points)
 * reads the session's selection and injects `variables.provider` /
 * `variables.model` into the assembly — before my outer filter runs. So the
 * filter reads the authoritative model straight from the assembled
 * variables, with NO lag after a mid-session model switch.
 *
 * Fallbacks when the model-selection layer is absent (custom compositions):
 * the last model captured from `agent/request`, then the session's logged
 * request header, then `ctx.agentDefaultModel.currentSelection()`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InjectionMode } from '../shared/config.js'

/** The tool name this plugin gates. */
export const APPLY_PATCH_TOOL_NAME = 'apply_patch'

/** Whether a model id counts as a "GPT model" (codex-trained family). */
export function isGptModel(modelId: string): boolean {
  return modelId.startsWith('gpt-')
}

/** Decide whether the tool is offered for a model under a mode. */
export function shouldOfferTool(mode: InjectionMode, modelId: string | undefined): boolean {
  if (mode === 'off') return false
  if (modelId === undefined || modelId === '') return mode === 'all'
  if (mode === 'all') return true
  return isGptModel(modelId)
}

/** Read the current injection mode from a bound settings scope. */
export type ModeReader = () => InjectionMode

/** Per-agent resolved-route cache (fallback tier only). */
interface RouteCapture {
  provider: string
  model: string
}

/**
 * Install the two hooks. Returns the disposer.
 */
export function installInjector(
  ctx: Context,
  readMode: ModeReader,
): () => void {
  const routes = new Map<string, RouteCapture>()

  const disposeRequest = ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agentId = payload.agent?.id
    if (agentId !== undefined && resolved?.model !== undefined) {
      routes.set(agentId, {
        provider: resolved.provider ?? '',
        model: resolved.model,
      })
    }
    return resolved
  })

  const disposeAssemble = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next()
    const mode = readMode()
    if (mode === 'all') return assembled
    if (mode === 'off') {
      return dropTool(assembled)
    }
    // gpt-only: prefer the model the model-selection layer injected into the
    // assembly variables (authoritative, zero lag), then fall back.
    const model = assembled.variables?.model
      ?? modelForAgent(ctx, context.agent, routes)
    if (!shouldOfferTool('gpt-only', model)) {
      return dropTool(assembled)
    }
    return assembled
  })

  return () => {
    disposeRequest()
    disposeAssemble()
  }
}

/** Drop the apply_patch tool from an assembly's tool list (no-op when absent). */
function dropTool(assembly: PromptAssembly): PromptAssembly {
  const tools: ToolSchema[] = assembly.tools
  if (!tools.some((tool) => tool.name === APPLY_PATCH_TOOL_NAME)) return assembly
  return {
    ...assembly,
    tools: tools.filter((tool) => tool.name !== APPLY_PATCH_TOOL_NAME),
  }
}

/** Resolve the model that will run the next request for this agent (fallback tier). */
function modelForAgent(
  ctx: Context,
  agent: Agent | undefined,
  routes: Map<string, RouteCapture>,
): string | undefined {
  if (agent !== undefined) {
    const captured = routes.get(agent.id)
    if (captured !== undefined) return captured.model
    // A session may already have logged a request header (resumed session).
    const header = agent.session?.requestHeader?.()
    const loggedModel = header?.config?.model
    if (typeof loggedModel === 'string' && loggedModel.length > 0) return loggedModel
  }
  // Fall back to the live default selection (same tier host-apiproxy uses).
  // Use ctx.get so an absent service reads as undefined instead of throwing.
  const defaults = ctx.get('agentDefaultModel')
  const model = defaults?.currentSelection?.()?.model
  return typeof model === 'string' && model.length > 0 ? model : undefined
}
