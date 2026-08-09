import { useState, useRef, useEffect } from 'react'

interface ThemeSwitcherProps {
  currentTheme: string
  onThemeChange: (theme: string) => void
}

const THEMES = [
  { id: 'default', name: '暖白', color: '#F7F5F2' },
  { id: 'dark', name: '墨夜', color: '#171614' },
  { id: 'ocean', name: '海雾', color: '#EFF4F9' },
  { id: 'rose', name: '玫砂', color: '#FBF5F3' },
]

export function ThemeSwitcher({ currentTheme, onThemeChange }: ThemeSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="theme-switcher" ref={ref}>
      <div className="act-btn" onClick={() => setOpen(!open)} title="切换主题">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </div>
      <div className={`theme-dd ${open ? 'show' : ''}`}>
        <div className="theme-dd-label">选择主题</div>
        {THEMES.map((t) => (
          <div
            key={t.id}
            className={`theme-opt ${currentTheme === t.id ? 'on' : ''}`}
            onClick={() => {
              onThemeChange(t.id)
              setOpen(false)
            }}
          >
            <span className="t-swatch" style={{ background: t.color }} />
            {t.name}
          </div>
        ))}
      </div>
    </div>
  )
}
