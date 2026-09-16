/**
 * Preset role-chain file surgery: parse, validate, and rewrite the `routes:`
 * blocks of a subagent-role preset (the model-roles dialect of
 * agent.cordis.yml) without touching any other line. Only `routes:` blocks
 * are rewritten — comments, personas, prompt sections, and every other row
 * survive a save byte for byte.
 *
 * Ported from the standalone Subagent Role Matrix server
 * (dsh-subagent-role-routing/web/server.mjs); the line-surgery contract is
 * identical so the two tools can edit the same preset file interchangeably.
 * @module @linxin666/dsh-client-ui-subagent-roles/roles-file
 */

import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'

/** One route in a role chain: provider id + model id, plus its display key. */
export interface RoleRoute {
  /** Provider id as written in the preset (`provider:` line). */
  provider: string
  /** Model id as written in the preset (`model:` line). */
  model: string
  /** `provider/model` display and identity key. */
  key: string
}

/** One parsed role block: identity plus the line span of its routes list. */
export interface RoleBlock {
  /** Role name (`role:` line inside the tool's modelFallback). */
  role: string
  /** Owning subagent tool (`toolName:` line, e.g. `subagent_fast`). */
  toolName: string
  /** Parent roles allowed to call this tool (nearest allowedParentRoles above). */
  parents: readonly string[]
  /** The chain in fallback order. */
  routes: readonly RoleRoute[]
  /** Line index of the first route line. */
  routeStart: number
  /** Line index one past the last route line. */
  routeEnd: number
  /** Indent of `- provider:` lines when rewriting. */
  routeIndent: number
  /** Indent of `model:` lines when rewriting. */
  modelIndent: number
}

/** Parse result: the original lines plus every discovered role block. */
export interface ParsedRoles {
  /** The preset text split into lines (rewrite happens by splice). */
  lines: string[]
  /** Every subagent role block discovered, in file order. */
  blocks: readonly RoleBlock[]
}

/** One model entry from settings.yaml, for the add-route picker. */
export interface AvailableModel {
  /** Provider id (settings.yaml provider key). */
  provider: string
  /** Model id. */
  model: string
  /** `provider/model` key matching RoleRoute.key. */
  key: string
  /** Display name (falls back to the model id). */
  name: string
  /** Provider display name (falls back to the provider id). */
  providerName: string
}

