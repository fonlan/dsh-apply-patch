/**
 * Locale dictionaries for the apply-patch settings card.
 */
export const LOCALE_NS = 'settings.applyPatch'

export const zh = {
  nav: 'Apply Patch',
  settingsTitle: 'Apply Patch 工具',
  settingsCardDescription: '为模型注入 codex 风格的 apply_patch 工具（通过 DSH 沙盒执行写入）',
  modeLabel: '注入范围',
  modeOff: '关闭',
  modeGptOnly: '仅GPT模型',
  modeAll: '所有模型',
  modeHint: '关闭：完全不注入 apply_patch；仅GPT模型：只对 gpt- 开头的模型注入；所有模型：对所有模型注入。',
  saving: '保存中…',
  saved: '已保存',
  saveFailed: '保存失败：{message}',
  readOnly: '当前部署为只读，无法修改配置。',
  expand: '展开',
  collapse: '折叠',
} as const

export const en = {
  nav: 'Apply Patch',
  settingsTitle: 'Apply Patch Tool',
  settingsCardDescription: 'Inject the codex-style apply_patch tool for models (writes go through the DSH sandbox)',
  modeLabel: 'Injection scope',
  modeOff: 'Off',
  modeGptOnly: 'GPT models only',
  modeAll: 'All models',
  modeHint: 'Off: never inject apply_patch. GPT models only: inject only for models whose id starts with gpt-. All models: inject for every model.',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'Failed to save: {message}',
  readOnly: 'This deployment is read-only; configuration cannot be changed.',
  expand: 'Expand',
  collapse: 'Collapse',
} as const
