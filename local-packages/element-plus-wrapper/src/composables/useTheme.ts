import { ref, computed } from 'vue';

const STORAGE_KEY = 'czf-theme';

export interface ThemeDef {
  name: string;
  /** CSS class name added to <html>, empty string for default light theme */
  className: string;
  /** Optional display label */
  label?: string;
}

const BUILTIN_THEMES: ThemeDef[] = [
  { name: 'light', className: '', label: '浅色' },
  { name: 'dark', className: 'dark', label: '深色' },
];

function getSavedTheme(all: ThemeDef[]): ThemeDef {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const match = all.find((t) => t.name === saved);
    if (match) return match;
  }
  // fallback to system preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return all.find((t) => t.name === (prefersDark ? 'dark' : 'light')) || all[0];
}

let sharedState: ReturnType<typeof createThemeManager> | null = null;

function createThemeManager(customThemes?: ThemeDef[]) {
  const allThemes = [...BUILTIN_THEMES, ...(customThemes || [])];
  const initial = getSavedTheme(allThemes);

  const current = ref<ThemeDef>(initial);

  // apply initial class
  if (initial.className) {
    document.documentElement.classList.add(initial.className);
  }
  localStorage.setItem(STORAGE_KEY, initial.name);

  const isDark = computed(() => current.value.name === 'dark');

  function setTheme(name: string) {
    const next = allThemes.find((t) => t.name === name);
    if (!next) {
      console.warn(`[useTheme] Unknown theme "${name}". Available: ${allThemes.map((t) => t.name).join(', ')}`);
      return;
    }
    if (next.name === current.value.name) return;

    // remove old class
    const prev = current.value;
    if (prev.className) {
      document.documentElement.classList.remove(prev.className);
    }

    // add new class
    if (next.className) {
      document.documentElement.classList.add(next.className);
    }

    localStorage.setItem(STORAGE_KEY, next.name);
    current.value = next;
  }

  /** Toggle between light and dark (convenience). */
  function toggle() {
    setTheme(isDark.value ? 'light' : 'dark');
  }

  return {
    currentTheme: computed(() => current.value),
    themes: allThemes,
    isDark,
    setTheme,
    toggle,
  };
}

/**
 * Shared theme manager (singleton).
 * @param customThemes  Additional themes beyond the built-in light/dark.
 *                      Example: `[{ name: 'blue', className: 'theme-blue', label: '蓝色' }]`
 *
 * Define custom theme styles in your app's CSS:
 * ```css
 * html.theme-blue {
 *   --el-color-primary: #1890ff;
 * }
 * ```
 */
export function useTheme(customThemes?: ThemeDef[]) {
  if (!sharedState) {
    sharedState = createThemeManager(customThemes);
  }
  return sharedState;
}
