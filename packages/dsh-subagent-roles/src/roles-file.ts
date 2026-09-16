/**
 * Preset role-chain file surgery: parse, validate, and rewrite the role
 * blocks of a subagent-role preset (the model-roles dialect of
 * agent.cordis.yml) without touching any other line. Only the targeted
 * lines are rewritten — comments, other rows, and every untouched field
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

/** The three contextFilter token lists of a role block. */
export interface RoleContextFilter {
  /** systemSection ids kept for the subagent. */
  systemSections: readonly string[]
  /** runtime context ids kept for the subagent. */
  runtimeContexts: readonly string[]
  /** message source kinds denied to the subagent. */
  denyMessageSourceKinds: readonly string[]
}

/** One parsed role block: identity, editable fields, and surgery line spans. */
export interface RoleBlock {
  /** Role name (`role:` line inside the tool's modelFallback). */
  role: string
  /** Owning subagent tool (`toolName:` line, e.g. `subagent_fast`). */
  toolName: string
  /** Parent roles allowed to call this tool (nearest allowedParentRoles above). */
  parents: readonly string[]
  /** The chain in fallback order. */
  routes: readonly RoleRoute[]
  /** Persona literal-block text (empty when the block has none). */
  persona: string
  /** toolFilter.allow tokens (empty when absent). */
  toolAllow: readonly string[]
  /** contextFilter token lists (empty lists when absent). */
  contextFilter: RoleContextFilter
  /** backgroundMode value cloned by addRole (absent when the block omits it). */
  backgroundMode: string | undefined
  /** maxDepth value cloned by addRole (absent when the block omits it). */
  maxDepth: string | undefined
  /** modelFallback codes list cloned by addRole (empty when absent). */
  codes: readonly string[]
  /** Line index of the first route line. */
  routeStart: number
  /** Line index one past the last route line. */
  routeEnd: number
  /** Indent of `- provider:` lines when rewriting. */
  routeIndent: number
  /** Indent of `model:` lines when rewriting. */
  modelIndent: number
  /** Line index of the owning `- id:` plugin row (-1 outside the row dialect). */
  rowStart: number
  /** Indent of the owning plugin row. */
  rowIndent: number
  /** Line index one past the block (next row, dedent, or file end). */
  blockEnd: number
  /** Indent of the config keys (`toolName:`, `persona:`, …). */
  keyIndent: number
  /** Line index of the `allowedParentRoles:` line (-1 when absent). */
  parentsLine: number
  /** Line index of the `persona: |-` line (-1 when absent). */
  personaStart: number
  /** Line index one past the persona literal content. */
  personaEnd: number
  /** Indent of persona content lines when rewriting. */
  personaIndent: number
  /** Line index of the `allow:` line (-1 when absent). */
  allowLine: number
  /** Line index of the `systemSections:` line (-1 when absent). */
  systemSectionsLine: number
  /** Line index of the `runtimeContexts:` line (-1 when absent). */
  runtimeContextsLine: number
  /** Line index of the `denyMessageSourceKinds:` line (-1 when absent). */
  denyKindsLine: number
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

/** Specification for a new role block appended by addRole. */
export interface AddRoleSpec {
  /** New role name (`tool-subagent-<role>` row, `subagent_<role>` tool). */
  role: string
  /** Persona literal text (non-empty). */
  persona: string
  /** Existing role whose backgroundMode/maxDepth/filters/codes are cloned. */
  templateRole: string
  /** The single initial route of the new chain. */
  route: { provider: string; model: string }
}

/** Subset of filter lists replaceFilters rewrites; absent keys stay untouched. */
export interface RoleFilterUpdate {
  /** New toolFilter.allow tokens. */
  toolAllow?: readonly string[]
  /** New contextFilter.systemSections tokens. */
  systemSections?: readonly string[]
  /** New contextFilter.runtimeContexts tokens. */
  runtimeContexts?: readonly string[]
  /** New contextFilter.denyMessageSourceKinds tokens. */
  denyMessageSourceKinds?: readonly string[]
}

const TOOL_PREFIX = 'subagent_'
const ROUTE_LINE = /^(\s*)- provider: ([^\s#]+)\s*$/
const MODEL_LINE = /^(\s*)model: ([^\s#]+)\s*$/
const ROLE_LINE = /^(\s*)role: ([^\s#]+)\s*$/
const TOOL_LINE = /^(\s*)toolName: ([^\s#]+)\s*$/
const PARENT_LINE = /^(\s*)allowedParentRoles:\s*\[([^\]]*)\]/
const ROW_LINE = /^(\s*)- id: ([^\s#]+)\s*$/
const PERSONA_LINE = /^(\s*)persona: \|-\s*$/
const ALLOW_LINE = /^(\s*)allow:\s*\[([^\]]*)\]/
const SYSTEM_SECTIONS_LINE = /^(\s*)systemSections:\s*\[([^\]]*)\]/
const RUNTIME_CONTEXTS_LINE = /^(\s*)runtimeContexts:\s*\[([^\]]*)\]/
const DENY_KINDS_LINE = /^(\s*)denyMessageSourceKinds:\s*\[([^\]]*)\]/
const BACKGROUND_MODE_LINE = /^\s*backgroundMode:\s*(\S+)\s*$/
const MAX_DEPTH_LINE = /^\s*maxDepth:\s*(\S+)\s*$/
const CODES_LINE = /^\s*codes:\s*\[([^\]]*)\]/

/** Split one inline flow-list capture into tokens. */
function flowTokens(capture: string): string[] {
  return capture.split(',').map(s => s.trim()).filter(Boolean)
}

/** Render one inline flow list at the given indent (`key: []` when empty). */
function flowListLine(indent: number, key: string, tokens: readonly string[]): string {
  return `${' '.repeat(indent)}${key}: [${tokens.join(', ')}]`
}

/** Reject tokens that would corrupt an inline flow list or a route line. */
function assertTokens(tokens: readonly string[], field: string): void {
  for (const token of tokens) {
    if (!/^[^\s,[\]#]+$/.test(token)) throw new Error(`invalid ${field} token: ${token}`)
  }
}

/**
 * One past the last line of the plugin row starting at `start`: the first
 * following non-blank line at the row indent or less, or the file end. A
 * trailing newline artifact is never consumed.
 */
function rowSpanEnd(lines: readonly string[], start: number, rowIndent: number): number {
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() !== '' && line.search(/\S/) <= rowIndent) break
    end += 1
  }
  if (end === lines.length && lines[lines.length - 1] === '') end -= 1
  return end
}

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
  let keyIndent = 0
  let currentParents: string[] = []
  let parentsLine = -1
  let rowStart = -1
  let rowIndent = 0
  let persona = ''
  let personaStart = -1
  let personaEnd = -1
  let personaIndent = 0
  let toolAllow: string[] = []
  let allowLine = -1
  let systemSections: string[] = []
  let systemSectionsLine = -1
  let runtimeContexts: string[] = []
  let runtimeContextsLine = -1
  let denyKinds: string[] = []
  let denyKindsLine = -1

  for (let index = 0; index < lines.length; index += 1) {
    const rowMatch = ROW_LINE.exec(lines[index])
    if (rowMatch !== null) {
      rowStart = index
      rowIndent = rowMatch[1].length
    }
    const toolMatch = TOOL_LINE.exec(lines[index])
    if (toolMatch !== null) {
      // A new tool row starts: field state captured so far belongs to the
      // previous tool and must not bleed into this one.
      toolName = toolMatch[2]
      keyIndent = toolMatch[1].length
      currentParents = []
      parentsLine = -1
      persona = ''
      personaStart = -1
      personaEnd = -1
      personaIndent = 0
      toolAllow = []
      allowLine = -1
      systemSections = []
      systemSectionsLine = -1
      runtimeContexts = []
      runtimeContextsLine = -1
      denyKinds = []
      denyKindsLine = -1
    }
    const parentMatch = PARENT_LINE.exec(lines[index])
    if (parentMatch !== null) {
      currentParents = flowTokens(parentMatch[2])
      parentsLine = index
    }
    const personaMatch = PERSONA_LINE.exec(lines[index])
    if (personaMatch !== null) {
      const personaKeyIndent = personaMatch[1].length
      let end = index + 1
      let contentIndent = -1
      while (end < lines.length) {
        const line = lines[end]
        if (line.trim() !== '') {
          const indent = line.search(/\S/)
          if (indent <= personaKeyIndent) break
          if (contentIndent === -1) contentIndent = indent
        }
        end += 1
      }
      const content: string[] = []
      for (let cursor = index + 1; cursor < end; cursor += 1) {
        const line = lines[cursor]
        content.push(contentIndent === -1 || line.trim() === '' ? '' : line.slice(contentIndent))
      }
      while (content.length > 0 && content[content.length - 1] === '') content.pop()
      persona = content.join('\n')
      personaStart = index
      personaEnd = end
      personaIndent = contentIndent === -1 ? personaKeyIndent + 2 : contentIndent
    }
    const allowMatch = ALLOW_LINE.exec(lines[index])
    if (allowMatch !== null) {
      toolAllow = flowTokens(allowMatch[2])
      allowLine = index
    }
    const systemSectionsMatch = SYSTEM_SECTIONS_LINE.exec(lines[index])
    if (systemSectionsMatch !== null) {
      systemSections = flowTokens(systemSectionsMatch[2])
      systemSectionsLine = index
    }
    const runtimeContextsMatch = RUNTIME_CONTEXTS_LINE.exec(lines[index])
    if (runtimeContextsMatch !== null) {
      runtimeContexts = flowTokens(runtimeContextsMatch[2])
      runtimeContextsLine = index
    }
    const denyKindsMatch = DENY_KINDS_LINE.exec(lines[index])
    if (denyKindsMatch !== null) {
      denyKinds = flowTokens(denyKindsMatch[2])
      denyKindsLine = index
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
      persona,
      toolAllow: [...toolAllow],
      contextFilter: {
        systemSections: [...systemSections],
        runtimeContexts: [...runtimeContexts],
        denyMessageSourceKinds: [...denyKinds],
      },
      backgroundMode: undefined,
      maxDepth: undefined,
      codes: [],
      routeStart,
      routeEnd,
      routeIndent: routesIndent + 2,
      modelIndent: routesIndent + 4,
      rowStart,
      rowIndent,
      blockEnd: -1,
      keyIndent,
      parentsLine,
      personaStart,
      personaEnd,
      personaIndent,
      allowLine,
      systemSectionsLine,
      runtimeContextsLine,
      denyKindsLine,
    })
  }

  // Second pass: block spans and the scalar fields addRole clones. The span
  // runs from the plugin row (or the toolName line outside the row dialect)
  // to the next row/dedent, so codes: — which follows routes: — is covered.
  for (const block of blocks) {
    const spanStart = block.rowStart === -1
      ? lines.findIndex(line => TOOL_LINE.exec(line)?.[2] === block.toolName)
      : block.rowStart
    const spanIndent = block.rowStart === -1 ? block.keyIndent : block.rowIndent
    const end = rowSpanEnd(lines, spanStart, spanIndent)
    const mutable = block as { blockEnd: number; backgroundMode: string | undefined; maxDepth: string | undefined; codes: readonly string[] }
    mutable.blockEnd = end
    for (let cursor = spanStart; cursor < end; cursor += 1) {
      const backgroundMode = BACKGROUND_MODE_LINE.exec(lines[cursor])
      if (backgroundMode !== null) mutable.backgroundMode = backgroundMode[1]
      const maxDepth = MAX_DEPTH_LINE.exec(lines[cursor])
      if (maxDepth !== null) mutable.maxDepth = maxDepth[1]
      const codes = CODES_LINE.exec(lines[cursor])
      if (codes !== null) mutable.codes = flowTokens(codes[1])
    }
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

/** Parse + validate, and return the named block or throw. */
function requireBlock(parsed: ParsedRoles, role: string): RoleBlock {
  validateBlocks(parsed.blocks)
  const block = parsed.blocks.find(b => b.role === role)
  if (block === undefined) throw new Error(`unknown role ${role}`)
  return block
}

/** Re-parse and re-validate a rewritten text before it reaches the caller. */
function revalidate(updated: string): ParsedRoles {
  const parsed = parseRoleBlocks(updated)
  validateBlocks(parsed.blocks)
  return parsed
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
  const block = requireBlock(parsed, role)
  if (routes.length === 0) throw new Error('a role chain cannot be empty')
  const keys = routes.map(r => `${r.provider}/${r.model}`)
  if (new Set(keys).size !== keys.length) throw new Error('a role chain cannot contain duplicate routes')

  const replacement = routes.flatMap(route => [
    `${' '.repeat(block.routeIndent)}- provider: ${route.provider}`,
    `${' '.repeat(block.modelIndent)}model: ${route.model}`,
  ])
  parsed.lines.splice(block.routeStart, block.routeEnd - block.routeStart, ...replacement)
  const updated = parsed.lines.join('\n')
  revalidate(updated)
  return updated
}

/**
 * Rewrite one role's `allowedParentRoles:` inline list. An empty parent list
 * writes `allowedParentRoles: []` — the role can then be spawned by no one.
 * @param text - preset file text.
 * @param role - role name to rewrite.
 * @param parents - the new parent list (may be empty).
 * @returns the updated preset text.
 */
export function replaceParents(text: string, role: string, parents: readonly string[]): string {
  const parsed = parseRoleBlocks(text)
  const block = requireBlock(parsed, role)
  assertTokens(parents, 'parent')
  if (block.parentsLine === -1) throw new Error(`role ${role} has no allowedParentRoles line`)
  const indent = parsed.lines[block.parentsLine].search(/\S/)
  parsed.lines.splice(block.parentsLine, 1, flowListLine(indent, 'allowedParentRoles', parents))
  const updated = parsed.lines.join('\n')
  const reparsed = revalidate(updated)
  const rewritten = reparsed.blocks.find(b => b.role === role)
  if (rewritten === undefined || rewritten.parents.join('') !== parents.join('')) {
    throw new Error(`role ${role} parents did not round-trip`)
  }
  return updated
}

/**
 * Rewrite one role's persona literal block. The `persona: |-` key line is
 * kept; the content lines are replaced at the block's original indent, so
 * every following key survives byte for byte. Throws on an empty persona.
 * @param text - preset file text.
 * @param role - role name to rewrite.
 * @param persona - the new persona text (newlines become content lines).
 * @returns the updated preset text.
 */
export function replacePersona(text: string, role: string, persona: string): string {
  const parsed = parseRoleBlocks(text)
  const block = requireBlock(parsed, role)
  if (persona.trim() === '') throw new Error(`role ${role} persona cannot be empty`)
  if (block.personaStart === -1) throw new Error(`role ${role} has no persona block`)
  const content = persona.split('\n').map(line => line === '' ? '' : ' '.repeat(block.personaIndent) + line)
  parsed.lines.splice(block.personaStart + 1, block.personaEnd - block.personaStart - 1, ...content)
  const updated = parsed.lines.join('\n')
  const reparsed = revalidate(updated)
  const rewritten = reparsed.blocks.find(b => b.role === role)
  if (rewritten === undefined || rewritten.persona !== persona) {
    throw new Error(`role ${role} persona did not round-trip`)
  }
  return updated
}

/**
 * Rewrite a subset of one role's filter lists (`toolFilter.allow` and the
 * three `contextFilter` lists). Absent keys in `filters` stay untouched; an
 * empty array writes an empty inline list. Single-line rewrites only.
 * @param text - preset file text.
 * @param role - role name to rewrite.
 * @param filters - the filter lists to replace.
 * @returns the updated preset text.
 */
export function replaceFilters(text: string, role: string, filters: RoleFilterUpdate): string {
  const parsed = parseRoleBlocks(text)
  const block = requireBlock(parsed, role)
  const targets: { tokens: readonly string[]; line: number; key: string; field: string }[] = []
  if (filters.toolAllow !== undefined) targets.push({ tokens: filters.toolAllow, line: block.allowLine, key: 'allow', field: 'toolAllow' })
  if (filters.systemSections !== undefined) targets.push({ tokens: filters.systemSections, line: block.systemSectionsLine, key: 'systemSections', field: 'systemSections' })
  if (filters.runtimeContexts !== undefined) targets.push({ tokens: filters.runtimeContexts, line: block.runtimeContextsLine, key: 'runtimeContexts', field: 'runtimeContexts' })
  if (filters.denyMessageSourceKinds !== undefined) targets.push({ tokens: filters.denyMessageSourceKinds, line: block.denyKindsLine, key: 'denyMessageSourceKinds', field: 'denyMessageSourceKinds' })
  for (const target of targets) {
    assertTokens(target.tokens, target.field)
    if (target.line === -1) throw new Error(`role ${role} has no ${target.key} line`)
    const indent = parsed.lines[target.line].search(/\S/)
    parsed.lines.splice(target.line, 1, flowListLine(indent, target.key, target.tokens))
  }
  const updated = parsed.lines.join('\n')
  revalidate(updated)
  return updated
}

/**
 * Append a new role block after the last `tool-subagent-*` plugin row. The
 * block clones backgroundMode, maxDepth, toolFilter, contextFilter, and the
 * modelFallback codes from the template role (the file's first role when no
 * template is named), starts with `allowedParentRoles: []`, and carries a
 * single-route chain. Throws on an invalid or duplicate role name, an
 * unknown template, or an empty persona.
 * @param text - preset file text.
 * @param spec - the new role's identity, persona, template, and first route.
 * @returns the updated preset text.
 */
export function addRole(text: string, spec: AddRoleSpec): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(spec.role)) throw new Error(`invalid role name: ${spec.role}`)
  if (spec.persona.trim() === '') throw new Error('persona cannot be empty')
  assertTokens([spec.route.provider, spec.route.model], 'route')
  const parsed = parseRoleBlocks(text)
  validateBlocks(parsed.blocks)
  if (parsed.blocks.some(b => b.role === spec.role)) throw new Error(`duplicate role: ${spec.role}`)
  const template = spec.templateRole === ''
    ? parsed.blocks[0]
    : parsed.blocks.find(b => b.role === spec.templateRole)
  if (template === undefined) throw new Error(`unknown template role: ${spec.templateRole}`)

  let insertRow = -1
  let insertIndent = 0
  for (let index = 0; index < parsed.lines.length; index += 1) {
    const rowMatch = ROW_LINE.exec(parsed.lines[index])
    if (rowMatch !== null && rowMatch[2].startsWith('tool-subagent-')) {
      insertRow = index
      insertIndent = rowMatch[1].length
    }
  }
  if (insertRow === -1) throw new Error('no tool-subagent plugin row found')
  const end = rowSpanEnd(parsed.lines, insertRow, insertIndent)

  const rowPad = ' '.repeat(insertIndent)
  const keyPad = ' '.repeat(template.keyIndent)
  const subPad = ' '.repeat(template.keyIndent + 2)
  const block: string[] = [
    `${rowPad}- id: tool-subagent-${spec.role}`,
    `${rowPad}  name: '@deepseek-ai/dsh-tool-subagent'`,
    `${rowPad}  config:`,
    `${keyPad}provider: spawn`,
    `${keyPad}toolName: ${TOOL_PREFIX}${spec.role.replaceAll('-', '_')}`,
  ]
  if (template.backgroundMode !== undefined) block.push(`${keyPad}backgroundMode: ${template.backgroundMode}`)
  block.push(`${keyPad}allowedParentRoles: []`)
  if (template.maxDepth !== undefined) block.push(`${keyPad}maxDepth: ${template.maxDepth}`)
  block.push(`${keyPad}persona: |-`)
  for (const line of spec.persona.split('\n')) {
    block.push(line === '' ? '' : subPad + line)
  }
  block.push(`${keyPad}toolFilter:`)
  block.push(flowListLine(template.keyIndent + 2, 'allow', template.toolAllow))
  block.push(`${keyPad}contextFilter:`)
  block.push(flowListLine(template.keyIndent + 2, 'systemSections', template.contextFilter.systemSections))
  block.push(flowListLine(template.keyIndent + 2, 'runtimeContexts', template.contextFilter.runtimeContexts))
  block.push(flowListLine(template.keyIndent + 2, 'denyMessageSourceKinds', template.contextFilter.denyMessageSourceKinds))
  block.push(`${keyPad}modelFallback:`)
  block.push(`${subPad}role: ${spec.role}`)
  block.push(`${subPad}routes:`)
  block.push(`${' '.repeat(template.routeIndent)}- provider: ${spec.route.provider}`)
  block.push(`${' '.repeat(template.modelIndent)}model: ${spec.route.model}`)
  if (template.codes.length > 0) block.push(flowListLine(template.keyIndent + 2, 'codes', template.codes))

  if (end < parsed.lines.length && parsed.lines[end].trim() !== '') block.push('')
  if (end > 0 && parsed.lines[end - 1].trim() !== '') block.unshift('')
  parsed.lines.splice(end, 0, ...block)
  const updated = parsed.lines.join('\n')
  const reparsed = revalidate(updated)
  const created = reparsed.blocks.find(b => b.role === spec.role)
  if (created === undefined || created.routes.map(r => r.key).join('') !== `${spec.route.provider}/${spec.route.model}`) {
    throw new Error(`role ${spec.role} did not round-trip`)
  }
  return updated
}

/**
 * Remove one role's whole plugin row, and strip every reference to it: the
 * deleted role's toolName token disappears from every other block's
 * `toolFilter.allow` list, the toolName (bare and `tool:`-prefixed) from
 * every `contextFilter.systemSections` list, and the role name from every
 * other block's `allowedParentRoles` list. Lines outside the removed row and
 * the stripped list lines survive byte for byte. Throws on an unknown role.
 * @param text - preset file text.
 * @param role - role name to delete.
 * @returns the updated preset text.
 */
export function deleteRole(text: string, role: string): string {
  const parsed = parseRoleBlocks(text)
  const block = requireBlock(parsed, role)
  if (block.rowStart === -1 || block.blockEnd === -1) throw new Error(`role ${role} has no plugin row to delete`)

  const strip = (line: number, key: string, tokens: readonly string[], removed: readonly string[]): void => {
    if (line === -1 || !tokens.some(token => removed.includes(token))) return
    const indent = parsed.lines[line].search(/\S/)
    parsed.lines.splice(line, 1, flowListLine(indent, key, tokens.filter(candidate => !removed.includes(candidate))))
  }
  for (const other of parsed.blocks) {
    if (other.role === role) continue
    strip(other.parentsLine, 'allowedParentRoles', other.parents, [role])
    strip(other.allowLine, 'allow', other.toolAllow, [block.toolName])
    strip(other.systemSectionsLine, 'systemSections', other.contextFilter.systemSections, [block.toolName, `tool:${block.toolName}`])
  }
  parsed.lines.splice(block.rowStart, block.blockEnd - block.rowStart)
  const updated = parsed.lines.join('\n')
  revalidate(updated)
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
