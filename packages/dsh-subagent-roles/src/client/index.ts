/**
 * Subagent role matrix, browser half: registers the locale dictionaries and
 * contributes the "Subagent roles" settings section, which edits the preset's
 * role chains through the package's loopback-fenced host routes.
 *
 * Failure policy: DOM/slot mounting problems are logged, never thrown — the
 * web shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh, type SubagentRolesKey } from './locales.ts'
import { RolesMatrixStore } from './roles-store.ts'
import { SubagentRolesSection, type SubagentRolesSectionInjected } from './SubagentRolesSection.tsx'

/** Locale namespace this plugin owns. */
const NS = 'subagent-roles'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent role matrix copy. */
    'subagent-roles': SubagentRolesKey
  }
}

/** Required services (the settings shell and locale must be up first). */
export const inject = ['slots', 'locale']

/**
 * Mount the dictionaries and the settings section. The section loads its
 * data lazily on first render, so mounting never blocks on the host routes.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'subagent-roles: dictionaries')

  const store = new RolesMatrixStore()
  ctx.slots.inject('settings.section', () => {
    try {
      const injected = (): SubagentRolesSectionInjected => ({
        store,
        t: (key, params) => ctx.locale.bind(NS)(key, params),
      })
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: 'subagent-roles',
        order: 30,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS,
        inject: injected,
      }, SubagentRolesSection)
      return () => { unregister() }
    } catch {
      return () => {}
    }
  })
}
