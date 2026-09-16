/**
 * Loopback-fenced HTTP routes for the subagent role matrix: read the preset's
 * role blocks and the settings.yaml model catalog, and rewrite role chains,
 * spawn parents, personas, filters, and whole role blocks. Exact-path
 * registrations for the host webServer seam.
 * @module @linxin666/dsh-client-ui-subagent-roles/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from './loopback.ts'
import { readJsonBody, writeJson } from './http.ts'
import {
  addRole,
  deleteRole,
  readAvailableModels,
  readRoles,
  replaceFilters,
  replaceParents,
  replacePersona,
  replaceRoutes,
  type RoleFilterUpdate,
} from './roles-file.ts'

/** Path prefix every route of this package mounts under. */
export const SUBAGENT_ROLES_PREFIX = '/subagent-roles/api'

/** Dependencies the routes close over (injectable for tests). */
export interface RolesRouteDeps {
  /** Absolute path of the preset's agent.cordis.yml. */
  presetPath: string
  /** Absolute path of settings.yaml (model catalog source). */
  settingsPath: string
  /**
   * Host headers (exact match, case-insensitive) accepted alongside loopback.
   * Tailnet or LAN access must be listed here explicitly; empty means loopback
   * only.
   */
  trustedHosts: readonly string[]
}

/** Whether the request's Host header matches one of the trusted hosts. */
function isTrustedHost(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = req.headers.host
  if (typeof host !== 'string') return false
  const lowered = host.toLowerCase()
  return trustedHosts.some(trusted => trusted.toLowerCase() === lowered)
}

/** One chain rewrite inside a batch request (post-parse shape). */
interface RoleUpdate {
  /** Role name to rewrite. */
  role: string
  /** New chain as provider/model pairs. */
  routes: readonly { provider: string; model: string }[]
}

/** Parse one wire route entry into provider/model, throwing on bad input. */
function parseWireRoute(entry: string | { provider: string; model: string }): { provider: string; model: string } {
  if (typeof entry === 'string') {
    const slash = entry.indexOf('/')
    if (slash <= 0) throw new Error(`invalid route: ${entry}`)
    return { provider: entry.slice(0, slash), model: entry.slice(slash + 1) }
  }
  if (entry !== null && typeof entry === 'object' && typeof entry.provider === 'string' && typeof entry.model === 'string') {
    return { provider: entry.provider, model: entry.model }
  }
  throw new Error(`invalid route object: ${JSON.stringify(entry)}`)
}

/** Narrow an unknown JSON body to one role update, throwing on bad input. */
function parseUpdate(body: unknown): RoleUpdate {
  if (body === null || typeof body !== 'object') throw new Error('body must be an object')
  const candidate = body as { role?: unknown; routes?: unknown }
  if (typeof candidate.role !== 'string' || candidate.role.trim() === '') throw new Error('role must be a non-empty string')
  if (!Array.isArray(candidate.routes)) throw new Error('routes must be an array')
  return { role: candidate.role, routes: (candidate.routes as RoleUpdate['routes']).map(parseWireRoute) }
}

/** Narrow an unknown JSON body to one `{ role }` mutation, throwing on bad input. */
function parseRoleRef(body: unknown): string {
  if (body === null || typeof body !== 'object') throw new Error('body must be an object')
  const candidate = (body as { role?: unknown }).role
  if (typeof candidate !== 'string' || candidate.trim() === '') throw new Error('role must be a non-empty string')
  return candidate
}

/** Narrow a wire field to a deduped string array, throwing on bad input. */
function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') throw new Error(`${field} must contain non-empty strings`)
    if (!out.includes(entry)) out.push(entry)
  }
  return out
}

/** Serialize the current role blocks for the wire. */
function rolesPayload(deps: RolesRouteDeps): { ok: true; roles: unknown[] } {
  const blocks = readRoles(deps.presetPath)
  return {
    ok: true,
    roles: blocks.map(b => ({
      role: b.role,
      toolName: b.toolName,
      parents: b.parents,
      routes: b.routes,
      persona: b.persona,
      toolAllow: b.toolAllow,
      contextFilter: b.contextFilter,
    })),
  }
}

/** Apply chain updates sequentially; the first failure discards the whole batch. */
function applyUpdates(deps: RolesRouteDeps, updates: readonly RoleUpdate[]): void {
  let text = readFileSync(deps.presetPath, 'utf8')
  for (const update of updates) {
    text = replaceRoutes(text, update.role, update.routes)
  }
  writeFileSync(deps.presetPath, text, 'utf8')
}

/** Run one surgery over the preset text and write the result back. */
function applySurgery(deps: RolesRouteDeps, surgery: (text: string) => string): void {
  writeFileSync(deps.presetPath, surgery(readFileSync(deps.presetPath, 'utf8')), 'utf8')
}

/**
 * Build the role-matrix routes. Reads are GET, writes are POST; every route
 * answers 403 to a request that is neither loopback nor a configured trusted
 * host, and 405 to the wrong method. Write
 * failures (unknown role, invalid chain, malformed file) answer 400 with the
 * validation message; an unreadable preset answers 500.
 * @param deps - preset and settings paths, plus trusted host headers.
 * @returns the exact-path route registrations.
 */
