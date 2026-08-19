/**
 * Integration test: boot a real cordis context with the real DSH services
 * (tools registry, system-prompt assembly, settings, sandbox-policy,
 * sandboxed filesystem, observation policy) plus this plugin's apply, then
 * verify:
 *   1. the apply_patch tool is registered,
 *   2. conditional injection honors the settings mode + model,
 *   3. a full patch executes through the sandboxed fs seam (add/update/delete),
 *   4. sandbox denials surface as `[sandbox: ...]` errors (read-only mode).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { apply as applyObservationPolicy } from '@deepseek-ai/dsh-fs-observation-policy'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { apply as applyPlugin } from '../src/index.js'
import { APPLY_PATCH_TOOL_NAME, shouldOfferTool } from '../src/host/injector.js'

/** In-memory settings provider (subclass of the real base, loaded as a plugin). */
class MemorySettings extends SettingsProvider {
  static Config = undefined as never
  doc: Record<string, unknown>
  readonly writable = true
  constructor(ctx: Context, config: { doc: Record<string, unknown> }) {
    super(ctx)
    this.doc = config.doc
  }
  async load(): Promise<Record<string, unknown>> {
    return this.doc
  }
  protected async persist(_ns: Parameters<SettingsProvider['persist']>[0], section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, ...section }
  }
}

/** Boot a composed context with the given sandbox mode + user settings doc. */
async function boot(workspace: string, mode: string, userDoc: Record<string, unknown>) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalSandboxProvider, {})
  await ctx.plugin(SandboxPolicyService, { mode: mode as never, workspaceRoot: workspace })
  await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
  await ctx.plugin(SandboxBashExecutor, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(MemorySettings, { doc: { 'dsh-apply-patch': userDoc } })
  await ctx.plugin(applyObservationPolicy)
  await ctx.plugin({
    name: 'dsh-apply-patch',
    inject: ['tools', 'fs', 'systemPrompt', 'settings', 'sandboxPolicy'],
    apply: applyPlugin,
  })
  return ctx
}

/** One simulated tool execution with a session cwd. */
function fakeExec(ctx: Context, cwd: string, signal = new AbortController().signal) {
  return {
    callId: 'test-call',
    name: APPLY_PATCH_TOOL_NAME,
    arguments: {},
    signal,
    agent: {
      id: 'test-agent',
      session: { header: { cwd }, events: [] },
    },
  } as never
}

const suiteDir = mkdtempSync(join(tmpdir(), 'ap-integration-'))
const workspace = join(suiteDir, 'ws')
// A path OUTSIDE the workspace root AND outside tmpdir (the sandbox
// workspace-write policy explicitly allows /tmp writes).
const escapeDir = join(homedir(), '.dsh-apply-patch-escape-test')

before(() => {
  // Node's fs is used to PREPARE the workspace only; the tool itself only
  // mutates through the sandboxed fs seam.
  rmSync(workspace, { recursive: true, force: true })
  rmSync(escapeDir, { recursive: true, force: true })
})

after(() => {
  rmSync(suiteDir, { recursive: true, force: true })
})

describe('plugin apply', () => {
  it('registers the apply_patch tool', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'all' })
    const names = ctx.tools.schemas().map((t: { name: string }) => t.name)
    assert.ok(names.includes(APPLY_PATCH_TOOL_NAME), `tool registered: ${names.join(', ')}`)

  })

  it('registers the settings namespace', async () => {
    const ctx = await boot(workspace, 'workspace-write', {})
    const describe = (ctx.get('settings') as SettingsProvider).describe()
    const ns = describe.find((d) => d.ns === settingsNamespace('dsh-apply-patch'))
    assert.ok(ns !== undefined, 'dsh-apply-patch namespace served')
    assert.equal((ns.value as { mode: string }).mode, 'gpt-only')

  })
})

describe('conditional injection', () => {
  it('drops the tool when mode is off', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'off' })
    const assembly = await ctx.systemPrompt.assemble({ scope: undefined, agent: undefined })
    assert.ok(!assembly.tools.some((t) => t.name === APPLY_PATCH_TOOL_NAME))

  })

  it('keeps the tool for gpt models in gpt-only mode', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'gpt-only' })
    // Simulate a captured route: the agent/request hook fills the cache; we
    // can't easily drive a real loop here, so verify the pure decision +
    // assembly with a gpt model via the default-selection fallback path.
    const assembly = await ctx.systemPrompt.assemble({ scope: undefined, agent: undefined })
    // The default selection in this test context is undefined -> falls to the
    // agentDefaultModel tier, also undefined -> gpt-only hides the tool.
    assert.ok(!assembly.tools.some((t) => t.name === APPLY_PATCH_TOOL_NAME))
    // Pure decision: gpt models DO get it.
    assert.equal(shouldOfferTool('gpt-only', 'gpt-4.1'), true)
    assert.equal(shouldOfferTool('gpt-only', 'o3-mini'), false)
    assert.equal(shouldOfferTool('gpt-only', 'deepseek-v4'), false)

  })

  it('keeps the tool for every model in all mode', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'all' })
    const assembly = await ctx.systemPrompt.assemble({ scope: undefined, agent: undefined })
    assert.ok(assembly.tools.some((t) => t.name === APPLY_PATCH_TOOL_NAME))

  })
})

