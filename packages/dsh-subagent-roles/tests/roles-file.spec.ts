/**
 * roles-file specs: the preset line surgery must parse the model-roles
 * dialect, rewrite only the targeted lines, and reject malformed input
 * before any text reaches disk.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addRole,
  deleteRole,
  parseRoleBlocks,
  readAvailableModels,
  readRoles,
  replaceFilters,
  replaceParents,
  replacePersona,
  replaceRoutes,
  validateBlocks,
} from '../src/roles-file.ts'

/** Fixture head: a comment, the persona prose trap, and the group opening. */
const HEAD = `# a comment that must survive
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      role: this-is-prose-not-a-block
- id: subagent-tools
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
`

/** Role A: its allow/systemSections lists reference role B's toolName. */
const FAST_BLOCK = `    - id: tool-subagent-fast
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_fast
        backgroundMode: one-shot
        allowedParentRoles: [main, deep]
        maxDepth: 2
        persona: |-
          You are Fast, a bounded execution worker.
          Return Result, Evidence, and Next action.
        toolFilter:
          allow: [read, glob, subagent_deep]
        contextFilter:
          systemSections: [harness:identity, tool:read, tool:subagent_deep]
          runtimeContexts: [sandbox:policy, subagent:delegation]
          denyMessageSourceKinds: [agent-instructions]
        modelFallback:
          role: fast
          routes:
            - provider: codex
              model: gpt-5.6-luna
            - provider: kimi
              model: kimi-k2.7-code
          codes: [QUOTA, RATE_LIMIT]
`

/** Role B: role A is its spawn parent. */
const DEEP_BLOCK = `    - id: tool-subagent-deep
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_deep
        backgroundMode: one-shot
        allowedParentRoles: [fast]
        maxDepth: 2
        persona: |-
          You are Deep, the worker for difficult implementation.
        toolFilter:
          allow: [read, write, bash]
        contextFilter:
          systemSections: [harness:identity, tool:write, tool:bash]
          runtimeContexts: []
          denyMessageSourceKinds: [skill-catalog]
        modelFallback:
          role: deep
          routes:
            - provider: codex
              model: gpt-5.6-sol
          codes: [QUOTA]
`

/** Tail: a non-subagent tool row that must never parse as a role block. */
const TAIL = `    - id: tool-other
      name: '@deepseek-ai/dsh-tool-other'
      config:
        toolName: some_other_tool
        modelFallback:
          role: not-a-subagent
          routes:
            - provider: x
              model: y
`

/** Full preset fixture: two real role blocks plus both traps. */
const PRESET = HEAD + FAST_BLOCK + '\n' + DEEP_BLOCK + '\n' + TAIL

describe('parseRoleBlocks', () => {
  it('discovers subagent role blocks and skips non-subagent role lines', () => {
    const { blocks } = parseRoleBlocks(PRESET)
    expect(blocks.map(b => b.role)).toEqual(['fast', 'deep'])
    expect(blocks[0].toolName).toBe('subagent_fast')
    expect(blocks[0].parents).toEqual(['main', 'deep'])
    expect(blocks[0].routes.map(r => r.key)).toEqual(['codex/gpt-5.6-luna', 'kimi/kimi-k2.7-code'])
    expect(blocks[1].routes.map(r => r.key)).toEqual(['codex/gpt-5.6-sol'])
  })

  it('parses persona, toolAllow, and contextFilter of every block', () => {
    const { blocks } = parseRoleBlocks(PRESET)
    expect(blocks[0].persona).toBe('You are Fast, a bounded execution worker.\nReturn Result, Evidence, and Next action.')
    expect(blocks[0].toolAllow).toEqual(['read', 'glob', 'subagent_deep'])
    expect(blocks[0].contextFilter).toEqual({
      systemSections: ['harness:identity', 'tool:read', 'tool:subagent_deep'],
      runtimeContexts: ['sandbox:policy', 'subagent:delegation'],
      denyMessageSourceKinds: ['agent-instructions'],
    })
    expect(blocks[1].persona).toBe('You are Deep, the worker for difficult implementation.')
    expect(blocks[1].contextFilter.runtimeContexts).toEqual([])
  })

  it('captures the scalar fields addRole clones and the row spans', () => {
    const { blocks } = parseRoleBlocks(PRESET)
    expect(blocks[0].backgroundMode).toBe('one-shot')
    expect(blocks[0].maxDepth).toBe('2')
    expect(blocks[0].codes).toEqual(['QUOTA', 'RATE_LIMIT'])
    expect(blocks[1].codes).toEqual(['QUOTA'])
    expect(PRESET.split('\n')[blocks[0].rowStart]).toBe('    - id: tool-subagent-fast')
    expect(PRESET.split('\n')[blocks[1].rowStart]).toBe('    - id: tool-subagent-deep')
  })

  it('throws when a subagent role has no routes block', () => {
    const broken = `        toolName: subagent_lone
        modelFallback:
          role: lone
          codes: [QUOTA]
`
    expect(() => parseRoleBlocks(broken)).toThrow('role lone has no routes block')
  })
})

