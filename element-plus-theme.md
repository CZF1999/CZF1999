# Element Plus 主题切换实现说明

## 一句话概括

本项目主题切换的本质是：**给 `<html>` 换 CSS class，用 CSS 变量覆盖 Element Plus 的颜色变量**。

整体分四层：

1. Element Plus 原生变量（组件颜色的唯一来源）
2. `useTheme` 组合式函数（class 增删 + 持久化 + 初始化）
3. 自定义主题样式（用 `html.theme-xxx` 覆盖变量）
4. 完整切换链路（一次 `setTheme` 发生了什么）

---

## 1. 底层：Element Plus 本身就是用 CSS 变量驱动的

`src/main.ts` 引入两套样式：

```ts
import 'element-plus/dist/index.css'                 // 定义 :root 下的 --el-color-primary 等变量
import 'element-plus/theme-chalk/dark/css-vars.css'  // 定义 html.dark 下的暗色变量
```

Element Plus 的所有组件颜色都读取 `--el-*` 变量。它自带的暗黑模式就是靠给 `<html>` 加 `dark` class 来触发的（`html.dark { --el-bg-color: ... }` 覆盖掉亮色值）。

## 2. 中层：`useTheme` 组合式函数管理 class 的增删

文件：`packages/element-plus-wrapper/src/composables/useTheme.ts`（源码） / `projects/czf-project-net/local-packages/element-plus-wrapper/src/composables/useTheme.ts`（本地包）。

核心只做三件事：

### 注册主题表

```ts
export interface ThemeDef {
  name: string;
  /** 挂到 <html> 上的 CSS class，空字符串代表默认亮色 */
  className: string;
  label?: string;
}

const BUILTIN_THEMES: ThemeDef[] = [
  { name: 'light', className: '', label: '浅色' },
  { name: 'dark', className: 'dark', label: '深色' },
];
```

内置 `light`（无 class）和 `dark`（class=`dark`），外加调用方传入的 `customThemes` 合并成 `allThemes`。

### 切换主题 `setTheme(name)`

```ts
function setTheme(name: string) {
  const next = allThemes.find((t) => t.name === name);
  if (!next) {
    console.warn(`[useTheme] Unknown theme "${name}". Available: ${allThemes.map((t) => t.name).join(', ')}`);
    return;
  }
  if (next.name === current.value.name) return;

  // 移除旧 class
  const prev = current.value;
  if (prev.className) document.documentElement.classList.remove(prev.className);
  // 添加新 class
  if (next.className) document.documentElement.classList.add(next.className);

  localStorage.setItem(STORAGE_KEY, next.name);
  current.value = next;
}
```

### 初始化

启动时优先读 `localStorage`（key 为 `czf-theme`）里上次保存的主题，没有则跟随系统 `prefers-color-scheme`。

## 3. 上层：自定义主题用 CSS class 覆盖变量

文件：`src/assets/themes.css`。

每段只做一件事——重设 `--el-*` 变量：

```css
html.theme-green {
  --el-color-primary: #389e0d;
  --el-color-primary-light-3: #5bb72f;
  /* ... */
  color-scheme: light;
}

html.theme-orange-dark {
  --el-color-primary: #fa8c16;
  /* ... */
  --el-bg-color: #141414;
  /* ... */
  color-scheme: dark;
}
```

因为 class 挂在 `<html>`（即 `documentElement`）上，而 `html.theme-xxx` 的优先级高于 `:root`，所以能覆盖 Element Plus 默认色。

## 4. 完整链路：一次 `setTheme('green')` 发生了什么

```
setTheme('green')
  → allThemes 中找到 { name:'green', className:'theme-green' }
  → html 移除旧 class（如 dark），加上 theme-green
  → html.theme-green 的 --el-* 变量生效
  → 所有使用 --el-color-primary 的 Element Plus 组件自动变色
  → localStorage.setItem('czf-theme','green')，刷新后仍保持绿色
```

---

## 关键点总结

| 环节 | 作用 | 文件 |
|------|------|------|
| Element Plus 原生变量 | 组件颜色的唯一来源 | `element-plus/dist/index.css` + `dark/css-vars.css` |
| `useTheme` 单例 | class 增删 + 持久化 + 初始化 | `useTheme.ts` |
| 自定义主题样式 | 用 `html.theme-xxx` 覆盖变量 | `src/assets/themes.css` |

`dark` 之所以“免费”能用，是因为它直接复用了 Element Plus 官方暗黑变量；而 `green` / `blue` / `orange-dark` 都是项目自己在 `themes.css` 里手写的覆盖。

---

## 常见问题

### `setTheme` 报 `Unknown theme "green"`

原因：`green`、`orange-dark` 等并非内置主题（内置只有 `light` / `dark`），class 虽然在 `themes.css` 里写好了，但没有注册进 `useTheme` 的 `allThemes`，所以 `setTheme` 找不到、直接 warning 返回。

解决：在应用入口首次调用 `useTheme` 时传入自定义主题（`useTheme` 是单例，只有**第一次**调用时的参数会生效）：

```ts
import { useTheme } from '@caf/element-plus-wrapper';

useTheme([
  { name: 'green', className: 'theme-green', label: '绿色' },
  { name: 'blue', className: 'theme-blue', label: '蓝色' },
  { name: 'orange-dark', className: 'theme-orange-dark', label: '橙深色' },
]);
```

> 注意：务必保证带参的 `useTheme([...])` 是项目里第一个被调用的（放 `main.ts` 最前面），否则首页等处的无参 `useTheme()` 会先创建单例，后续带参调用被忽略。

---

## 新增一个自定义主题的步骤

1. 在 `src/assets/themes.css` 增加一段 `html.theme-xxx { --el-*: ...; }`。
2. 在入口 `useTheme([...])` 里注册 `{ name: 'xxx', className: 'theme-xxx', label: '...' }`。
3. 业务代码中调用 `setTheme('xxx')`。
