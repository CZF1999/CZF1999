# 懒加载表格系统 - 快速开始

## 🚀 运行项目

```bash
cd projects/czf-project-net
pnpm dev
```

访问 `http://localhost:8000`（或终端显示的端口）

---

## 📁 文件结构

```
src/
├── api/
│   └── table.ts                    # API 封装
├── composables/
│   └── useVisibilityObserver.ts    # 视口监听组合式函数
├── components/
│   ├── LazyTable.vue               # 数据自治表格组件
│   ├── LazyTable.README.md         # LazyTable 说明文档
│   ├── TableLazyWrapper.vue        # 懒加载包装器 ⭐
│   ├── TableLazyWrapper.README.md  # 包装器说明文档 ⭐
│   └── czf-table.vue               # 基础表格组件（旧版）
├── views/
│   └── LazyTableDemo.vue           # 演示页面
└── App.vue                         # 主页面（已更新为懒加载版本）
```

---

## 🎯 核心概念

### **三层架构**

```
App.vue (父页面)
  ↓ 传入配置
TableLazyWrapper.vue (懒加载控制层)
  ↓ 监听视口 + 动态导入
LazyTable.vue (数据管理层)
  ↓ 发起请求
API (数据源)
```

---

## 💡 使用示例

### 1. **在父页面中使用**

```vue
<script setup lang="ts">
import TableLazyWrapper from '@/components/TableLazyWrapper.vue';

// 定义表格配置
const tableConfigs = [
  {
    params: { id: 1, pageSize: 10 },
    estimatedHeight: 300, // 预估高度
  },
  {
    params: { id: 2, pageSize: 10 },
    estimatedHeight: 300,
  },
  // ... 更多表格
];
</script>

<template>
  <TableLazyWrapper
    v-for="(config, index) in tableConfigs"
    :key="index"
    :query-params="config.params"
    :estimated-height="config.estimatedHeight"
  />
</template>
```

---

### 2. **自定义列配置**

如果需要自定义表格列，可以修改 `LazyTable.vue` 的 props：

```vue
<LazyTable
  :query-params="params"
  :columns="[
    { prop: 'id', label: 'ID', width: 80 },
    { prop: 'name', label: '姓名' },
  ]"
/>
```

---

### 3. **调整懒加载阈值**

修改 `TableLazyWrapper.vue` 中的 `rootMargin`：

```typescript
const { isVisible } = useVisibilityObserver(observerTarget, {
  rootMargin: '400px', // 提前 400px 加载（默认 200px）
  threshold: 0,
});
```

---

## 🔍 调试技巧

### 1. **查看网络请求**

打开浏览器开发者工具 → Network 面板，观察：
- 滚动前：只有首屏表格的请求
- 滚动后：新表格的请求陆续出现
- 请求是分散的，不是同时发起

### 2. **查看组件加载**

打开 Performance 面板，录制滚动过程：
- 可以看到 JS chunk 按需加载
- 内存占用平稳增长，不是陡增

### 3. **控制台日志**

在 `LazyTable.vue` 中添加日志：

```typescript
onMounted(() => {
  console.log('LazyTable mounted:', props.queryParams);
  fetchData();
});
```

观察组件挂载的时机。

---

## 🎨 自定义样式

### 修改占位符样式

```less
.placeholder {
  background-color: #f0f9ff; // 改为浅蓝色
  border: 2px solid #409eff; // 改为实线边框
  
  .placeholder-text {
    color: #409eff; // 文字改为蓝色
    font-size: 16px;
  }
}
```

### 修改淡入动画

```less
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95); // 从缩小状态放大
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

---

## ⚙️ 配置选项

### TableLazyWrapper Props

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| queryParams | `Record<string, any>` | ✅ | 查询参数，传递给 API |
| estimatedHeight | `number` | ✅ | 预估高度（像素） |

### useVisibilityObserver Options

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| rootMargin | `string` | `'0px'` | 根元素外边距 |
| threshold | `number` | `0` | 触发阈值（0-1） |

---

## 🐛 常见问题

### Q1: 占位符高度不准确怎么办？

**A:** 根据实际表格内容调整 `estimatedHeight`：

```typescript
// 计算公式
estimatedHeight = 表头高度 + (行数 × 行高) + 边框间距

// 示例：表头40px + 5行×40px + 边框40px = 280px ≈ 300px
```

---

### Q2: 如何预加载即将进入视口的表格？

**A:** 增大 `rootMargin`：

```typescript
// 提前 500px 开始加载
rootMargin: '500px'
```

---

### Q3: 如何实现缓存避免重复请求？

**A:** 在 `LazyTable.vue` 中添加缓存：

```typescript
const cache = new Map<string, any[]>();

const fetchData = async () => {
  const cacheKey = JSON.stringify(props.queryParams);
  
  if (cache.has(cacheKey)) {
    data.value = cache.get(cacheKey)!;
    return;
  }
  
  const response = await getTableData(props.queryParams);
  cache.set(cacheKey, response.data);
  data.value = response.data;
};
```

---

### Q4: 如何在加载完成后执行回调？

**A:** 通过事件传递：

```vue
<!-- TableLazyWrapper.vue -->
<LazyTable
  v-else
  :query-params="queryParams"
  @data-loaded="handleDataLoaded"
/>

<script setup>
const emit = defineEmits(['data-loaded']);

const handleDataLoaded = (data: any[]) => {
  emit('data-loaded', data);
};
</script>
```

---

## 📊 性能监控

### 关键指标

```javascript
// 在浏览器控制台运行

// 1. 查看已加载的表格数量
document.querySelectorAll('.lazy-table-loaded').length

// 2. 查看占位符数量
document.querySelectorAll('.placeholder').length

// 3. 查看总内存占用
performance.memory?.usedJSHeapSize / 1024 / 1024 + ' MB'
```

---

## 🎓 学习路径

1. **理解基础**
   - 阅读 `useVisibilityObserver.ts` - 了解 IntersectionObserver
   - 阅读 `LazyTable.vue` - 了解组件自治

2. **掌握核心**
   - 阅读 `TableLazyWrapper.vue` - 理解懒加载逻辑
   - 阅读 `TableLazyWrapper.README.md` - 深入设计原理

3. **实践优化**
   - 尝试修改 `rootMargin` 观察效果
   - 添加缓存机制
   - 配合虚拟滚动使用

---

## 🔗 相关资源

- [IntersectionObserver API](https://developer.mozilla.org/zh-CN/docs/Web/API/Intersection_Observer_API)
- [Vue 3 异步组件](https://cn.vuejs.org/guide/components/async.html)
- [代码分割](https://vitejs.dev/guide/features.html#code-splitting)

---

## ✨ 下一步

- [ ] 添加无限滚动功能
- [ ] 实现请求取消（AbortController）
- [ ] 添加错误边界处理
- [ ] 集成虚拟滚动库
- [ ] 添加骨架屏变体（图片、卡片等）

---

**祝使用愉快！** 🎉