describe('end-to-end patch application (sandboxed fs)', () => {
  it('adds, updates, and deletes files through the sandbox seam', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'all' })
    // Prepare via the SANDBOXED fs (not node fs) to stay faithful.
    const target = await ctx.fs.resolve('hello.py', { cwd: workspace })
    const info = await ctx.fs.stat(target)
    if (info === undefined) {
      const intent = await ctx.waterfall('fs/write-intent', target, undefined, () => undefined)
      await ctx.fs.writeText(target, 'print("hello")\n', intent)
      ctx.emit('fs/observed', target, { kind: 'present', version: (await ctx.fs.stat(target))!.version }, undefined)
    }
    const writeIntentFor = async (path: string) => {
      const t = await ctx.fs.resolve(path, { cwd: workspace })
      return { target: t, intent: await ctx.waterfall('fs/write-intent', t, undefined, () => undefined) }
    }

    // Find the tool definition and execute it with a fake exec.
    const def = ctx.tools.schemas().find((t) => t.name === APPLY_PATCH_TOOL_NAME) as never
    const exec = fakeExec(ctx, workspace)
    const run = async (patch: string) => {
      const tool = (ctx.tools as unknown as { get(name: string): { execute(args: unknown, exec: unknown): Promise<string> } }).get(APPLY_PATCH_TOOL_NAME)
      return tool.execute({ patch }, exec)
    }

    // Add a new file.
    const addOut = await run([
      '*** Begin Patch',
      '*** Add File: new.py',
      '+x = 1',
      '+y = 2',
      '*** End Patch',
    ].join('\n'))
    assert.match(addOut, /Success\. Updated the following files:\nA .*new\.py/)

    // Update hello.py.
    const updOut = await run([
      '*** Begin Patch',
      '*** Update File: hello.py',
      '@@',
      '-print("hello")',
      '+print("hello, world")',
      '*** End Patch',
    ].join('\n'))
    assert.match(updOut, /M .*hello\.py/)
    const after = await ctx.fs.readText(await ctx.fs.resolve('hello.py', { cwd: workspace }))
    assert.equal(after, 'print("hello, world")\n')

    // Delete the new file.
    const delOut = await run([
      '*** Begin Patch',
      '*** Delete File: new.py',
      '*** End Patch',
    ].join('\n'))
    assert.match(delOut, /D .*new\.py/)
    assert.equal(await ctx.fs.stat(await ctx.fs.resolve('new.py', { cwd: workspace })), undefined)


  })

  it('rejects a patch whose context does not match', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'all' })
    const tool = (ctx.tools as unknown as { get(name: string): { execute(args: unknown, exec: unknown): Promise<string> } }).get(APPLY_PATCH_TOOL_NAME)
    await assert.rejects(
      tool.execute({ patch: [
        '*** Begin Patch',
        '*** Update File: hello.py',
        '@@',
        '-print("nope")',
        '+print("x")',
        '*** End Patch',
      ].join('\n') }, fakeExec(ctx, workspace)),
      /Failed to find expected lines/,
    )

  })

  it('surfaces sandbox denials as [sandbox: ...] under read-only', async () => {
    const ctx = await boot(workspace, 'read-only', { mode: 'all' })
    const tool = (ctx.tools as unknown as { get(name: string): { execute(args: unknown, exec: unknown): Promise<string> } }).get(APPLY_PATCH_TOOL_NAME)
    await assert.rejects(
      tool.execute({ patch: [
        '*** Begin Patch',
        '*** Add File: denied.py',
        '+x = 1',
        '*** End Patch',
      ].join('\n') }, fakeExec(ctx, workspace)),
      /sandbox: file access denied under read-only mode/,
    )

  })

  it('rejects writes outside the workspace root under workspace-write', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'all' })
    const tool = (ctx.tools as unknown as { get(name: string): { execute(args: unknown, exec: unknown): Promise<string> } }).get(APPLY_PATCH_TOOL_NAME)
    await assert.rejects(
      tool.execute({ patch: [
        '*** Begin Patch',
        `*** Add File: ${escapeDir}/escape.py`,
        '+x = 1',
        '*** End Patch',
      ].join('\n') }, fakeExec(ctx, workspace)),
      /sandbox: file access denied/,
    )

  })
})