describe('validateBlocks', () => {
  it('rejects an empty block set, duplicate roles, empty chains, and duplicate routes', () => {
    expect(() => validateBlocks([])).toThrow('no explicit subagent role chains found')
    const { blocks } = parseRoleBlocks(PRESET)
    expect(() => validateBlocks([...blocks, { ...blocks[0] }])).toThrow('duplicate role: fast')
    expect(() => validateBlocks([{ ...blocks[0], routes: [] }])).toThrow('role fast has an empty chain')
    expect(() => validateBlocks([{ ...blocks[0], routes: [blocks[0].routes[0], blocks[0].routes[0]] }])).toThrow('duplicate routes')
  })
})

describe('replaceRoutes', () => {
  it('rewrites only the target routes block and keeps every other line', () => {
    const updated = replaceRoutes(PRESET, 'fast', [
      { provider: 'kimi', model: 'kimi-k2.7-code' },
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
    ])
    expect(readRolesText(updated, 'fast')).toEqual(['kimi/kimi-k2.7-code', 'deepseek/deepseek-v4-flash'])
    expect(readRolesText(updated, 'deep')).toEqual(['codex/gpt-5.6-sol'])
    // The comment, the prose "role:" line, and the codes lines survive byte for byte.
    expect(updated).toContain('# a comment that must survive')
    expect(updated).toContain('role: this-is-prose-not-a-block')
    expect(updated).toContain('codes: [QUOTA, RATE_LIMIT]')
    expect(updated).toContain(DEEP_BLOCK)
  })

  it('round-trips back to the original text', () => {
    const swapped = replaceRoutes(PRESET, 'fast', [
      { provider: 'kimi', model: 'kimi-k2.7-code' },
      { provider: 'codex', model: 'gpt-5.6-luna' },
    ])
    const restored = replaceRoutes(swapped, 'fast', [
      { provider: 'codex', model: 'gpt-5.6-luna' },
      { provider: 'kimi', model: 'kimi-k2.7-code' },
    ])
    expect(restored).toBe(PRESET)
  })

  it('rejects unknown roles, empty chains, and duplicate routes', () => {
    expect(() => replaceRoutes(PRESET, 'nope', [{ provider: 'a', model: 'b' }])).toThrow('unknown role nope')
    expect(() => replaceRoutes(PRESET, 'fast', [])).toThrow('a role chain cannot be empty')
    expect(() => replaceRoutes(PRESET, 'fast', [
      { provider: 'a', model: 'b' },
      { provider: 'a', model: 'b' },
    ])).toThrow('duplicate routes')
  })
})

describe('replaceParents', () => {
  it('rewrites only the allowedParentRoles line', () => {
    const updated = replaceParents(PRESET, 'fast', ['main'])
    expect(updated).toBe(PRESET.replace('allowedParentRoles: [main, deep]', 'allowedParentRoles: [main]'))
    expect(parseRoleBlocks(updated).blocks[0].parents).toEqual(['main'])
  })

  it('writes an empty inline list for no parents', () => {
    const updated = replaceParents(PRESET, 'fast', [])
    expect(updated).toBe(PRESET.replace('allowedParentRoles: [main, deep]', 'allowedParentRoles: []'))
    expect(parseRoleBlocks(updated).blocks[0].parents).toEqual([])
  })

  it('rejects unknown roles and corrupt tokens', () => {
    expect(() => replaceParents(PRESET, 'nope', ['main'])).toThrow('unknown role nope')
    expect(() => replaceParents(PRESET, 'fast', ['bad token'])).toThrow('invalid parent token')
  })
})

