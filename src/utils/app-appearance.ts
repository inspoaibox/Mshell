export type AppColorTheme = 'light' | 'dark' | 'auto'
export type AppAppearance = 'modern' | 'terminal' | 'minimal'

const COLOR_THEME_CLASSES = ['dark', 'light-theme']
const APPEARANCE_CLASSES = [
  'app-appearance-modern',
  'app-appearance-terminal',
  'app-appearance-minimal'
]

export function resolveColorTheme(theme: AppColorTheme): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  return theme
}

export function applyColorTheme(theme: AppColorTheme): 'light' | 'dark' {
  const root = document.documentElement
  const resolvedTheme = resolveColorTheme(theme)

  root.classList.remove(...COLOR_THEME_CLASSES)

  if (resolvedTheme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.add('light-theme')
  }

  return resolvedTheme
}

export function normalizeAppearance(appearance?: string): AppAppearance {
  if (appearance === 'minimal') return 'minimal'
  return appearance === 'terminal' ? 'terminal' : 'modern'
}

export function applyAppearance(appearance?: string): AppAppearance {
  const root = document.documentElement
  const normalizedAppearance = normalizeAppearance(appearance)

  root.classList.remove(...APPEARANCE_CLASSES)
  root.classList.add(`app-appearance-${normalizedAppearance}`)

  return normalizedAppearance
}

export function applyAppShellTheme(options?: {
  theme?: AppColorTheme
  appearance?: string
}): { resolvedTheme: 'light' | 'dark'; appearance: AppAppearance } {
  return {
    resolvedTheme: applyColorTheme(options?.theme || 'dark'),
    appearance: applyAppearance(options?.appearance)
  }
}
