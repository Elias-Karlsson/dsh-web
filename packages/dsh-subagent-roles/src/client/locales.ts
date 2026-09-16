/**
 * Locale bundles for the subagent role matrix settings section. zh is the
 * source of truth; en mirrors the key set, and the ru mirror lives in
 * dsh-i18n (key-set parity is gated by pnpm i18n:check).
 */

/** Copy keys the role matrix reads. */
export type SubagentRolesKey =
  | 'nav' | 'title' | 'intro' | 'search.placeholder'
  | 'reload' | 'saveAll' | 'dirtyCount'
  | 'role.emptyChain' | 'role.delete' | 'role.deleteConfirm'
  | 'route.moveUp' | 'route.moveDown' | 'route.remove' | 'route.add' | 'route.addPlaceholder'
  | 'tab.chains' | 'tab.spawn' | 'tab.prompt'
  | 'spawn.intro' | 'spawn.none'
  | 'prompt.persona'
  | 'filter.toolAllow' | 'filter.systemSections' | 'filter.runtimeContexts' | 'filter.denyKinds'
  | 'filter.tokenPlaceholder' | 'filter.addToken' | 'filter.removeToken' | 'filter.suggestions'
  | 'add.title' | 'add.name' | 'add.namePlaceholder' | 'add.persona'
  | 'add.template' | 'add.model' | 'add.modelPlaceholder' | 'add.submit'
  | 'save' | 'saving' | 'revert'
  | 'status.loading' | 'status.error' | 'status.modelsEmpty'
  | 'save.failed'

/** Chinese copy (source of truth). */
export const zh: Record<SubagentRolesKey, string> = {
  nav: '子代理角色',
  title: '子代理角色矩阵',
  intro:
    '每个角色是一条按顺序回退的模型链：子代理先请求链首模型，失败后依次回退。'
    + '调整顺序、增删路由后点击保存，改动直接写入预设文件，新的子代理会话立即生效。',
  'search.placeholder': '筛选角色、工具、模型…',
  reload: '重新加载',
  saveAll: '保存全部',
  dirtyCount: '{count} 处未保存',
  'role.emptyChain': '链条不能为空 —— 至少保留一条路由。',
  'role.delete': '删除角色',
  'role.deleteConfirm': '确定删除角色 {role}？其在其他角色的过滤列表与父角色列表中的引用也会一并移除。',
  'route.moveUp': '上移',
  'route.moveDown': '下移',
  'route.remove': '移除',
  'route.add': '添加路由',
  'route.addPlaceholder': '选择要添加的模型…',
  'tab.chains': '模型链',
  'tab.spawn': '孵化权限',
  'tab.prompt': '过滤与提示词',
  'spawn.intro': '勾选允许孵化该角色的父角色：main 是主代理，其余是角色名。',
  'spawn.none': '未勾选任何父角色 —— 该角色将无法被任何人孵化。',
  'prompt.persona': '人格提示词（persona）',
  'filter.toolAllow': '工具白名单（toolFilter.allow）',
  'filter.systemSections': '系统提示段（systemSections）',
  'filter.runtimeContexts': '运行时上下文（runtimeContexts）',
  'filter.denyKinds': '拒绝的消息来源（denyMessageSourceKinds）',
  'filter.tokenPlaceholder': '输入词条后回车添加…',
  'filter.addToken': '添加',
  'filter.removeToken': '移除',
  'filter.suggestions': '可选项',
  'add.title': '新增角色',
  'add.name': '角色名',
  'add.namePlaceholder': '小写字母、数字与连字符',
  'add.persona': '人格提示词',
  'add.template': '模板角色',
  'add.model': '初始模型',
  'add.modelPlaceholder': '选择初始模型…',
  'add.submit': '创建角色',
  save: '保存',
  saving: '保存中…',
  revert: '还原',
  'status.loading': '正在读取角色链…',
  'status.error': '无法读取角色矩阵：{message}',
  'status.modelsEmpty': 'settings.yaml 中没有可用模型，仍可调整顺序与删除。',
  'save.failed': '保存失败：{message}',
}

/** English copy. */
export const en: Record<SubagentRolesKey, string> = {
  nav: 'Subagent roles',
  title: 'Subagent Role Matrix',
  intro:
    'Each role is an ordered model fallback chain: the subagent tries the first route, '
    + 'then falls back down the list. Reorder, add, or remove routes and save — the change '
    + 'writes straight to the preset file and takes effect for newly spawned subagents.',
  'search.placeholder': 'Filter roles, tools, models…',
  reload: 'Reload',
  saveAll: 'Save all',
  dirtyCount: '{count} unsaved',
  'role.emptyChain': 'A chain cannot be empty — keep at least one route.',
  'role.delete': 'Delete role',
  'role.deleteConfirm':
    'Delete role {role}? References in the filter lists and spawn-parent lists of other roles are removed too.',
  'route.moveUp': 'Move up',
  'route.moveDown': 'Move down',
  'route.remove': 'Remove',
  'route.add': 'Add route',
  'route.addPlaceholder': 'Pick a model to add…',
  'tab.chains': 'Chains',
  'tab.spawn': 'Spawn',
  'tab.prompt': 'Filter & prompt',
  'spawn.intro': 'Check the parents allowed to spawn this role: main is the primary agent, the rest are role names.',
  'spawn.none': 'No parent is checked — this role cannot be spawned by anyone.',
  'prompt.persona': 'Persona prompt',
  'filter.toolAllow': 'Allowed tools (toolFilter.allow)',
  'filter.systemSections': 'System sections (systemSections)',
  'filter.runtimeContexts': 'Runtime contexts (runtimeContexts)',
  'filter.denyKinds': 'Denied message sources (denyMessageSourceKinds)',
  'filter.tokenPlaceholder': 'Type a token and press Enter…',
  'filter.addToken': 'Add',
  'filter.removeToken': 'Remove',
  'filter.suggestions': 'Suggestions',
  'add.title': 'Add role',
  'add.name': 'Role name',
  'add.namePlaceholder': 'Lowercase letters, digits, hyphens',
  'add.persona': 'Persona prompt',
  'add.template': 'Template role',
  'add.model': 'Initial model',
  'add.modelPlaceholder': 'Pick the initial model…',
  'add.submit': 'Create role',
  save: 'Save',
  saving: 'Saving…',
  revert: 'Revert',
  'status.loading': 'Reading role chains…',
  'status.error': 'Could not read the role matrix: {message}',
  'status.modelsEmpty': 'No models available from settings.yaml; reorder and remove still work.',
  'save.failed': 'Save failed: {message}',
}
