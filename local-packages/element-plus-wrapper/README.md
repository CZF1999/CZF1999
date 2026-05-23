# @caf/element-plus-wrapper

对 Element Plus 常用组件的二次封装，提供统一的外观样式与预设行为。

## 安装

```bash
pnpm add @caf/element-plus-wrapper
```

本包将 `element-plus` 和 `vue` 声明为 peerDependencies，请确保项目中已安装。

## 快速开始

### 全量注册

```ts
import { createApp } from 'vue';
import ElementPlusWrapper from '@caf/element-plus-wrapper';
import 'element-plus/dist/index.css';
import '@caf/element-plus-wrapper/dist/style.css';

const app = createApp(App);
app.use(ElementPlusWrapper);
```

### 按需引入

```ts
import { MyButton, MyInput, MyTable } from '@caf/element-plus-wrapper';
```

## 组件说明

### MyButton

| Prop    | 类型     | 默认值      | 说明                         |
|---------|----------|-------------|------------------------------|
| preset  | string   | `'default'` | `primary` / `danger` / `success` / `warning` / `info` / `default` |

固定透传 `el-button` 所有属性、事件与插槽。

**CSS 变量（可按需覆盖）**

| 变量                         | 说明           |
|------------------------------|----------------|
| `--my-btn-primary-bg`        | 主要按钮背景   |
| `--my-btn-primary-border`    | 主要按钮边框   |
| `--my-btn-primary-text`      | 主要按钮文字   |
| `--my-btn-primary-hover-bg`  | 主要按钮悬停   |
| `--my-btn-primary-active-bg` | 主要按钮按下   |
| …（danger / success / warning / info / default 同理） | |

### MyInput

| Prop        | 类型              | 默认值  | 说明     |
|-------------|-------------------|---------|----------|
| modelValue  | `string \| number`| `''`    | v-model  |
| clearable   | boolean           | `true`  | 是否可清空 |
| prefixIcon  | string            | `''`    | 前缀图标类名 |
| suffixIcon  | string            | `''`    | 后缀图标类名 |

固定透传 `el-input` 所有属性、事件与插槽。

**CSS 变量**

| 变量                          | 说明         |
|-------------------------------|--------------|
| `--my-input-bg`               | 背景色       |
| `--my-input-border`           | 边框色       |
| `--my-input-border-focus`     | 聚焦边框色   |
| `--my-input-border-radius`    | 圆角         |
| `--my-input-text`             | 文字颜色     |
| `--my-input-placeholder`      | 占位文字颜色 |

### MyTable

| Prop                  | 类型    | 默认值  | 说明               |
|-----------------------|---------|---------|--------------------|
| stripe                | boolean | `true`  | 斑马纹             |
| border                | boolean | `true`  | 纵向边框           |
| highlightCurrentRow   | boolean | `true`  | 高亮当前行         |

固定透传 `el-table` 所有属性、事件与插槽。

**CSS 变量**

| 变量                         | 说明         |
|------------------------------|--------------|
| `--my-table-header-bg`       | 表头背景色   |
| `--my-table-header-text`     | 表头文字颜色 |
| `--my-table-header-weight`   | 表头字重     |
| `--my-table-row-hover-bg`    | 行悬停背景   |
| `--my-table-stripe-bg`       | 条纹行背景   |
| `--my-table-border-color`    | 边框颜色     |
| `--my-table-text`            | 表体文字颜色 |
| `--my-table-current-row-bg`  | 当前行背景   |

## License

MIT
