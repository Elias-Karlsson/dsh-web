/**
 * roles-file specs: the preset line surgery must parse the model-roles
 * dialect, rewrite only the target routes block, and reject malformed input
 * before any text reaches disk.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRoleBlocks, readAvailableModels, readRoles, replaceRoutes, validateBlocks } from '../src/roles-file.ts'

/** Minimal preset fixture: two subagent roles plus a non-subagent role line. */
const PRESET = `# a comment that must survive
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      role: this-is-prose-not-a-block
- id: subagent-tools
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
          codes: [QUOTA, RATE_LIMIT]
        toolName: subagent_deep
        allowedParentRoles: [main]
        modelFallback:
          role: deep
          routes:
            - provider: codex
              model: gpt-5.6-sol
          codes: [QUOTA]
        toolName: some_other_tool
        modelFallback:
          role: not-a-subagent
          routes:
            - provider: x
              model: y
`

describe('parseRoleBlocks', () => {
  it('discovers subagent role blocks and skips non-subagent role lines', () => {
    const { blocks } = parseRoleBlocks(PRESET)
    expect(blocks.map(b => b.role)).toEqual(['fast', 'deep'])
    expect(blocks[0].toolName).toBe('subagent_fast')
    expect(blocks[0].parents).toEqual(['main'])
    expect(blocks[0].routes.map(r => r.key)).toEqual(['codex/gpt-5.6-luna', 'kimi/kimi-k2.7-code'])
    expect(blocks[1].routes.map(r => r.key)).toEqual(['codex/gpt-5.6-sol'])
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
  })
})