const TOOL_PREFIX = 'subagent_'
const ROUTE_LINE = /^(\s*)- provider: ([^\s#]+)\s*$/
const MODEL_LINE = /^(\s*)model: ([^\s#]+)\s*$/
const ROLE_LINE = /^(\s*)role: ([^\s#]+)\s*$/
const TOOL_LINE = /^(\s*)toolName: ([^\s#]+)\s*$/
const PARENT_LINE = /^(\s*)allowedParentRoles:\s*\[([^\]]*)\]/

/**
 * Parse the preset text into role blocks by line scanning. The dialect is
 * line-stable: each `subagent_*` tool carries a `modelFallback` with a
 * `role:` line followed by a `routes:` list of `- provider:` / `model:`
 * pairs. Throws on structural violations (missing routes block, bad indent,
 * a route without a model).
 * @param text - preset file text.
 * @returns the lines plus discovered blocks.
 */
export function parseRoleBlocks(text: string): ParsedRoles {
  const lines = text.split('\n')
  const blocks: RoleBlock[] = []
  let toolName: string | null = null
  let currentParents: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const parentMatch = PARENT_LINE.exec(lines[index])
    if (parentMatch !== null) {
      currentParents = parentMatch[2].split(',').map(s => s.trim()).filter(Boolean)
    }
    const toolMatch = TOOL_LINE.exec(lines[index])
    if (toolMatch !== null) {
      toolName = toolMatch[2]
    }
    const roleMatch = ROLE_LINE.exec(lines[index])
    if (roleMatch === null || toolName === null || !toolName.startsWith(TOOL_PREFIX)) continue

    const roleIndent = roleMatch[1].length
    let routesHeader = index + 1
    while (routesHeader < lines.length && !/^\s*routes:\s*$/.test(lines[routesHeader])) {
      routesHeader += 1
    }
    if (routesHeader >= lines.length) {
      throw new Error(`role ${roleMatch[2]} has no routes block`)
    }
    const routesIndent = lines[routesHeader].search(/\S/)
    if (routesIndent < roleIndent) {
      throw new Error(`role ${roleMatch[2]} has malformed routes indentation`)
    }
    const routeStart = routesHeader + 1
    let routeEnd = routeStart
    const routes: RoleRoute[] = []
    while (routeEnd < lines.length) {
      const line = lines[routeEnd]
      if (line.trim() === '') break
      const indent = line.search(/\S/)
      if (indent <= routesIndent) break
      const providerMatch = ROUTE_LINE.exec(line)
      if (providerMatch === null) {
        routeEnd += 1
        continue
      }
      const modelLine = lines[routeEnd + 1] ?? ''
      const modelMatch = MODEL_LINE.exec(modelLine)
      if (modelMatch === null) {
        throw new Error(`role ${roleMatch[2]} route ${routes.length + 1} has no model`)
      }
      routes.push({
        provider: providerMatch[2],
        model: modelMatch[2],
        key: `${providerMatch[2]}/${modelMatch[2]}`,
      })
      routeEnd += 2
    }
    blocks.push({
      role: roleMatch[2],
      toolName,
      parents: [...currentParents],
      routes,
      routeStart,
      routeEnd,
      routeIndent: routesIndent + 2,
      modelIndent: routesIndent + 4,
    })
  }
  return { lines, blocks }
}

/**
 * Validate the block set: at least one role, unique role names, no empty
 * chain, no duplicate route inside one chain. Throws on the first violation.
 * @param blocks - parsed blocks to validate.
 */
export function validateBlocks(blocks: readonly RoleBlock[]): void {
  if (blocks.length === 0) throw new Error('no explicit subagent role chains found')
  const roles = new Set<string>()
  for (const block of blocks) {
    if (roles.has(block.role)) throw new Error(`duplicate role: ${block.role}`)
    roles.add(block.role)
    if (block.routes.length === 0) throw new Error(`role ${block.role} has an empty chain`)
    const keys = block.routes.map(r => `${r.provider}/${r.model}`)
    if (new Set(keys).size !== keys.length) throw new Error(`role ${block.role} contains duplicate routes`)
  }
}

/**
 * Rewrite one role's routes list inside the preset text. Only the target
 * block's route lines are replaced; the rewrite is re-parsed and re-validated
 * before returning, so a malformed result never reaches the caller.
 * @param text - preset file text.
 * @param role - role name to rewrite.
 * @param routes - the new chain in fallback order (non-empty, no duplicates).
 * @returns the updated preset text.
 */
export function replaceRoutes(text: string, role: string, routes: readonly { provider: string; model: string }[]): string {
  const parsed = parseRoleBlocks(text)
  validateBlocks(parsed.blocks)
  const block = parsed.blocks.find(b => b.role === role)
  if (block === undefined) throw new Error(`unknown role ${role}`)
  if (routes.length === 0) throw new Error('a role chain cannot be empty')
  const keys = routes.map(r => `${r.provider}/${r.model}`)
  if (new Set(keys).size !== keys.length) throw new Error('a role chain cannot contain duplicate routes')

  const replacement = routes.flatMap(route => [
    `${' '.repeat(block.routeIndent)}- provider: ${route.provider}`,
    `${' '.repeat(block.modelIndent)}model: ${route.model}`,
  ])
  parsed.lines.splice(block.routeStart, block.routeEnd - block.routeStart, ...replacement)
  const updated = parsed.lines.join('\n')
  validateBlocks(parseRoleBlocks(updated).blocks)
  return updated
}

/**
 * Read every role block from a preset file, validating the whole set.
 * @param presetPath - absolute path of the preset's agent.cordis.yml.
 * @returns role blocks in file order.
 */
export function readRoles(presetPath: string): readonly RoleBlock[] {
  const parsed = parseRoleBlocks(readFileSync(presetPath, 'utf8'))
  validateBlocks(parsed.blocks)
  return parsed.blocks
}

/**
 * List the models the add-route picker may offer: every model entry of every
 * provider in settings.yaml. An unreadable or malformed file yields an empty
 * list (the matrix stays usable for reorder/remove).
 * @param settingsPath - absolute path of settings.yaml.
 * @returns provider/model entries in file order.
 */
export function readAvailableModels(settingsPath: string): AvailableModel[] {
  try {
    const doc = parseDocument(readFileSync(settingsPath, 'utf8'), { version: '1.2' })
    const root = doc.toJS() as Record<string, unknown>
    const providers = (root['llm-pi-ai'] as { providers?: Record<string, {
      displayName?: string
      models?: { id: string; name?: string }[]
    }> } | undefined)?.providers ?? {}
    const models: AvailableModel[] = []
    for (const [providerId, providerData] of Object.entries(providers)) {
      const providerName = providerData.displayName ?? providerId
      for (const entry of providerData.models ?? []) {
        models.push({
          provider: providerId,
          model: entry.id,
          key: `${providerId}/${entry.id}`,
          name: entry.name ?? entry.id,
          providerName,
        })
      }
    }
    return models
  } catch {
    return []
  }
}
