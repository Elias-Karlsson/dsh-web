import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import { createTask, startExecution } from '../src/core/tasks.ts'
import { makeApiProxy } from './api-proxy.fake.ts'

const roots: string[] = []
function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-task-board-service-'))
  roots.push(value)
  return value
}
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }) })

function service(api = makeApiProxy(), ledger = new HostTaskLedger(root()), now = Date.now) {
  return new TaskBoardHostService(api, { ledger, power: new PowerInhibitor({ platform: 'linux' }), now })
}

describe('TaskBoardHostService scheduling without a browser', () => {
  it('fires one due run and records its independent session', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', { kind: 'create', id: 'scheduled', input: { title: 'Scheduled', description: '', prompt: 'work', schedule: { enabled: true, cron: '* * * * *' } } })
    const api = makeApiProxy({ sessionsCreate: async () => ({ sessionId: 'session-scheduled' }) })
    const host = service(api, ledger, () => now)
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await (host as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(false)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(api.sessions.create).toHaveBeenCalledOnce()
    expect(api.sessions.prompt).toHaveBeenCalledOnce()
    expect(ledger.state().tasks[0].executions[0].sessionId).toBe('session-scheduled')
    await (host as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(false)
    expect(api.sessions.create).toHaveBeenCalledOnce()
    host.dispose()
  })

  it('skips a due occurrence on the recovery tick', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', { kind: 'create', id: 'scheduled', input: { title: 'Scheduled', description: '', prompt: '', schedule: { enabled: true, cron: '* * * * *' } } })
    const api = makeApiProxy()
    const host = service(api, ledger, () => now)
    now = new Date(2026, 7, 16, 10, 2, 0).getTime()
    await (host as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(true)
    expect(api.sessions.create).not.toHaveBeenCalled()
    expect(ledger.state().tasks[0].schedule?.nextRunAt).toBe(new Date(2026, 7, 16, 10, 3, 0).getTime())
    host.dispose()
  })

  it('settles an open execution from ApiProxy history', async () => {
    const ledger = new HostTaskLedger(root())
    const opened = startExecution(createTask({ title: 'A', description: '', prompt: '' }, 1_000, 'task-a'), 1_100, 'execution-a').task
    ledger.applyRequest('import', { kind: 'import', sourceId: 'browser', tasks: [{ ...opened, executions: opened.executions.map(execution => ({ ...execution, sessionId: 'session-a' })) }] })
    const api = makeApiProxy({
      sessionsList: async () => ({ items: [{ sessionId: 'session-a', running: false }] }),
      sessionsHistory: async () => ({ events: [{ event: { type: 'turn/end', seq: 10, time: 1_200, data: { reason: { kind: 'complete' } } } }], hasMore: false }),
    })
    const host = service(api, ledger)
    host.setConfiguration(false, false)
    await (host as unknown as { pollSessions(): Promise<void> }).pollSessions()
    expect(ledger.state().tasks[0].executions[0].result).toBe('succeeded')
    expect(ledger.state().tasks[0].status).toBe('done')
    host.dispose()
  })

  it('uses the one ApiProxy list fetched for each poll', async () => {
    const list = vi.fn(async () => ({ items: [{ sessionId: 'session-a', running: false }] }))
    const api = makeApiProxy({ sessionsList: list })
    const host = service(api)
    await (host as unknown as { pollSessions(): Promise<void> }).pollSessions()
    expect(list).toHaveBeenCalledOnce()
    host.dispose()
  })

  it('starts its two Host timers only once and reports the first poll state transition', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const host = service()
    let pushes = 0
    host.subscribe(() => { pushes += 1 })
    host.start()
    host.start()
    expect(interval).toHaveBeenCalledTimes(2)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(pushes).toBeGreaterThanOrEqual(1)
    host.dispose()
    interval.mockRestore()
  })
})
