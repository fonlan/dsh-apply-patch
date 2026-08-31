import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { apply as applyObservationPolicy } from '@deepseek-ai/dsh-fs-observation-policy'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { apply as applyPlugin } from './src/index.js'

class MemorySettings extends SettingsProvider {
  static Config = undefined as never
  doc: Record<string, unknown>
  readonly writable = true
  constructor(ctx: Context, config: { doc: Record<string, unknown> }) {
    super(ctx)
    this.doc = config.doc
  }
  async load(): Promise<Record<string, unknown>> { return this.doc }
  protected async persist(_ns, section): Promise<void> { this.doc = { ...this.doc, ...section } }
}

const ws = mkdtempSync(join(tmpdir(), 'ap-dbg-'))
const ctx = new Context()
await ctx.plugin(LocalSubprocessRuntime)
await ctx.plugin(LocalSandboxProvider, {})
await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write' as never, workspaceRoot: ws })
await ctx.plugin(SandboxedFileSystem, { cwd: ws })
await ctx.plugin(SandboxBashExecutor, {})
await ctx.plugin(ToolRuntime, {})
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(MemorySettings, { doc: { 'dsh-apply-patch': { mode: 'all' } } })
await ctx.plugin(applyObservationPolicy)
const fiber = await ctx.plugin({ name: 'dsh-apply-patch', inject: ['tools', 'fs', 'systemPrompt', 'settings', 'sandboxPolicy'], apply: applyPlugin })
console.log('plugin() returned:', typeof fiber, (fiber as any)?.constructor?.name)
await new Promise(r => setTimeout(r, 300))
const f = (fiber as any)?.fiber ?? fiber
console.log('fiber state:', (f as any)?.state)
console.log('fiber error:', (f as any)?.error)
console.log('tools:', (ctx as any).tools?.schemas?.().map((t: any) => t.name))
process.exit(0)
