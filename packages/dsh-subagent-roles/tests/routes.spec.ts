/**
 * Route specs: the loopback fence, method discipline, and the read/write
 * round trip over the role-matrix HTTP routes, against tmp fixture files.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeRolesRoutes, SUBAGENT_ROLES_PREFIX, type RolesRouteDeps } from '../src/routes.ts'

/**
 * Two-role preset fixture in the row dialect: fast references deep's toolName
 * in its filter lists, and deep lists fast as a spawn parent.
 */
const PRESET = `- id: subagent-tools
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    - id: tool-subagent-fast
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_fast
        backgroundMode: one-shot
        allowedParentRoles: [main, deep]
        maxDepth: 2
        persona: |-
          You are Fast.
        toolFilter:
          allow: [read, glob, subagent_deep]
        contextFilter:
          systemSections: [harness:identity, tool:subagent_deep]
          runtimeContexts: [sandbox:policy]
          denyMessageSourceKinds: [agent-instructions]
        modelFallback:
          role: fast
          routes:
            - provider: codex
              model: gpt-5.6-luna
            - provider: kimi
              model: kimi-k2.7-code
          codes: [QUOTA]

    - id: tool-subagent-deep
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_deep
        backgroundMode: one-shot
        allowedParentRoles: [fast]
        maxDepth: 2
        persona: |-
          You are Deep.
        toolFilter:
          allow: [read, write]
        contextFilter:
          systemSections: [harness:identity, tool:write]
          runtimeContexts: [sandbox:policy]
          denyMessageSourceKinds: [skill-catalog]
        modelFallback:
          role: deep
          routes:
            - provider: codex
              model: gpt-5.6-sol
          codes: [QUOTA]
`

/** Fake request: the guard reads socket address, Host header, and method. */
function fakeRequest(method: string, opts: { remoteAddress?: string; host?: string; body?: unknown } = {}): IncomingMessage {
  const chunks = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))]
  return {
    method,
    headers: { host: opts.host ?? 'localhost:3080' },
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  } as unknown as IncomingMessage
}

/** Fake response capturing status and JSON body. */
function fakeResponse(): { res: ServerResponse; result: () => { status: number; body: unknown } } {
  let status = 0
  let text = ''
  const res = {
    writeHead(code: number) {
      status = code
      return res
    },
    end(payload?: string) {
      text = payload ?? ''
    },
  } as unknown as ServerResponse
  return {
    res,
    result: () => ({ status, body: text === '' ? undefined : JSON.parse(text) }),
  }
}

