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

/** Minimal two-role preset fixture (the dialect the surgery parses). */
const PRESET = `- id: subagent-tools
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    tools:
        toolName: subagent_fast
        allowedParentRoles: [main]
        modelFallback:
          role: fast
          routes:
            - provider: codex
              model: gpt-5.6-luna
            - provider: kimi
              model: kimi-k2.7-code
          codes: [QUOTA]
        toolName: subagent_deep
        allowedParentRoles: [main]
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
    const { deps, cleanup, presetPath } = makeDeps()
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
})
