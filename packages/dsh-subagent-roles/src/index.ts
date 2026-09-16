/**
 * Host half of the subagent role matrix: mounts loopback-fenced routes that
 * read and rewrite the role chains of one agent preset (default
 * `model-roles`). The browser half (the Settings section) talks to these
 * routes same-origin; no dsh source changes, no second scheduler or service.
 * @module @linxin666/dsh-client-ui-subagent-roles
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import { resolveDshHome } from './dsh-home.ts'
import { mountOnce } from './mount-once.ts'
import { makeRolesRoutes } from './routes.ts'

/** Host-side role matrix config. */
export interface Config {
  /** Preset id under $DSH_HOME/.agent-presets/ whose agent.cordis.yml is edited. */
  presetId?: string
  /** Preset composition filename inside the preset directory. */
  presetFile?: string
  /**
   * Host headers (exact match, case-insensitive, including port) accepted
   * alongside loopback. Access via a tailnet or LAN address must be listed
   * here explicitly; the default is loopback only.
   */
  trustedHosts?: string[]
}

export const Config: z<Config> = z.object({
  presetId: z.string().min(1).default('model-roles'),
  presetFile: z.string().min(1).default('agent.cordis.yml'),
  trustedHosts: z.array(z.string()).default([]),
})

/** Required services before the routes can mount. */
export const inject = ['webServer'] as const

/** Resolve the preset composition path from config and DSH_HOME. */
export function presetCompositionPath(config: Config | undefined, env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return join(resolveDshHome(env, home), '.agent-presets', config?.presetId ?? 'model-roles', config?.presetFile ?? 'agent.cordis.yml')
}

export const apply = mountOnce('@linxin666/dsh-client-ui-subagent-roles', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const dshHome = resolveDshHome()
  const deps = {
    presetPath: presetCompositionPath(config),
    settingsPath: join(dshHome, 'settings.yaml'),
    trustedHosts: config?.trustedHosts ?? [],
  }
  ctx.effect(() => {
    const disposers = makeRolesRoutes(deps).map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'subagent-roles: role matrix routes')
}
