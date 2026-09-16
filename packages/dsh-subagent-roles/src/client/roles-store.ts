/**
 * Role matrix store: loads role blocks and the model catalog through the
 * package's loopback-fenced host routes (same-origin), tracks per-role dirty
 * state against the last saved snapshot, and applies reorder/add/remove plus
 * spawn-parent, persona/filter, create, and delete saves. Framework-free;
 * the React section subscribes through useSyncExternalStore.
 */

/** One route in a role chain (wire shape). */
export interface RoleRoute {
  /** Provider id. */
  provider: string
  /** Model id. */
  model: string
  /** `provider/model` key. */
  key: string
}

/** The three contextFilter token lists (wire shape). */
export interface RoleContextFilter {
  /** systemSection ids kept for the subagent. */
  systemSections: readonly string[]
  /** runtime context ids kept for the subagent. */
  runtimeContexts: readonly string[]
  /** message source kinds denied to the subagent. */
  denyMessageSourceKinds: readonly string[]
}

/** One role block (wire shape). */
export interface RoleData {
  /** Role name. */
  role: string
  /** Owning subagent tool. */
  toolName: string
  /** Parent roles allowed to call this tool. */
  parents: readonly string[]
  /** The chain in fallback order. */
  routes: RoleRoute[]
  /** Persona literal text. */
  persona: string
  /** toolFilter.allow tokens. */
  toolAllow: readonly string[]
  /** contextFilter token lists. */
  contextFilter: RoleContextFilter
}

/** One model the add-route picker may offer (wire shape). */
export interface AvailableModel {
  /** Provider id. */
  provider: string
  /** Model id. */
  model: string
  /** `provider/model` key. */
  key: string
  /** Display name. */
  name: string
  /** Provider display name. */
  providerName: string
}

/** The four filter token lists editable in the Filter & prompt tab. */
export type FilterField = 'toolAllow' | 'systemSections' | 'runtimeContexts' | 'denyMessageSourceKinds'

/**
 * Staged, unsaved edits of one role outside the chain tab. A present key
 * overrides the server's value in the UI until saved or reverted.
 */
export interface RoleDraft {
  /** Staged spawn parents (Spawn tab). */
  parents?: string[]
  /** Staged persona text (Filter & prompt tab). */
  persona?: string
  /** Staged toolFilter.allow tokens. */
  toolAllow?: string[]
  /** Staged contextFilter.systemSections tokens. */
  systemSections?: string[]
  /** Staged contextFilter.runtimeContexts tokens. */
  runtimeContexts?: string[]
  /** Staged contextFilter.denyMessageSourceKinds tokens. */
  denyMessageSourceKinds?: string[]
}

/** Store snapshot. */
export interface MatrixState {
  /** Load lifecycle: the section shows loading until the first successful read. */
  status: 'loading' | 'ready' | 'error'
  /** Fatal load/save error message (cleared on reload). */
  error: string | undefined
  /** Edited role chains (dirty until saved). */
  roles: readonly RoleData[]
  /** Model catalog for the add-route picker. */
  models: readonly AvailableModel[]
  /** Whether a save request is in flight. */
  saving: boolean
  /** Staged per-role spawn/persona/filter edits, keyed by role name. */
  drafts: Record<string, RoleDraft>
}

const API = '/subagent-roles/api'

/** Shallow route-key list for dirty comparison. */
function routeKeys(role: RoleData): string {
  return role.routes.map(r => r.key).join('')
}

/** Whether a staged draft still holds any field. */
function hasDraftFields(draft: RoleDraft | undefined): boolean {
  return draft !== undefined && Object.keys(draft).length > 0
}

/**
 * The matrix store. Chain mutations stay local until saveRole/saveAll POSTs
 * them; spawn and persona/filter edits stage in drafts until their per-tab
 * save POSTs. A successful save replaces the edited snapshot with the
 * server's authoritative read-back and clears the saved roles' drafts.
 */
export class RolesMatrixStore {
  private state: MatrixState = { status: 'loading', error: undefined, roles: [], models: [], saving: false, drafts: {} }
  private saved = new Map<string, string>()
  private readonly listeners = new Set<() => void>()

  /** Current snapshot (stable reference until a mutation notifies). */
  getSnapshot = (): MatrixState => this.state

  /** Subscribe to snapshot changes; returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private set(patch: Partial<MatrixState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Roles with unsaved chain edits, in display order. */
  dirtyRoles(state: MatrixState = this.state): readonly string[] {
    return state.roles.filter(role => this.saved.get(role.role) !== routeKeys(role)).map(role => role.role)
  }

  /** Roles with staged spawn/persona/filter drafts, in display order. */
  draftRoles(state: MatrixState = this.state): readonly string[] {
    return state.roles.filter(role => hasDraftFields(state.drafts[role.role])).map(role => role.role)
  }

  /** Whether one role has unsaved chain edits. */
  isDirty(role: string, state: MatrixState = this.state): boolean {
    const found = state.roles.find(candidate => candidate.role === role)
    return found !== undefined && this.saved.get(role) !== routeKeys(found)
  }