export function makeRolesRoutes(deps: RolesRouteDeps): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean => {
    if (!isLoopbackRequest(req) && !isTrustedHost(req, deps.trustedHosts)) {
      writeJson(res, 403, { ok: false, error: 'forbidden' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { ok: false, error: 'method not allowed: ' + (req.method ?? '') })
      return false
    }
    return true
  }

  const readBody = async (req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> => {
    const body = await readJsonBody(req, { maxBytes: 256 * 1024 })
    if (body === null) {
      writeJson(res, 400, { ok: false, error: 'unreadable JSON body' })
      return undefined
    }
    return body
  }

  /** Shared POST mutation shape: guard, body, surgery, roles read-back. */
  const mutation = (apply: (body: unknown) => void) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!guard(req, res, 'POST')) return
    const body = await readBody(req, res)
    if (body === undefined) return
    try {
      apply(body)
      writeJson(res, 200, rolesPayload(deps))
    } catch (error: unknown) {
      writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return [
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/status',
      handler: (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { ok: true, version: '1.0', preset: deps.presetPath })
      },
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/models',
      handler: (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { ok: true, models: readAvailableModels(deps.settingsPath) })
      },
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/roles',
      handler: (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, rolesPayload(deps))
        } catch (error: unknown) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/role',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readBody(req, res)
        if (body === undefined) return
        try {
          const update = parseUpdate(body)
          applyUpdates(deps, [update])
          writeJson(res, 200, rolesPayload(deps))
        } catch (error: unknown) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/roles-batch',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readBody(req, res)
        if (body === undefined) return
        try {
          const list = (body as { roles?: unknown }).roles
          if (!Array.isArray(list)) throw new Error('roles must be an array')
          applyUpdates(deps, list.map(parseUpdate))
          writeJson(res, 200, rolesPayload(deps))
        } catch (error: unknown) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/role-create',
      handler: mutation(body => {
        if (body === null || typeof body !== 'object') throw new Error('body must be an object')
        const candidate = body as { role?: unknown; persona?: unknown; templateRole?: unknown; route?: unknown }
        if (typeof candidate.role !== 'string' || candidate.role.trim() === '') throw new Error('role must be a non-empty string')
        if (typeof candidate.persona !== 'string' || candidate.persona.trim() === '') throw new Error('persona must be a non-empty string')
        if (typeof candidate.templateRole !== 'string' || candidate.templateRole.trim() === '') throw new Error('templateRole must be a non-empty string')
        const route = parseWireRoute(candidate.route as string | { provider: string; model: string })
        applySurgery(deps, text => addRole(text, { role: candidate.role as string, persona: candidate.persona as string, templateRole: candidate.templateRole as string, route }))
      }),
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/role-delete',
      handler: mutation(body => {
        const role = parseRoleRef(body)
        applySurgery(deps, text => deleteRole(text, role))
      }),
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/role-parents',
      handler: mutation(body => {
        if (body === null || typeof body !== 'object') throw new Error('body must be an object')
        const role = parseRoleRef(body)
        const parents = parseStringList((body as { parents?: unknown }).parents, 'parents')
        const known = new Set(readRoles(deps.presetPath).map(b => b.role))
        for (const parent of parents) {
          if (parent === role) throw new Error('a role cannot be its own parent')
          if (parent !== 'main' && !known.has(parent)) throw new Error(`unknown parent role: ${parent}`)
        }
        applySurgery(deps, text => replaceParents(text, role, parents))
      }),
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/role-persona',
      handler: mutation(body => {
        if (body === null || typeof body !== 'object') throw new Error('body must be an object')
        const role = parseRoleRef(body)
        const persona = (body as { persona?: unknown }).persona
        if (typeof persona !== 'string' || persona.trim() === '') throw new Error('persona must be a non-empty string')
        applySurgery(deps, text => replacePersona(text, role, persona))
      }),
    },
    {
      kind: 'exact',
      path: SUBAGENT_ROLES_PREFIX + '/role-filters',
      handler: mutation(body => {
        if (body === null || typeof body !== 'object') throw new Error('body must be an object')
        const role = parseRoleRef(body)
        const candidate = body as {
          toolAllow?: unknown
          systemSections?: unknown
          runtimeContexts?: unknown
          denyMessageSourceKinds?: unknown
        }
        const filters: RoleFilterUpdate = {}
        if (candidate.toolAllow !== undefined) filters.toolAllow = parseStringList(candidate.toolAllow, 'toolAllow')
        if (candidate.systemSections !== undefined) filters.systemSections = parseStringList(candidate.systemSections, 'systemSections')
        if (candidate.runtimeContexts !== undefined) filters.runtimeContexts = parseStringList(candidate.runtimeContexts, 'runtimeContexts')
        if (candidate.denyMessageSourceKinds !== undefined) filters.denyMessageSourceKinds = parseStringList(candidate.denyMessageSourceKinds, 'denyMessageSourceKinds')
        if (Object.keys(filters).length === 0) throw new Error('no filter fields provided')
        applySurgery(deps, text => replaceFilters(text, role, filters))
      }),
    },
  ]
}
