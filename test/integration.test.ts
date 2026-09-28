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
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { apply as applyObservationPolicy } from '@deepseek-ai/dsh-fs-observation-policy'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { apply as applyPlugin, readMode } from '../src/index.js'
import { ApplyPatchSettingsSchema } from '../src/host/settings-schema.js'
import { APPLY_PATCH_TOOL_NAME, shouldOfferTool } from '../src/host/injector.js'

/** Boot a composed context with the given sandbox mode + entry config. */
async function boot(workspace: string, mode: string, entryConfig: Record<string, unknown>) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalSandboxProvider, {})
  await ctx.plugin(SandboxPolicyService, { mode: mode as never, workspaceRoot: workspace })
  await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
  await ctx.plugin(SandboxBashExecutor, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(SystemPrompt, {})
  // alpha.2: SandboxPolicyService registers a sandboxMode session projection,
  // so the projection registry service must exist before it activates.
  await ctx.plugin(SessionProjectionRegistry, {})
  await ctx.plugin(applyObservationPolicy)
  // dsh >= 0.1.7 wiring: the mode rides this entry's config, resolved through
  // the plugin's Config schema exactly as the loader does it (that resolution is
  // what turns `mode` into a live volatile handle).
  await ctx.plugin({
    name: 'dsh-apply-patch',
    inject: ['tools', 'fs', 'systemPrompt', 'sandboxPolicy'],
    apply: (pluginCtx: Context) => applyPlugin(pluginCtx, ApplyPatchSettingsSchema(entryConfig) as never),
  } as never)
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

  it('reads the mode out of the entry config, volatile handle included', async () => {
    // dsh >= 0.1.7 hands a `volatile()` field to apply() as a LIVE HANDLE
    // (`{ get() }`, non-enumerable, JSON `{}`), never as the value. Reading
    // `config.mode` directly therefore collapsed every choice to the handle
    // object and the settings dropdown had no effect ("off" / "all" both fell
    // through to the gpt-only branch of shouldOfferTool).
    const resolved = ApplyPatchSettingsSchema({ mode: 'all' }) as unknown as { mode: unknown }
    assert.equal(typeof resolved.mode, 'object', 'the schema wraps the field in a cell')
    assert.ok(
      Symbol.for('cosmokit.volatile.write') in (resolved.mode as object),
      'the cell carries cosmokit\'s registered symbol',
    )
    assert.equal(readMode(resolved as never), 'all', 'cell is unwrapped')
    // Plain values (hand-built patches, hosts that resolve the config without
    // the volatile wrapper) and absent/invalid values keep working.
    assert.equal(readMode({ mode: 'off' } as never), 'off')
    assert.equal(readMode(undefined), 'gpt-only')
    assert.equal(readMode({ mode: 'nonsense' } as never), 'gpt-only')
  })
})

describe('conditional injection', () => {
  /**
   * Drive the REAL system-prompt/assemble waterfall with a synthetic assembly.
   *
   * The composed test context mounts no prompt tool list (that wiring lives in
   * plugins this scaffold does not boot), so `systemPrompt.assemble()` returns
   * an empty tool list and could not tell the modes apart. Emitting the
   * waterfall with one apply_patch tool in the assembly exercises the plugin's
   * own hook — which is what decides whether the tool survives.
   */
  async function assembleTools(ctx: Context, model: string | undefined): Promise<string[]> {
    const assembly = {
      tools: [{ name: APPLY_PATCH_TOOL_NAME }],
      variables: model === undefined ? {} : { model },
    }
    const out = await ctx.waterfall(
      'system-prompt/assemble',
      assembly as never,
      { agent: undefined } as never,
      () => Promise.resolve(assembly as never),
    )
    return (out as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)
  }

  it('drops the tool when mode is off', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'off' })
    assert.deepEqual(await assembleTools(ctx, 'gpt-4.1'), [])
  })

  it('keeps the tool for gpt models in gpt-only mode', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'gpt-only' })
    assert.deepEqual(await assembleTools(ctx, 'gpt-4.1'), [APPLY_PATCH_TOOL_NAME])
    assert.deepEqual(await assembleTools(ctx, 'deepseek-v4'), [])
    // Pure decision stays covered too.
    assert.equal(shouldOfferTool('gpt-only', 'gpt-4.1'), true)
    assert.equal(shouldOfferTool('gpt-only', 'o3-mini'), false)
    assert.equal(shouldOfferTool('gpt-only', 'deepseek-v4'), false)
  })

  it('keeps the tool for every model in all mode', async () => {
    const ctx = await boot(workspace, 'workspace-write', { mode: 'all' })
    assert.deepEqual(await assembleTools(ctx, 'deepseek-v4'), [APPLY_PATCH_TOOL_NAME])
    assert.deepEqual(await assembleTools(ctx, undefined), [APPLY_PATCH_TOOL_NAME])
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