  /** Whether one role has a staged spawn-parents draft. */
  isSpawnDirty(role: string, state: MatrixState = this.state): boolean {
    return state.drafts[role]?.parents !== undefined
  }

  /** Whether one role has staged persona or filter drafts. */
  isPromptDirty(role: string, state: MatrixState = this.state): boolean {
    const draft = state.drafts[role]
    return draft?.persona !== undefined
      || draft?.toolAllow !== undefined
      || draft?.systemSections !== undefined
      || draft?.runtimeContexts !== undefined
      || draft?.denyMessageSourceKinds !== undefined
  }

  /** Fetch roles + models; a failed read leaves the previous snapshot intact. */
  async load(): Promise<void> {
    try {
      const [rolesResponse, modelsResponse] = await Promise.all([
        fetch(`${API}/roles`),
        fetch(`${API}/models`),
      ])
      const rolesBody = await rolesResponse.json() as { ok: boolean; roles?: RoleData[]; error?: string }
      const modelsBody = await modelsResponse.json() as { ok: boolean; models?: AvailableModel[] }
      if (!rolesBody.ok || rolesBody.roles === undefined) throw new Error(rolesBody.error ?? `HTTP ${rolesResponse.status}`)
      this.saved = new Map(rolesBody.roles.map(role => [role.role, routeKeys(role)]))
      this.set({
        status: 'ready',
        error: undefined,
        roles: rolesBody.roles,
        models: modelsBody.ok ? (modelsBody.models ?? []) : [],
        drafts: {},
      })
    } catch (error: unknown) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  private editRole(role: string, edit: (routes: RoleRoute[]) => RoleRoute[]): void {
    this.set({
      roles: this.state.roles.map(candidate =>
        candidate.role === role ? { ...candidate, routes: edit([...candidate.routes]) } : candidate),
    })
  }

  /** Move one route one step up (dir -1) or down (dir +1). */
  moveRoute(role: string, index: number, dir: -1 | 1): void {
    this.editRole(role, routes => {
      const target = index + dir
      if (index < 0 || index >= routes.length || target < 0 || target >= routes.length) return routes
      const [moved] = routes.splice(index, 1)
      routes.splice(target, 0, moved)
      return routes
    })
  }

  /** Remove one route; the host rejects a save that would empty the chain. */
  removeRoute(role: string, index: number): void {
    this.editRole(role, routes => routes.filter((_, candidate) => candidate !== index))
  }

  /** Append a route by `provider/model` key; duplicates are ignored. */
  addRoute(role: string, key: string): void {
    const model = this.state.models.find(candidate => candidate.key === key)
    if (model === undefined) return
    this.editRole(role, routes =>
      routes.some(route => route.key === key) ? routes : [...routes, { provider: model.provider, model: model.model, key }])
  }

  /** Drop one role's unsaved chain edits (back to the saved snapshot). */
  revertRole(role: string): void {
    const savedKeys = this.saved.get(role)
    if (savedKeys === undefined) return
    const keys = savedKeys.split('').filter(Boolean)
    this.editRole(role, () => keys.map(key => {
      const slash = key.indexOf('/')
      return { provider: key.slice(0, slash), model: key.slice(slash + 1), key }
    }))
  }

  private setDraft(role: string, patch: RoleDraft): void {
    const current = this.state.drafts[role] ?? {}
    this.set({ drafts: { ...this.state.drafts, [role]: { ...current, ...patch } } })
  }

  private clearDraft(role: string, fields: readonly (keyof RoleDraft)[]): void {
    const current = this.state.drafts[role]
    if (current === undefined) return
    const next = { ...current }
    for (const field of fields) delete next[field]
    const drafts = { ...this.state.drafts }
    if (hasDraftFields(next)) drafts[role] = next
    else delete drafts[role]
    this.set({ drafts })
  }

  /** Stage one role's spawn parents (Spawn tab). */
  stageParents(role: string, parents: string[]): void {
    this.setDraft(role, { parents })
  }

  /** Drop one role's staged spawn parents. */
  revertSpawn(role: string): void {
    this.clearDraft(role, ['parents'])
  }

  /** Stage one role's persona text (Filter & prompt tab). */
  stagePersona(role: string, persona: string): void {
    this.setDraft(role, { persona })
  }

  /** Stage one filter token list of one role (Filter & prompt tab). */
  stageFilter(role: string, field: FilterField, tokens: string[]): void {
    this.setDraft(role, { [field]: tokens })
  }

  /** Drop one role's staged persona and filter edits. */
  revertPrompt(role: string): void {
    this.clearDraft(role, ['persona', 'toolAllow', 'systemSections', 'runtimeContexts', 'denyMessageSourceKinds'])
  }

  /** POST one mutation; the server answers with the authoritative roles. */
  private async post(path: string, payload: unknown): Promise<RoleData[]> {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json() as { ok: boolean; roles?: RoleData[]; error?: string }
    if (!body.ok || body.roles === undefined) throw new Error(body.error ?? `HTTP ${response.status}`)
    return body.roles
  }

  /** Accept the server's read-back and drop the named roles' drafts. */
  private accept(roles: RoleData[], clearRoles: readonly string[]): void {
    this.saved = new Map(roles.map(role => [role.role, routeKeys(role)]))
    const drafts = { ...this.state.drafts }
    for (const role of clearRoles) delete drafts[role]
    this.set({ saving: false, roles, drafts })
  }

  /** POST one edited chain; the server answers with the authoritative roles. */
  async saveRole(role: string): Promise<boolean> {
    const found = this.state.roles.find(candidate => candidate.role === role)
    if (found === undefined || this.state.saving) return false
    this.set({ saving: true, error: undefined })
    try {
      const roles = await this.post('/role', { role: found.role, routes: found.routes.map(route => route.key) })
      this.accept(roles, [])
      return true
    } catch (error: unknown) {
      this.set({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /** POST one role's staged spawn parents. */
  async saveSpawn(role: string): Promise<boolean> {
    const found = this.state.roles.find(candidate => candidate.role === role)
    if (found === undefined || this.state.saving) return false
    const parents = this.state.drafts[role]?.parents ?? [...found.parents]
    this.set({ saving: true, error: undefined })
    try {
      const roles = await this.post('/role-parents', { role, parents })
      this.accept(roles, [role])
      return true
    } catch (error: unknown) {
      this.set({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /**
   * POST one role's staged persona, then its staged filter lists; a failed
   * persona save stops the sequence and the filters are never sent.
   */
  async savePrompt(role: string): Promise<boolean> {
    const found = this.state.roles.find(candidate => candidate.role === role)
    if (found === undefined || this.state.saving) return false
    const draft = this.state.drafts[role] ?? {}
    const persona = draft.persona ?? found.persona
    this.set({ saving: true, error: undefined })
    try {
      await this.post('/role-persona', { role, persona })
      const roles = await this.post('/role-filters', {
        role,
        toolAllow: draft.toolAllow ?? [...found.toolAllow],
        systemSections: draft.systemSections ?? [...found.contextFilter.systemSections],
        runtimeContexts: draft.runtimeContexts ?? [...found.contextFilter.runtimeContexts],
        denyMessageSourceKinds: draft.denyMessageSourceKinds ?? [...found.contextFilter.denyMessageSourceKinds],
      })
      this.accept(roles, [role])
      return true
    } catch (error: unknown) {
      this.set({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /**
   * POST a new role block. The route is a `provider/model` key from the model
   * catalog; the new role starts with no spawn parents.
   */
  async createRole(spec: { role: string; persona: string; templateRole: string; route: string }): Promise<boolean> {
    if (this.state.saving) return false
    this.set({ saving: true, error: undefined })
    try {
      const roles = await this.post('/role-create', spec)
      this.accept(roles, [])
      return true
    } catch (error: unknown) {
      this.set({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /** POST a role deletion; references in other roles are stripped server-side. */
  async deleteRole(role: string): Promise<boolean> {
    if (this.state.saving) return false
    this.set({ saving: true, error: undefined })
    try {
      const roles = await this.post('/role-delete', { role })
      // A staged spawn draft elsewhere may still name the deleted role; drop
      // the stale reference so a later save cannot resurrect it.
      const drafts: Record<string, RoleDraft> = {}
      for (const [name, draft] of Object.entries(this.state.drafts)) {
        if (name === role) continue
        drafts[name] = draft.parents === undefined ? draft : { ...draft, parents: draft.parents.filter(parent => parent !== role) }
      }
      this.set({ drafts })
      this.accept(roles, [role])
      return true
    } catch (error: unknown) {
      this.set({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /**
   * Flush every unsaved edit: dirty chains in one batch, then each staged
   * spawn draft, then each staged persona/filter draft, sequentially.
   */
  async saveAll(roles?: readonly string[]): Promise<boolean> {
    const targets = roles ?? [...new Set([...this.dirtyRoles(), ...this.draftRoles()])]
    if (targets.length === 0 || this.state.saving) return false
    this.set({ saving: true, error: undefined })
    try {
      const chainUpdates = this.state.roles.filter(candidate => targets.includes(candidate.role) && this.isDirty(candidate.role))
      if (chainUpdates.length > 0) {
        const response = await fetch(`${API}/roles-batch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roles: chainUpdates.map(role => ({ role: role.role, routes: role.routes.map(route => route.key) })) }),
        })
        const body = await response.json() as { ok: boolean; roles?: RoleData[]; error?: string }
        if (!body.ok || body.roles === undefined) throw new Error(body.error ?? `HTTP ${response.status}`)
        this.saved = new Map(body.roles.map(role => [role.role, routeKeys(role)]))
        this.set({ roles: body.roles })
      }
      for (const role of targets) {
        if (this.state.drafts[role]?.parents !== undefined) {
          this.set({ saving: false })
          if (!await this.saveSpawn(role)) return false
        }
        if (this.isPromptDirty(role)) {
          this.set({ saving: false })
          if (!await this.savePrompt(role)) return false
        }
      }
      this.set({ saving: false })
      return true
    } catch (error: unknown) {
      this.set({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }
}