describe('replacePersona', () => {
  it('rewrites a multi-line persona and keeps the following keys byte for byte', () => {
    const updated = replacePersona(PRESET, 'fast', 'Line one.\n\nLine three.')
    expect(parseRoleBlocks(updated).blocks[0].persona).toBe('Line one.\n\nLine three.')
    const prefix = PRESET.slice(0, PRESET.indexOf('          You are Fast'))
    const suffix = PRESET.slice(PRESET.indexOf('        toolFilter:'))
    expect(updated.startsWith(prefix)).toBe(true)
    expect(updated.endsWith(suffix)).toBe(true)
  })

  it('rejects an empty persona and unknown roles', () => {
    expect(() => replacePersona(PRESET, 'fast', '   ')).toThrow('persona cannot be empty')
    expect(() => replacePersona(PRESET, 'nope', 'text')).toThrow('unknown role nope')
  })
})

describe('replaceFilters', () => {
  it('rewrites a subset of lists and leaves the rest untouched', () => {
    const updated = replaceFilters(PRESET, 'fast', { toolAllow: ['read'] })
    expect(updated).toBe(PRESET.replace('allow: [read, glob, subagent_deep]', 'allow: [read]'))
  })

  it('writes an empty inline list and rewrites several lists at once', () => {
    const updated = replaceFilters(PRESET, 'deep', { systemSections: ['harness:identity'], denyMessageSourceKinds: [] })
    expect(updated).toBe(PRESET
      .replace('systemSections: [harness:identity, tool:write, tool:bash]', 'systemSections: [harness:identity]')
      .replace('denyMessageSourceKinds: [skill-catalog]', 'denyMessageSourceKinds: []'))
  })

  it('rejects unknown roles and corrupt tokens', () => {
    expect(() => replaceFilters(PRESET, 'nope', { toolAllow: ['read'] })).toThrow('unknown role nope')
    expect(() => replaceFilters(PRESET, 'fast', { toolAllow: ['a,b'] })).toThrow('invalid toolAllow token')
  })
})

describe('addRole', () => {
  it('appends a block after the last tool-subagent row, cloning the template fields', () => {
    const updated = addRole(PRESET, {
      role: 'code-scout',
      persona: 'You are Scout.\nReturn evidence.',
      templateRole: 'fast',
      route: { provider: 'kimi', model: 'kimi-k2.7' },
    })
    const { blocks } = parseRoleBlocks(updated)
    expect(blocks.map(b => b.role)).toEqual(['fast', 'deep', 'code-scout'])
    const scout = blocks[2]
    expect(scout.toolName).toBe('subagent_code_scout')
    expect(scout.parents).toEqual([])
    expect(scout.routes.map(r => r.key)).toEqual(['kimi/kimi-k2.7'])
    expect(scout.persona).toBe('You are Scout.\nReturn evidence.')
    expect(scout.backgroundMode).toBe('one-shot')
    expect(scout.maxDepth).toBe('2')
    expect(scout.toolAllow).toEqual(['read', 'glob', 'subagent_deep'])
    expect(scout.contextFilter).toEqual({
      systemSections: ['harness:identity', 'tool:read', 'tool:subagent_deep'],
      runtimeContexts: ['sandbox:policy', 'subagent:delegation'],
      denyMessageSourceKinds: ['agent-instructions'],
    })
    expect(scout.codes).toEqual(['QUOTA', 'RATE_LIMIT'])
    // Existing text survives byte for byte; the new row lands before tool-other.
    expect(updated).toContain(FAST_BLOCK)
    expect(updated).toContain(DEEP_BLOCK)
    expect(updated).toContain('allowedParentRoles: []')
    expect(updated.indexOf('- id: tool-subagent-code-scout')).toBeGreaterThan(updated.indexOf('- id: tool-subagent-deep'))
    expect(updated.indexOf('- id: tool-subagent-code-scout')).toBeLessThan(updated.indexOf('- id: tool-other'))
  })

  it('rejects a duplicate role, an invalid name, an unknown template, and an empty persona', () => {
    const base = { role: 'scout', persona: 'text', templateRole: 'fast', route: { provider: 'a', model: 'b' } }
    expect(() => addRole(PRESET, { ...base, role: 'fast' })).toThrow('duplicate role: fast')
    expect(() => addRole(PRESET, { ...base, role: 'Bad name' })).toThrow('invalid role name')
    expect(() => addRole(PRESET, { ...base, templateRole: 'ghost' })).toThrow('unknown template role: ghost')
    expect(() => addRole(PRESET, { ...base, persona: ' ' })).toThrow('persona cannot be empty')
  })
})

