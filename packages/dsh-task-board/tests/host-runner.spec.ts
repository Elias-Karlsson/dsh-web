import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { HostExecutionRunner, SessionLaunchError, type TaskBoardApiProxy } from '../src/host-runner.ts'

type FakeWorkspace = { id: string }
type SessionEvent = { event: { type: string; seq: number; time: number; data: unknown } }

function ok<T>(value: T) {
  return { result: { ok: true as const, value } }
}

function fail(message: string, code = 'internal', details?: unknown) {
  return { result: { ok: false as const, error: { code, message, ...(details === undefined ? {} : { details }) } } }
}

function apiOf(overrides: Partial<TaskBoardApiProxy> = {}): TaskBoardApiProxy {
  const api: TaskBoardApiProxy = {
    agentPresets: { list: vi.fn(async () => ok({ presets: [] })) },
    sessions: {
      list: vi.fn(async () => ok({ items: [] })),
      create: vi.fn(async () => ok({ sessionId: 'session-a' })),
      rename: vi.fn(async request => ok({ title: request.payload.title, seq: 1 })),
      prompt: vi.fn(async () => ok({ accepted: true })),
      history: vi.fn(async () => ok({ events: [], hasMore: false })),
    },
  }
  return { ...api, ...overrides }
}

function workspaceRegistry(items: readonly FakeWorkspace[] = [{ id: 'workspace-a' }]) {
  return { list: vi.fn(() => items) } as unknown as { list(): readonly Workspace[] }
}

function event(type: string, seq: number, time: number, data: unknown): SessionEvent {
  return { event: { type, seq, time, data } }
}

function configuredTask(): TaskRecord {
  return {
    ...createTask({ title: 'Run me', description: '', prompt: 'do work' }, 1, 'task-a'),
    workspaceId: 'workspace-a',
    mode: 'preset-a',
    permission: 'workspace-write',
  }
}

