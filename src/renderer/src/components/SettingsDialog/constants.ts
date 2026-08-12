export const THEMES = [
  { id: 'default', name: '暖白', color: '#F7F5F2', desc: '经典暖色调' },
  { id: 'dark', name: '墨夜', color: '#171614', desc: '深邃暗色' },
  { id: 'ocean', name: '海雾', color: '#EFF4F9', desc: '冷调蓝灰' },
  { id: 'rose', name: '玫砂', color: '#FBF5F3', desc: '温暖粉棕' },
]

export const FONT_PRESETS: { label: string; value: number }[] = [
  { label: '小', value: 14 },
  { label: '标准', value: 16 },
  { label: '大', value: 18 },
]

export const WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: '窄', value: 640 },
  { label: '标准', value: 900 },
  { label: '宽', value: 1200 },
]

export const LINE_PRESETS: { label: string; value: number }[] = [
  { label: '紧凑', value: 1.65 },
  { label: '标准', value: 1.85 },
  { label: '宽松', value: 2.1 },
]

export const CONTENT_FONT_OPTIONS: { id: 'default' | 'serif' | 'mono'; label: string }[] = [
  { id: 'default', label: '默认' },
  { id: 'serif', label: '衬线' },
  { id: 'mono', label: '等宽' },
]

/** 拼写检查可选语言（Electron/Chromium 内置词典，不含中文） */
export const SPELL_LANG_OPTIONS: { id: string; label: string }[] = [
  { id: 'en-US', label: '英语（美）' },
  { id: 'en-GB', label: '英语（英）' },
  { id: 'fr-FR', label: '法语' },
  { id: 'de-DE', label: '德语' },
  { id: 'es-ES', label: '西班牙语' },
  { id: 'it-IT', label: '意大利语' },
  { id: 'pt-BR', label: '葡萄牙语' },
  { id: 'nl-NL', label: '荷兰语' },
  { id: 'ru-RU', label: '俄语' },
]

export const NAV_ITEMS = [
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑器' },
  { id: 'shortcuts', label: '快捷键' },
]
