/**
 * Locale bundles for the subagent role matrix settings section. zh is the
 * source of truth; en mirrors the key set, and the ru mirror lives in
 * dsh-i18n (key-set parity is gated by pnpm i18n:check).
 */

/** Copy keys the role matrix reads. */
export type SubagentRolesKey =
  | 'nav' | 'title' | 'intro' | 'search.placeholder'
  | 'reload' | 'saveAll' | 'dirtyCount'
  | 'role.emptyChain'
  | 'route.moveUp' | 'route.moveDown' | 'route.remove' | 'route.add' | 'route.addPlaceholder'
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
  'route.moveUp': '上移',
  'route.moveDown': '下移',
  'route.remove': '移除',
  'route.add': '添加路由',
  'route.addPlaceholder': '选择要添加的模型…',
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
  'route.moveUp': 'Move up',
  'route.moveDown': 'Move down',
  'route.remove': 'Remove',
  'route.add': 'Add route',
  'route.addPlaceholder': 'Pick a model to add…',
  save: 'Save',
  saving: 'Saving…',
  revert: 'Revert',
  'status.loading': 'Reading role chains…',
  'status.error': 'Could not read the role matrix: {message}',
  'status.modelsEmpty': 'No models available from settings.yaml; reorder and remove still work.',
  'save.failed': 'Save failed: {message}',
}
