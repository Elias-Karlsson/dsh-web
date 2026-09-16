/**
 * Role matrix store: loads role chains and the model catalog through the
 * package's loopback-fenced host routes (same-origin), tracks per-role dirty
 * state against the last saved snapshot, and applies reorder/add/remove plus
 * save/revert. Framework-free; the React section subscribes through
 * useSyncExternalStore.
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
}

const API = '/subagent-roles/api'

/** Shallow route-key list for dirty comparison. */
function routeKeys(role: RoleData): string {
  return role.routes.map(r => r.key).join('')
}

/**
 * The matrix store. All mutations stay local until saveRole/saveAll POSTs the
 * edited chains; a successful save replaces both the edited and the saved
 * snapshot with the server's authoritative read-back.
 */
export class RolesMatrixStore {
  private state: MatrixState = { status: 'loading', error: undefined, roles: [], models: [], saving: false }
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

  /** Roles with unsaved edits, in display order. */
  dirtyRoles(state: MatrixState = this.state): readonly string[] {
    return state.roles.filter(role => this.saved.get(role.role) !== routeKeys(role)).map(role => role.role)
  }

  /** Whether one role has unsaved edits. */
  isDirty(role: string, state: MatrixState = this.state): boolean {
    const found = state.roles.find(candidate => candidate.role === role)
    return found !== undefined && this.saved.get(role) !== routeKeys(found)
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

  /** Drop one role's unsaved edits (back to the saved snapshot). */
  revertRole(role: string): void {
    const savedKeys = this.saved.get(role)
    if (savedKeys === undefined) return
    const keys = savedKeys.split('').filter(Boolean)
    this.editRole(role, () => keys.map(key => {
      const slash = key.indexOf('/')
      return { provider: key.slice(0, slash), model: key.slice(slash + 1), key }
    }))
  }

  /** POST one edited chain; the server answers with the authoritative roles. */
  async saveRole(role: string): Promise<boolean> {
    const found = this.state.roles.find(candidate => candidate.role === role)
    if (found === undefined || this.state.saving) return false
    return this.saveAll([role])
  }

  /** POST every dirty chain in one batch; absent argument saves all dirty roles. */
  async saveAll(roles?: readonly string[]): Promise<boolean> {
    const targets = roles ?? this.dirtyRoles()
    const updates = this.state.roles.filter(candidate => targets.includes(candidate.role))
    if (updates.length === 0 || this.state.saving) return false
    this.set({ saving: true, error: undefined })
    try {
      const response = await fetch(`${API}/roles-batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roles: updates.map(role => ({ role: role.role, routes: role.routes.map(route => route.key) })) }),
      })
      const body = await response.json() as { ok: boolean; roles?: RoleData[]; error?: string }
      if (!body.ok || body.roles === undefined) throw new Error(body.error ?? `HTTP ${response.status}`)
      this.saved = new Map(body.roles.map(role => [role.role, routeKeys(role)]))
      this.set({ saving: false, roles: body.roles })
      return true
    } catch (error: unknown) {
      this.set({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }
}