describe('deleteRole', () => {
  it('removes the block and strips every reference, byte-identical elsewhere', () => {
    const fastStripped = FAST_BLOCK
      .replace('allowedParentRoles: [main, deep]', 'allowedParentRoles: [main]')
      .replace('allow: [read, glob, subagent_deep]', 'allow: [read, glob]')
      .replace('systemSections: [harness:identity, tool:read, tool:subagent_deep]', 'systemSections: [harness:identity, tool:read]')
    expect(deleteRole(PRESET, 'deep')).toBe(HEAD + fastStripped + '\n' + TAIL)
    expect(parseRoleBlocks(deleteRole(PRESET, 'deep')).blocks.map(b => b.role)).toEqual(['fast'])
  })

  it('rejects an unknown role', () => {
    expect(() => deleteRole(PRESET, 'nope')).toThrow('unknown role nope')
  })
})

/** Read one role's route keys from preset text (spec-local helper). */
function readRolesText(text: string, role: string): string[] {
  const { blocks } = parseRoleBlocks(text)
  const block = blocks.find(b => b.role === role)
  if (block === undefined) throw new Error('role missing: ' + role)
  return block.routes.map(r => r.key)
}

describe('readRoles', () => {
  it('reads blocks from a file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'roles-file-'))
    try {
      const presetPath = join(dir, 'agent.cordis.yml')
      writeFileSync(presetPath, PRESET)
      expect(readRoles(presetPath).map(b => b.role)).toEqual(['fast', 'deep'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readAvailableModels', () => {
  const SETTINGS = `llm-pi-ai:
  providers:
    codex:
      displayName: Codex
      models:
        - id: gpt-5.6-luna
          name: Luna
        - id: gpt-5.6-sol
    kimi:
      models:
        - id: kimi-k2.7-code
`

  it('lists every provider model with display names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'roles-models-'))
    try {
      const settingsPath = join(dir, 'settings.yaml')
      writeFileSync(settingsPath, SETTINGS)
      expect(readAvailableModels(settingsPath)).toEqual([
        { provider: 'codex', model: 'gpt-5.6-luna', key: 'codex/gpt-5.6-luna', name: 'Luna', providerName: 'Codex' },
        { provider: 'codex', model: 'gpt-5.6-sol', key: 'codex/gpt-5.6-sol', name: 'gpt-5.6-sol', providerName: 'Codex' },
        { provider: 'kimi', model: 'kimi-k2.7-code', key: 'kimi/kimi-k2.7-code', name: 'kimi-k2.7-code', providerName: 'kimi' },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('yields an empty list for a missing file', () => {
    expect(readAvailableModels(join(tmpdir(), 'no-such-settings.yaml'))).toEqual([])
  })

  it('reads the real deployment files without throwing', () => {
    // Guards the port against dialect drift in the live preset/settings.
    const preset = readFileSync('/Users/eliaskarlsson/.dsh/.agent-presets/model-roles/agent.cordis.yml', 'utf8')
    const { blocks } = parseRoleBlocks(preset)
    validateBlocks(blocks)
    expect(blocks.length).toBeGreaterThan(10)
    expect(blocks[0].persona).toContain('You are Fast')
    expect(blocks[0].toolAllow.length).toBeGreaterThan(0)
  })
})
