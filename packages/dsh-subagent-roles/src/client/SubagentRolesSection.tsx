/**
 * The subagent role matrix settings section: one card per role with its
 * ordered fallback chain, route reorder/add/remove, per-role save/revert,
 * and a save-all for every dirty chain. All mutations stage locally in the
 * store until a save posts them to the host routes.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import css from './subagent-roles.module.css'
import type { AvailableModel, RoleData, RolesMatrixStore } from './roles-store.ts'
import type { SubagentRolesKey } from './locales.ts'

/** Locale reader injected by the plugin entry. */
export type Translate = (key: SubagentRolesKey, params?: Record<string, string | number>) => string

/** Props the plugin entry injects into the section. */
export interface SubagentRolesSectionInjected {
  /** The matrix store (host-route backed). */
  store: RolesMatrixStore
  /** Locale reader bound to this plugin's namespace. */
  t: Translate
}

/** Full section props: injected store/copy plus the settings shell's close. */
export interface SubagentRolesSectionProps extends SubagentRolesSectionInjected {
  /** Close the settings panel (unused today; the shell requires the slot). */
  close: () => void
}

/** Whether a role matches the free-text filter (role, tool, or any route). */
function matches(role: RoleData, query: string): boolean {
  if (query === '') return true
  const haystack = `${role.role} ${role.toolName} ${role.routes.map(route => route.key).join(' ')}`.toLowerCase()
  return haystack.includes(query)
}

/** One route row: position, provider tag, model, and the reorder/remove controls. */
function RouteRow({ role, index, t, onMove, onRemove }: {
  role: RoleData
  index: number
  t: Translate
  onMove: (index: number, dir: -1 | 1) => void
  onRemove: (index: number) => void
}): ReactNode {
  const route = role.routes[index]
  return (
    <li className={css.routeRow}>
      <span className={css.routeIndex}>{index + 1}</span>
      <span className={css.routeProvider} data-provider={route.provider}>{route.provider}</span>
      <span className={css.routeModel} title={route.key}>{route.model}</span>
      <span className={css.routeActions}>
        <button type="button" className={css.iconButton} disabled={index === 0} title={t('route.moveUp')} aria-label={t('route.moveUp')} onClick={() => { onMove(index, -1) }}>↑</button>
        <button type="button" className={css.iconButton} disabled={index === role.routes.length - 1} title={t('route.moveDown')} aria-label={t('route.moveDown')} onClick={() => { onMove(index, 1) }}>↓</button>
        <button type="button" className={css.iconButton} disabled={role.routes.length <= 1} title={t('route.remove')} aria-label={t('route.remove')} onClick={() => { onRemove(index) }}>×</button>
      </span>
    </li>
  )
}

/** One role card: header facts, the chain, the add picker, and save/revert. */
function RoleCard({ role, dirty, saving, models, t, store }: {
  role: RoleData
  dirty: boolean
  saving: boolean
  models: readonly AvailableModel[]
  t: Translate
  store: RolesMatrixStore
}): ReactNode {
  const [pick, setPick] = useState('')
  return (
    <section className={`${css.roleCard}${dirty ? ` ${css.roleCardDirty}` : ''}`}>
      <header className={css.roleHeader}>
        <div className={css.roleTitleGroup}>
          <h3 className={css.roleTitle}>{role.role}</h3>
          <span className={css.roleTool}>{role.toolName}</span>
        </div>
        {role.parents.length > 0 && (
          <div className={css.roleParents}>
            {role.parents.map(parent => <span key={parent} className={css.parentBadge}>{parent}</span>)}
          </div>
        )}
      </header>
      <ol className={css.routeList}>
        {role.routes.map((route, index) => (
          <RouteRow
            key={route.key}
            role={role}
            index={index}
            t={t}
            onMove={(routeIndex, dir) => { store.moveRoute(role.role, routeIndex, dir) }}
            onRemove={(routeIndex) => { store.removeRoute(role.role, routeIndex) }}
          />
        ))}
      </ol>
      {role.routes.length === 0 && <p className={css.chainWarning}>{t('role.emptyChain')}</p>}
      <div className={css.roleFooter}>
        <select
          className={css.addSelect}
          value={pick}
          aria-label={t('route.add')}
          onChange={event => {
            store.addRoute(role.role, event.target.value)
            setPick('')
          }}
        >
          <option value="">{t('route.addPlaceholder')}</option>
          {models
            .filter(model => !role.routes.some(route => route.key === model.key))
            .map(model => (
              <option key={model.key} value={model.key}>{model.providerName} / {model.name}</option>
            ))}
        </select>
        {dirty && (
          <span className={css.cardActions}>
            <button type="button" className={css.ghostButton} disabled={saving} onClick={() => { store.revertRole(role.role) }}>{t('revert')}</button>
            <button
              type="button"
              className={css.primaryButton}
              disabled={saving || role.routes.length === 0}
              onClick={() => { void store.saveRole(role.role) }}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </span>
        )}
      </div>
    </section>
  )
}

/**
 * The settings section component. Loads on mount, filters client-side, and
 * renders one card per visible role.
 * @param props - injected store and copy, plus the shell's close.
 */
export function SubagentRolesSection(props: SubagentRolesSectionProps): ReactNode {
  const { store, t } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (state.status === 'loading') void store.load()
  }, [store, state.status])

  const dirty = store.dirtyRoles(state)
  const visible = useMemo(
    () => state.roles.filter(role => matches(role, query.trim().toLowerCase())),
    [state.roles, query],
  )

  return (
    <div className={css.matrix}>
      <header className={css.matrixHeader}>
        <h2 className={css.matrixTitle}>{t('title')}</h2>
        <p className={css.matrixIntro}>{t('intro')}</p>
      </header>
      <div className={css.toolbar}>
        <input
          className={css.searchInput}
          value={query}
          placeholder={t('search.placeholder')}
          spellCheck={false}
          onChange={event => { setQuery(event.target.value) }}
        />
        <span className={css.toolbarSpacer} />
        {dirty.length > 0 && <span className={css.dirtyBadge}>{t('dirtyCount', { count: dirty.length })}</span>}
        <button type="button" className={css.ghostButton} disabled={state.saving} onClick={() => { void store.load() }}>{t('reload')}</button>
        <button
          type="button"
          className={css.primaryButton}
          disabled={state.saving || dirty.length === 0}
          onClick={() => { void store.saveAll() }}
        >
          {state.saving ? t('saving') : t('saveAll')}
        </button>
      </div>
      {state.status === 'loading' && <p className={css.statusLine}>{t('status.loading')}</p>}
      {state.status === 'error' && <p className={css.errorLine}>{t('status.error', { message: state.error ?? '' })}</p>}
      {state.error !== undefined && state.status === 'ready' && <p className={css.errorLine}>{t('save.failed', { message: state.error })}</p>}
      {state.status === 'ready' && state.models.length === 0 && <p className={css.statusLine}>{t('status.modelsEmpty')}</p>}
      <div className={css.rolesGrid}>
        {visible.map(role => (
          <RoleCard
            key={role.role}
            role={role}
            dirty={store.isDirty(role.role, state)}
            saving={state.saving}
            models={state.models}
            t={t}
            store={store}
          />
        ))}
      </div>
    </div>
  )
}
