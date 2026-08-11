import { useState } from 'react'
import type { FontSize, ContentWidth, LineHeight, ContentFont } from '../components/SettingsDialog'
import type { HelpView } from '../components/HelpDialog'

export function useEditorViewState() {
  const [theme, setTheme] = useState('default')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriter, setTypewriter] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpView, setHelpView] = useState<HelpView>(null)
  const [imagesOpen, setImagesOpen] = useState(false)
  const [autosave, setAutosave] = useState(true)
  const [spellcheck, setSpellcheck] = useState(false)
  const [multiWindow, setMultiWindow] = useState(false)
  const [fontSize, setFontSize] = useState<FontSize>(16)
  const [contentWidth, setContentWidth] = useState<ContentWidth>(900)
  const [lineHeight, setLineHeight] = useState<LineHeight>(1.85)
  const [contentFont, setContentFont] = useState<ContentFont>('default')

  return {
    theme,
    setTheme,
    sidebarCollapsed,
    setSidebarCollapsed,
    focusMode,
    setFocusMode,
    typewriter,
    setTypewriter,
    previewMode,
    setPreviewMode,
    settingsOpen,
    setSettingsOpen,
    helpView,
    setHelpView,
    imagesOpen,
    setImagesOpen,
    autosave,
    setAutosave,
    spellcheck,
    setSpellcheck,
    multiWindow,
    setMultiWindow,
    fontSize,
    setFontSize,
    contentWidth,
    setContentWidth,
    lineHeight,
    setLineHeight,
    contentFont,
    setContentFont,
  }
}