/** Wire a tmp preset/settings pair into the route deps. */
function makeDeps(): { deps: RolesRouteDeps; cleanup: () => void; presetPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'roles-routes-'))
  const presetPath = join(dir, 'agent.cordis.yml')
  writeFileSync(presetPath, PRESET)
  writeFileSync(join(dir, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    codex:\n      models:\n        - id: gpt-5.6-luna\n')
  return {
    deps: { presetPath, settingsPath: join(dir, 'settings.yaml'), trustedHosts: [] },
    cleanup: () => { rmSync(dir, { recursive: true, force: true }) },
    presetPath,
  }
}

/** Invoke one route by path. */
async function invoke(routes: ReturnType<typeof makeRolesRoutes>, path: string, req: IncomingMessage): Promise<{ status: number; body: any }> {
  const route = routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error('route not mounted: ' + path)
  const { res, result } = fakeResponse()
  await route.handler(req, res)
  return result()
}

describe('makeRolesRoutes', () => {
  it('answers 403 to a non-loopback peer on every route', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      for (const route of routes) {
        const { status, body } = await invoke(routes, route.path, fakeRequest('GET', { remoteAddress: '100.83.57.1', host: 'eliass-macbook-air.tail278fee.ts.net' }))
        expect(status).toBe(403)
        expect(body.ok).toBe(false)
      }
    } finally {
      cleanup()
    }
  })

  it('serves a configured trusted host and still rejects an unlisted one', async () => {
    const { deps, cleanup } = makeDeps()
    deps.trustedHosts = ['100.83.57.105:3080']
    try {
      const routes = makeRolesRoutes(deps)
      const trusted = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/status', fakeRequest('GET', { remoteAddress: '100.83.57.1', host: '100.83.57.105:3080' }))
      expect(trusted.status).toBe(200)
      expect(trusted.body.ok).toBe(true)
      const unlisted = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/status', fakeRequest('GET', { remoteAddress: '100.83.57.1', host: 'other.tail278fee.ts.net' }))
      expect(unlisted.status).toBe(403)
    } finally {
      cleanup()
    }
  })

  it('answers 405 to the wrong method', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const get = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/roles', fakeRequest('POST', { body: {} }))
      expect(get.status).toBe(405)
      const post = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role', fakeRequest('GET'))
      expect(post.status).toBe(405)
      for (const path of ['/role-create', '/role-delete', '/role-parents', '/role-persona', '/role-filters']) {
        const wrong = await invoke(routes, SUBAGENT_ROLES_PREFIX + path, fakeRequest('GET'))
        expect(wrong.status).toBe(405)
      }
    } finally {
      cleanup()
    }
  })

  it('serves status, models, and roles to a loopback peer', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const status = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/status', fakeRequest('GET'))
      expect(status.status).toBe(200)
      expect(status.body.preset).toBe(deps.presetPath)
      const models = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/models', fakeRequest('GET'))
      expect(models.body.models.map((m: { key: string }) => m.key)).toEqual(['codex/gpt-5.6-luna'])
      const roles = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/roles', fakeRequest('GET'))
      expect(roles.body.roles.map((r: { role: string }) => r.role)).toEqual(['fast', 'deep'])
      expect(roles.body.roles[0].persona).toBe('You are Fast.')
      expect(roles.body.roles[0].toolAllow).toEqual(['read', 'glob', 'subagent_deep'])
      expect(roles.body.roles[0].contextFilter.systemSections).toEqual(['harness:identity', 'tool:subagent_deep'])
      expect(roles.body.roles[0].parents).toEqual(['main', 'deep'])
    } finally {
      cleanup()
    }
  })

  it('rewrites one role chain and reads it back', async () => {
    const { deps, cleanup, presetPath } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const saved = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role', fakeRequest('POST', {
        body: { role: 'fast', routes: ['kimi/kimi-k2.7-code', 'codex/gpt-5.6-luna'] },
      }))
      expect(saved.status).toBe(200)
      expect(saved.body.roles[0].routes.map((r: { key: string }) => r.key)).toEqual(['kimi/kimi-k2.7-code', 'codex/gpt-5.6-luna'])
      expect(readFileSync(presetPath, 'utf8')).toContain('codes: [QUOTA]')
    } finally {
      cleanup()
    }
  })

  it('rejects an unknown role with 400 and leaves the file untouched', async () => {
    const { deps, cleanup, presetPath } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const rejected = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role', fakeRequest('POST', {
        body: { role: 'nope', routes: ['a/b'] },
      }))
      expect(rejected.status).toBe(400)
      expect(rejected.body.error).toContain('unknown role')
      expect(readFileSync(presetPath, 'utf8')).toBe(PRESET)
    } finally {
      cleanup()
    }
  })

  it('applies a batch and rejects a batch with one bad entry without writing', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const saved = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/roles-batch', fakeRequest('POST', {
        body: {
          roles: [
            { role: 'fast', routes: ['kimi/kimi-k2.7-code', 'codex/gpt-5.6-luna'] },
            { role: 'deep', routes: ['codex/gpt-5.6-sol', 'kimi/kimi-k2.7-code'] },
          ],
        },
      }))
      expect(saved.status).toBe(200)
      expect(saved.body.roles[1].routes.map((r: { key: string }) => r.key)).toEqual(['codex/gpt-5.6-sol', 'kimi/kimi-k2.7-code'])

      const rejected = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/roles-batch', fakeRequest('POST', {
        body: {
          roles: [
            { role: 'fast', routes: ['codex/gpt-5.6-luna'] },
            { role: 'nope', routes: ['a/b'] },
          ],
        },
      }))
      expect(rejected.status).toBe(400)
      // The failed batch must not have rewritten the earlier good entry.
      const after = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/roles', fakeRequest('GET'))
      expect(after.body.roles[0].routes.map((r: { key: string }) => r.key)).toEqual(['kimi/kimi-k2.7-code', 'codex/gpt-5.6-luna'])
    } finally {
      cleanup()
    }
  })

  it('creates a role and reads it back in the same payload', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const created = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-create', fakeRequest('POST', {
        body: { role: 'scout', persona: 'You are Scout.', templateRole: 'fast', route: 'kimi/kimi-k2.7-code' },
      }))
      expect(created.status).toBe(200)
      expect(created.body.roles.map((r: { role: string }) => r.role)).toEqual(['fast', 'deep', 'scout'])
      const scout = created.body.roles[2]
      expect(scout.toolName).toBe('subagent_scout')
      expect(scout.parents).toEqual([])
      expect(scout.routes.map((r: { key: string }) => r.key)).toEqual(['kimi/kimi-k2.7-code'])
      expect(scout.toolAllow).toEqual(['read', 'glob', 'subagent_deep'])
      expect(scout.persona).toBe('You are Scout.')
    } finally {
      cleanup()
    }
  })

  it('rejects bad role-create input with 400 and leaves the file untouched', async () => {
    const { deps, cleanup, presetPath } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const badName = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-create', fakeRequest('POST', {
        body: { role: 'Bad name', persona: 'x', templateRole: 'fast', route: 'a/b' },
      }))
      expect(badName.status).toBe(400)
      const duplicate = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-create', fakeRequest('POST', {
        body: { role: 'fast', persona: 'x', templateRole: 'fast', route: 'a/b' },
      }))
      expect(duplicate.status).toBe(400)
      expect(duplicate.body.error).toContain('duplicate role')
      const noPersona = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-create', fakeRequest('POST', {
        body: { role: 'scout', templateRole: 'fast', route: 'a/b' },
      }))
      expect(noPersona.status).toBe(400)
      const badRoute = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-create', fakeRequest('POST', {
        body: { role: 'scout', persona: 'x', templateRole: 'fast', route: 'nomodel' },
      }))
      expect(badRoute.status).toBe(400)
      expect(readFileSync(presetPath, 'utf8')).toBe(PRESET)
    } finally {
      cleanup()
    }
  })

  it('deletes a role and strips its references from the other blocks', async () => {
    const { deps, cleanup, presetPath } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const deleted = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-delete', fakeRequest('POST', {
        body: { role: 'deep' },
      }))
      expect(deleted.status).toBe(200)
      expect(deleted.body.roles.map((r: { role: string }) => r.role)).toEqual(['fast'])
      expect(deleted.body.roles[0].parents).toEqual(['main'])
      expect(deleted.body.roles[0].toolAllow).toEqual(['read', 'glob'])
      expect(deleted.body.roles[0].contextFilter.systemSections).toEqual(['harness:identity'])
      expect(readFileSync(presetPath, 'utf8')).not.toContain('tool-subagent-deep')
    } finally {
      cleanup()
    }
  })

  it('rejects an unknown role-delete with 400', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const rejected = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-delete', fakeRequest('POST', {
        body: { role: 'nope' },
      }))
      expect(rejected.status).toBe(400)
      expect(rejected.body.error).toContain('unknown role')
    } finally {
      cleanup()
    }
  })

  it('rewrites spawn parents and validates every entry', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const saved = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-parents', fakeRequest('POST', {
        body: { role: 'fast', parents: ['main'] },
      }))
      expect(saved.status).toBe(200)
      expect(saved.body.roles[0].parents).toEqual(['main'])

      const emptied = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-parents', fakeRequest('POST', {
        body: { role: 'fast', parents: [] },
      }))
      expect(emptied.status).toBe(200)
      expect(emptied.body.roles[0].parents).toEqual([])

      const self = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-parents', fakeRequest('POST', {
        body: { role: 'fast', parents: ['fast'] },
      }))
      expect(self.status).toBe(400)
      expect(self.body.error).toContain('its own parent')
      const unknown = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-parents', fakeRequest('POST', {
        body: { role: 'fast', parents: ['ghost'] },
      }))
      expect(unknown.status).toBe(400)
      expect(unknown.body.error).toContain('unknown parent role')
      const notArray = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-parents', fakeRequest('POST', {
        body: { role: 'fast', parents: 'main' },
      }))
      expect(notArray.status).toBe(400)
    } finally {
      cleanup()
    }
  })

  it('rewrites a persona and rejects an empty one', async () => {
    const { deps, cleanup, presetPath } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const saved = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-persona', fakeRequest('POST', {
        body: { role: 'fast', persona: 'New persona.\nSecond line.' },
      }))
      expect(saved.status).toBe(200)
      expect(saved.body.roles[0].persona).toBe('New persona.\nSecond line.')
      expect(readFileSync(presetPath, 'utf8')).toContain('        toolFilter:')

      const empty = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-persona', fakeRequest('POST', {
        body: { role: 'fast', persona: '  ' },
      }))
      expect(empty.status).toBe(400)
    } finally {
      cleanup()
    }
  })

  it('rewrites filter lists and rejects bad wire input', async () => {
    const { deps, cleanup } = makeDeps()
    try {
      const routes = makeRolesRoutes(deps)
      const saved = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-filters', fakeRequest('POST', {
        body: { role: 'fast', toolAllow: ['read'], runtimeContexts: [] },
      }))
      expect(saved.status).toBe(200)
      expect(saved.body.roles[0].toolAllow).toEqual(['read'])
      expect(saved.body.roles[0].contextFilter.runtimeContexts).toEqual([])
      expect(saved.body.roles[0].contextFilter.systemSections).toEqual(['harness:identity', 'tool:subagent_deep'])

      const noFields = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-filters', fakeRequest('POST', {
        body: { role: 'fast' },
      }))
      expect(noFields.status).toBe(400)
      const badEntry = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-filters', fakeRequest('POST', {
        body: { role: 'fast', toolAllow: ['read', ''] },
      }))
      expect(badEntry.status).toBe(400)
      const unknown = await invoke(routes, SUBAGENT_ROLES_PREFIX + '/role-filters', fakeRequest('POST', {
        body: { role: 'nope', toolAllow: ['read'] },
      }))
      expect(unknown.status).toBe(400)
    } finally {
      cleanup()
    }
  })
})