describe('HostExecutionRunner', () => {
  it('validates and applies workspace, preset, and permission before the task prompt', async () => {
    const order: string[] = []
    const api = apiOf({
      agentPresets: { list: vi.fn(async () => { order.push('preset'); return ok({ presets: [{ id: 'preset-a' }] }) }) },
      sessions: {
        list: vi.fn(async () => ok({ items: [] })),
        create: vi.fn(async request => { order.push('create'); return ok({ sessionId: 'session-a', agentPreset: request.payload.agentPreset }) }),
        rename: vi.fn(async request => { order.push('rename'); return ok({ title: request.payload.title, seq: 1 }) }),
        prompt: vi.fn(async () => { order.push('prompt'); return ok({ accepted: true }) }),
        history: vi.fn(async () => ok({ events: [], hasMore: false })),
      },
    })
    const commands = { execute: vi.fn(async (_sessionId: string, line: string) => { order.push('permission'); expect(line).toBe('/permission workspace-write'); return { kind: 'success' as const } }) }

    await expect(new HostExecutionRunner(api, commands, workspaceRegistry()).launch(configuredTask())).resolves.toBe('session-a')
    expect(order).toEqual(['preset', 'create', 'rename', 'permission', 'prompt'])
    expect(api.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ payload: { workspaceId: 'workspace-a', agentPreset: 'preset-a' } }))
    expect(api.sessions.prompt).toHaveBeenCalledWith(expect.objectContaining({ payload: { sessionId: 'session-a', mode: 'queue', content: [{ type: 'text', text: 'do work' }] } }))
  })

  it('fails closed before prompt for a missing workspace, unavailable permission dispatcher, or rejected proxy operation', async () => {
    const api = apiOf({ agentPresets: { list: vi.fn(async () => ok({ presets: [{ id: 'preset-a' }] })) } })
    await expect(new HostExecutionRunner(api, undefined, workspaceRegistry([])).launch(configuredTask())).rejects.toThrow('workspace not found')
    expect(api.sessions.create).not.toHaveBeenCalled()

    const noPermission = new HostExecutionRunner(api, undefined, workspaceRegistry()).launch(configuredTask())
    await expect(noPermission).rejects.toMatchObject({ name: 'SessionLaunchError', sessionId: 'session-a' })
    expect(api.sessions.prompt).not.toHaveBeenCalled()

    const rejected = apiOf({
      agentPresets: { list: vi.fn(async () => ok({ presets: [{ id: 'preset-a' }] })) },
      sessions: { ...api.sessions, rename: vi.fn(async () => fail('title rejected')) },
    })
    await expect(new HostExecutionRunner(rejected, { execute: async () => ({ kind: 'success' }) }, workspaceRegistry()).launch(configuredTask())).rejects.toThrow('title rejected')
    expect(rejected.sessions.prompt).not.toHaveBeenCalled()
  })

  it('preserves an ApiProxy session id when workspace attachment fails after creation', async () => {
    const api = apiOf({
      agentPresets: { list: vi.fn(async () => ok({ presets: [{ id: 'preset-a' }] })) },
      sessions: {
        ...apiOf().sessions,
        create: vi.fn(async () => fail('session "session-attached" was created but could not attach to workspace "workspace-a"', 'workspace-attach-failed', { sessionId: 'session-attached', workspaceId: 'workspace-a' })),
      },
    })

    await expect(new HostExecutionRunner(api, { execute: async () => ({ kind: 'success' }) }, workspaceRegistry()).launch(configuredTask()))
      .rejects.toMatchObject({ name: 'SessionLaunchError', sessionId: 'session-attached', message: expect.stringContaining('workspace-attach-failed') })
    expect(api.sessions.rename).not.toHaveBeenCalled()
    expect(api.sessions.prompt).not.toHaveBeenCalled()
  })

  it('settles from the current session list and bounded session history', async () => {
    let running = true
    const api = apiOf({
      sessions: {
        list: vi.fn(async () => ok({ items: [{ sessionId: 'session-a', running }] })),
        create: vi.fn(async () => ok({ sessionId: 'session-a' })),
        rename: vi.fn(async () => ok({ title: 'x', seq: 1 })),
        prompt: vi.fn(async () => ok({ accepted: true })),
        history: vi.fn(async () => ok({ events: [event('turn/end', 10, 1_100, { reason: { kind: 'error' } })], hasMore: false })),
      },
    })
    const runner = new HostExecutionRunner(api)
    await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'pending' })
    running = false
    await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'failed', error: 'agent turn ended with an error' })
  })

  it('pages backward to the execution turn and ignores a later turn', async () => {
    const history = vi.fn(async request => request.payload.beforeSeq === undefined
      ? ok({ events: [event('turn/end', 300, 3_000, { reason: { kind: 'error' } })], hasMore: true })
      : ok({ events: [event('turn/end', 100, 1_100, { reason: { kind: 'complete' } })], hasMore: false }))
    const api = apiOf({
      sessions: {
        list: vi.fn(async () => ok({ items: [{ sessionId: 'session-a', running: false }] })),
        create: vi.fn(async () => ok({ sessionId: 'session-a' })),
        rename: vi.fn(async () => ok({ title: 'x', seq: 1 })),
        prompt: vi.fn(async () => ok({ accepted: true })),
        history,
      },
    })
    await expect(new HostExecutionRunner(api).inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'succeeded' })
    expect(history).toHaveBeenCalledTimes(2)
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { sessionId: 'session-a', beforeSeq: 300, maxMessages: 100 } }))
  })

  it('reuses a supplied roster, pages a complete list, and holds outcome pending on proxy read failure', async () => {
    const list = vi.fn(async request => request.payload.cursor === undefined
      ? ok({ items: [{ sessionId: 'session-a', running: false }], nextCursor: 'next' })
      : ok({ items: [{ sessionId: 'session-b', running: true } ] }))
    const history = vi.fn(async () => ok({ events: [event('turn/end', 10, 1_100, { reason: { kind: 'complete' } })], hasMore: false }))
    const api = apiOf({ sessions: { ...apiOf().sessions, list, history } })
    const runner = new HostExecutionRunner(api)
    await expect(runner.listRunning()).resolves.toEqual({ known: true, count: 1, items: [{ sessionId: 'session-a', running: false }, { sessionId: 'session-b', running: true }] })
    await expect(runner.inspect('session-a', 1_000, [{ sessionId: 'session-a', running: false }])).resolves.toEqual({ outcome: 'succeeded' })
    expect(list).toHaveBeenCalledTimes(2)

    api.sessions.history = vi.fn(async () => fail('offline'))
    await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'pending' })
  })

  it('memoizes an unchanged incomplete history and clears it on cancellation', async () => {
    const history = vi.fn(async () => ok({ events: [event('assistant/message', 40, 4_000, {})], hasMore: false }))
    const list = vi.fn(async () => ok({ items: [{ sessionId: 'session-a', running: false }] }))
    const api = apiOf({ sessions: { ...apiOf().sessions, list, history } })
    const runner = new HostExecutionRunner(api)
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    expect(history).toHaveBeenCalledTimes(2)
    list.mockResolvedValueOnce(ok({ items: [] }))
    await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'cancelled', error: 'execution session no longer exists' })
  })

  it('preserves a created session id when permission execution fails', async () => {
    const api = apiOf({ agentPresets: { list: vi.fn(async () => ok({ presets: [{ id: 'preset-a' }] })) } })
    const runner = new HostExecutionRunner(api, { execute: async () => { throw new Error('permission timed out') } }, workspaceRegistry())
    await expect(runner.launch(configuredTask())).rejects.toBeInstanceOf(SessionLaunchError)
    await expect(runner.launch(configuredTask())).rejects.toMatchObject({ sessionId: 'session-a' })
  })
})
