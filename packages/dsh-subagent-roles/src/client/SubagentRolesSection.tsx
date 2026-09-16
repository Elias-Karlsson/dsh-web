/**
 * The subagent role matrix settings section: one card per role with three
 * tabs — the ordered fallback chain (reorder/add/remove), the spawn-parent
 * checkboxes, and the persona plus filter token lists — plus per-tab
 * save/revert, an add-role form, and per-role deletion. All mutations stage
 * locally in the store until a save posts them to the host routes.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import css from './subagent-roles.module.css'
import type { AvailableModel, RoleData, RoleDraft, RolesMatrixStore } from './roles-store.ts'
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

/** Card tab ids, in display order. */
type RoleTab = 'chains' | 'spawn' | 'prompt'

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

/** One filter token list: removable chips, an add input, and suggestion chips. */
function TokenList({ label, tokens, suggestions, t, onChange }: {
  label: string
  tokens: readonly string[]
  suggestions: readonly string[]
  t: Translate
  onChange: (tokens: string[]) => void
}): ReactNode {
  const [entry, setEntry] = useState('')
  const add = (raw: string): void => {
    const token = raw.trim()
    if (token === '' || tokens.includes(token)) return
    onChange([...tokens, token])
    setEntry('')
  }
  const available = suggestions.filter(candidate => !tokens.includes(candidate))
  return (
    <div className={css.tokenEditor}>
      <span className={css.fieldLabel}>{label}</span>
      <div className={css.chipList}>
        {tokens.map(token => (
          <span key={token} className={css.chip}>
            {token}
            <button
              type="button"
              className={css.chipRemove}
              title={t('filter.removeToken')}
              aria-label={`${t('filter.removeToken')} ${token}`}
              onClick={() => { onChange(tokens.filter(candidate => candidate !== token)) }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className={css.tokenRow}>
        <input
          className={css.tokenInput}
          value={entry}
          placeholder={t('filter.tokenPlaceholder')}
          spellCheck={false}
          onChange={event => { setEntry(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add(entry)
            }
          }}
        />
        <button type="button" className={css.ghostButton} disabled={entry.trim() === ''} onClick={() => { add(entry) }}>{t('filter.addToken')}</button>
      </div>
      {available.length > 0 && (
        <div className={css.suggestionRow}>
          <span className={css.suggestionLabel}>{t('filter.suggestions')}</span>
          {available.map(candidate => (
            <button key={candidate} type="button" className={css.suggestionChip} onClick={() => { add(candidate) }}>{candidate}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Save/revert pair shared by the Spawn and Filter & prompt tabs. */
function TabActions({ saving, t, onRevert, onSave }: {
  saving: boolean
  t: Translate
  onRevert: () => void
  onSave: () => void
}): ReactNode {
  return (
    <div className={css.roleFooter}>
      <span className={css.toolbarSpacer} />
      <span className={css.cardActions}>
        <button type="button" className={css.ghostButton} disabled={saving} onClick={onRevert}>{t('revert')}</button>
        <button type="button" className={css.primaryButton} disabled={saving} onClick={onSave}>{saving ? t('saving') : t('save')}</button>
      </span>
    </div>
  )
}

/** One role card: header facts and delete, the tab bar, and the active tab. */
function RoleCard({ role, draft, dirty, spawnDirty, promptDirty, saving, models, roles, suggestions, t, store }: {
  role: RoleData
  draft: RoleDraft | undefined
  dirty: boolean
  spawnDirty: boolean
  promptDirty: boolean
  saving: boolean
  models: readonly AvailableModel[]
  roles: readonly RoleData[]
  suggestions: readonly string[]
  t: Translate
  store: RolesMatrixStore
}): ReactNode {
  const [pick, setPick] = useState('')
  const [tab, setTab] = useState<RoleTab>('chains')
  const anyDirty = dirty || spawnDirty || promptDirty
  const parents = draft?.parents ?? [...role.parents]
  const candidates = useMemo(
    () => ['main', ...roles.map(candidate => candidate.role)].filter(candidate => candidate !== role.role),
    [roles, role.role],
  )
  return (
    <section className={`${css.roleCard}${anyDirty ? ` ${css.roleCardDirty}` : ''}`}>
      <header className={css.roleHeader}>
        <div className={css.roleHeaderTop}>
          <div className={css.roleTitleGroup}>
            <h3 className={css.roleTitle}>{role.role}</h3>
            <span className={css.roleTool}>{role.toolName}</span>
          </div>
          <button
            type="button"
            className={css.dangerButton}
            disabled={saving}
            onClick={() => {
              if (window.confirm(t('role.deleteConfirm', { role: role.role }))) void store.deleteRole(role.role)
            }}
          >
            {t('role.delete')}
          </button>
        </div>
        {role.parents.length > 0 && (
          <div className={css.roleParents}>
            {role.parents.map(parent => <span key={parent} className={css.parentBadge}>{parent}</span>)}
          </div>
        )}
      </header>
      <nav className={css.tabBar}>
        {(['chains', 'spawn', 'prompt'] as const).map(name => (
          <button
            key={name}
            type="button"
            className={`${css.tab}${tab === name ? ` ${css.tabActive}` : ''}`}
            onClick={() => { setTab(name) }}
          >
            {t(`tab.${name}`)}
          </button>
        ))}
      </nav>
      {tab === 'chains' && (
        <>
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
        </>
      )}
      {tab === 'spawn' && (
        <>
          <p className={css.tabIntro}>{t('spawn.intro')}</p>
          <div className={css.spawnList}>
            {candidates.map(parent => (
              <label key={parent} className={css.spawnRow}>
                <input
                  type="checkbox"
                  checked={parents.includes(parent)}
                  onChange={event => {
                    const next = event.target.checked
                      ? [...parents, parent]
                      : parents.filter(candidate => candidate !== parent)
                    store.stageParents(role.role, next)
                  }}
                />
                <span>{parent}</span>
              </label>
            ))}
          </div>
          {parents.length === 0 && <p className={css.chainWarning}>{t('spawn.none')}</p>}
          {spawnDirty && (
            <TabActions
              saving={saving}
              t={t}
              onRevert={() => { store.revertSpawn(role.role) }}
              onSave={() => { void store.saveSpawn(role.role) }}
            />
          )}
        </>
      )}
      {tab === 'prompt' && (
        <>
          <div className={css.tokenEditor}>
            <span className={css.fieldLabel}>{t('prompt.persona')}</span>
            <textarea
              className={css.personaArea}
              value={draft?.persona ?? role.persona}
              rows={6}
              spellCheck={false}
              onChange={event => { store.stagePersona(role.role, event.target.value) }}
            />
          </div>
          <TokenList
            label={t('filter.toolAllow')}
            tokens={draft?.toolAllow ?? role.toolAllow}
            suggestions={suggestions}
            t={t}
            onChange={tokens => { store.stageFilter(role.role, 'toolAllow', tokens) }}
          />
          <TokenList
            label={t('filter.systemSections')}
            tokens={draft?.systemSections ?? role.contextFilter.systemSections}
            suggestions={suggestions}
            t={t}
            onChange={tokens => { store.stageFilter(role.role, 'systemSections', tokens) }}
          />
          <TokenList
            label={t('filter.runtimeContexts')}
            tokens={draft?.runtimeContexts ?? role.contextFilter.runtimeContexts}
            suggestions={suggestions}
            t={t}
            onChange={tokens => { store.stageFilter(role.role, 'runtimeContexts', tokens) }}
          />
          <TokenList
            label={t('filter.denyKinds')}
            tokens={draft?.denyMessageSourceKinds ?? role.contextFilter.denyMessageSourceKinds}
            suggestions={suggestions}
            t={t}
            onChange={tokens => { store.stageFilter(role.role, 'denyMessageSourceKinds', tokens) }}
          />
          {promptDirty && (
            <TabActions
              saving={saving}
              t={t}
              onRevert={() => { store.revertPrompt(role.role) }}
              onSave={() => { void store.savePrompt(role.role) }}
            />
          )}
        </>
      )}
    </section>
  )
}

/** The add-role form: name, persona, template role, and the initial model. */
function AddRoleCard({ roles, models, saving, t, store }: {
  roles: readonly RoleData[]
  models: readonly AvailableModel[]
  saving: boolean
  t: Translate
  store: RolesMatrixStore
}): ReactNode {
  const [name, setName] = useState('')
  const [persona, setPersona] = useState('')
  const [template, setTemplate] = useState('')
  const [model, setModel] = useState('')
  const templateRole = template === '' ? (roles[0]?.role ?? '') : template
  const canSubmit = name.trim() !== '' && persona.trim() !== '' && templateRole !== '' && model !== '' && !saving
  return (
    <section className={css.addCard}>
      <h3 className={css.addTitle}>{t('add.title')}</h3>
      <div className={css.addGrid}>
        <label className={css.addField}>
          <span className={css.fieldLabel}>{t('add.name')}</span>
          <input
            className={css.tokenInput}
            value={name}
            placeholder={t('add.namePlaceholder')}
            spellCheck={false}
            onChange={event => { setName(event.target.value) }}
          />
        </label>
        <label className={css.addField}>
          <span className={css.fieldLabel}>{t('add.template')}</span>
          <select className={css.addSelect} value={templateRole} onChange={event => { setTemplate(event.target.value) }}>
            {roles.map(role => <option key={role.role} value={role.role}>{role.role}</option>)}
          </select>
        </label>
        <label className={css.addField}>
          <span className={css.fieldLabel}>{t('add.model')}</span>
          <select className={css.addSelect} value={model} onChange={event => { setModel(event.target.value) }}>
            <option value="">{t('add.modelPlaceholder')}</option>
            {models.map(entry => <option key={entry.key} value={entry.key}>{entry.providerName} / {entry.name}</option>)}
          </select>
        </label>
      </div>
      <label className={css.addField}>
        <span className={css.fieldLabel}>{t('add.persona')}</span>
        <textarea
          className={css.personaArea}
          value={persona}
          rows={3}
          spellCheck={false}
          onChange={event => { setPersona(event.target.value) }}
        />
      </label>
      <div className={css.roleFooter}>
        <span className={css.toolbarSpacer} />
        <button
          type="button"
          className={css.primaryButton}
          disabled={!canSubmit}
          onClick={() => {
            void store.createRole({ role: name.trim(), persona, templateRole, route: model }).then(created => {
              if (created) {
                setName('')
                setPersona('')
                setTemplate('')
                setModel('')
              }
            })
          }}
        >
          {saving ? t('saving') : t('add.submit')}
        </button>
      </div>
    </section>
  )
}

/**
 * The settings section component. Loads on mount, filters client-side, and
 * renders the add-role form plus one card per visible role.
 * @param props - injected store and copy, plus the shell's close.
 */
export function SubagentRolesSection(props: SubagentRolesSectionProps): ReactNode {
  const { store, t } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (state.status === 'loading') void store.load()
  }, [store, state.status])

  const dirty = useMemo(
    () => [...new Set([...store.dirtyRoles(state), ...store.draftRoles(state)])],
    [store, state],
  )
  const visible = useMemo(
    () => state.roles.filter(role => matches(role, query.trim().toLowerCase())),
    [state.roles, query],
  )
  const suggestions = useMemo(() => {
    const tokens = new Set<string>()
    for (const role of state.roles) {
      tokens.add(role.toolName)
      for (const token of role.toolAllow) tokens.add(token)
      for (const token of role.contextFilter.systemSections) tokens.add(token)
      for (const token of role.contextFilter.runtimeContexts) tokens.add(token)
      for (const token of role.contextFilter.denyMessageSourceKinds) tokens.add(token)
    }
    return [...tokens].sort()
  }, [state.roles])

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
      {state.status === 'ready' && (
        <AddRoleCard roles={state.roles} models={state.models} saving={state.saving} t={t} store={store} />
      )}
      <div className={css.rolesGrid}>
        {visible.map(role => (
          <RoleCard
            key={role.role}
            role={role}
            draft={state.drafts[role.role]}
            dirty={store.isDirty(role.role, state)}
            spawnDirty={store.isSpawnDirty(role.role, state)}
            promptDirty={store.isPromptDirty(role.role, state)}
            saving={state.saving}
            models={state.models}
            roles={state.roles}
            suggestions={suggestions}
            t={t}
            store={store}
          />
        ))}
      </div>
    </div>
  )
}
