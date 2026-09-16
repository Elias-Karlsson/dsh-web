/**
 * Russian dictionary for the "subagent-roles" locale namespace.
 * Source package: packages/dsh-subagent-roles (its zh dictionary is the key source).
 * Maintained centrally by the dsh-i18n language pack; when a zh key is added
 * or changed upstream, mirror it here and run `pnpm i18n:check`.
 */

export const ru: Record<string, string> = {
  'nav': 'Роли субагентов',
  'title': 'Матрица ролей субагентов',
  'intro':
    'Каждая роль — это упорядоченная цепочка отката моделей: субагент сначала запрашивает первый маршрут, '
    + 'затем откатывается вниз по списку. Измените порядок, добавьте или удалите маршруты и сохраните — '
    + 'изменение записывается прямо в файл пресета и действует для новых субагентов.',
  'search.placeholder': 'Фильтр ролей, инструментов, моделей…',
  'reload': 'Перезагрузить',
  'saveAll': 'Сохранить все',
  'dirtyCount': 'Не сохранено: {count}',
  'role.emptyChain': 'Цепочка не может быть пустой — оставьте хотя бы один маршрут.',
  'role.delete': 'Удалить роль',
  'role.deleteConfirm':
    'Удалить роль {role}? Ссылки на неё в списках фильтров и в списках родителей других ролей также будут удалены.',
  'route.moveUp': 'Вверх',
  'route.moveDown': 'Вниз',
  'route.remove': 'Удалить',
  'route.add': 'Добавить маршрут',
  'route.addPlaceholder': 'Выберите модель для добавления…',
  'tab.chains': 'Цепочки',
  'tab.spawn': 'Порождение',
  'tab.prompt': 'Фильтр и промпт',
  'spawn.intro': 'Отметьте родителей, которым разрешено порождать эту роль: main — основной агент, остальные — имена ролей.',
  'spawn.none': 'Ни один родитель не отмечен — эту роль не сможет породить никто.',
  'prompt.persona': 'Промпт персоны (persona)',
  'filter.toolAllow': 'Разрешённые инструменты (toolFilter.allow)',
  'filter.systemSections': 'Системные секции (systemSections)',
  'filter.runtimeContexts': 'Контексты выполнения (runtimeContexts)',
  'filter.denyKinds': 'Запрещённые источники сообщений (denyMessageSourceKinds)',
  'filter.tokenPlaceholder': 'Введите токен и нажмите Enter…',
  'filter.addToken': 'Добавить',
  'filter.removeToken': 'Удалить',
  'filter.suggestions': 'Варианты',
  'add.title': 'Новая роль',
  'add.name': 'Имя роли',
  'add.namePlaceholder': 'Строчные буквы, цифры и дефисы',
  'add.persona': 'Промпт персоны',
  'add.template': 'Роль-шаблон',
  'add.model': 'Начальная модель',
  'add.modelPlaceholder': 'Выберите начальную модель…',
  'add.submit': 'Создать роль',
  'save': 'Сохранить',
  'saving': 'Сохранение…',
  'revert': 'Отменить',
  'status.loading': 'Чтение цепочек ролей…',
  'status.error': 'Не удалось прочитать матрицу ролей: {message}',
  'status.modelsEmpty': 'Нет доступных моделей из settings.yaml; изменение порядка и удаление всё ещё работают.',
  'save.failed': 'Ошибка сохранения: {message}',
}
