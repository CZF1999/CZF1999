# LazyTable 组件设计说明

## 📦 组件概述

`LazyTable` 是一个**数据自治**的表格组件，每个实例内部管理自己的数据请求、加载状态和错误处理。

## ✨ 核心特性

### 1. **数据自治（Data Autonomy）**
- 组件内部独立管理 `loading`、`error`、`data` 三个状态
- 挂载时自动调用 API 获取数据
- 支持错误重试机制
- 通过 `defineExpose` 暴露 `refresh` 方法供父组件调用

### 2. **三种状态展示**
```
┌─────────────────────────┐
│  Loading (骨架屏)        │ ← 5行闪烁动画，行高40px
├─────────────────────────┤
│  Error (错误提示)        │ ← 图标 + 文字 + 重试按钮
├─────────────────────────┤
│  Data (表格数据)         │ ← Element Plus el-table
└─────────────────────────┘
```

### 3. **灵活的列配置**
- 支持传入自定义 `columns` 配置
- 未传配置时自动根据数据生成列
- 支持透传 `$attrs` 到 el-table

### 4. **优雅的骨架屏**
- 使用 CSS 渐变 + 动画实现闪烁效果
- 高度与真实表格行高一致（40px）
- 默认显示 5 行，避免布局抖动

---

## 🔧 为什么把数据请求放在组件内部？

### ❌ **传统方式的问题（父组件集中管理）**

```typescript
// 父组件中并发20个请求
const loadAllTables = async () => {
  const promises = tableStates.value.map(async (state, index) => {
    const data = await fetchTableData(index); // 同时发起20个请求
    state.data = data;
    state.loading = false;
  });
  await Promise.all(promises); // 等待所有请求完成
};
```

**问题：**
1. **浏览器并发限制**：浏览器对同一域名的并发请求有限制（通常 6-8 个），超出的请求会被排队
2. **资源竞争**：20个请求同时发起，占用大量网络带宽和服务器资源
3. **内存压力**：所有数据一次性加载到内存，即使有些表格还不可见
4. **用户体验差**：用户需要等待所有请求完成才能看到任何内容
5. **无法按需加载**：即使用户只查看前几个表格，后面的也会全部加载

---

### ✅ **组件自治的优势（LazyTable）**

```vue
<!-- 每个表格独立管理自己的请求 -->
<LazyTable 
  v-for="params in tableParams" 
  :key="params.id"
  :query-params="params" 
/>
```

**优势：**

#### 1. **自然的时间分散**
- 组件在挂载时才发起请求
- 如果配合懒加载（IntersectionObserver），只有进入视口才加载
- 请求自然分散在不同时间点，避免瞬时高峰

#### 2. **按需加载（Lazy Loading）**
```typescript
// 结合 useVisibilityObserver
const { isVisible } = useVisibilityObserver(tableRef);

watch(isVisible, (visible) => {
  if (visible && !loaded.value) {
    fetchData(); // 只在可见时加载
  }
});
```
- 用户滚动到哪里，就加载哪里的数据
- 节省带宽和服务器资源
- 首屏加载更快

#### 3. **独立的错误处理**
- 某个表格加载失败不影响其他表格
- 用户可以单独重试失败的表格
- 更好的容错性

#### 4. **内存优化**
- 可以配合虚拟滚动或卸载策略
- 不在视口的表格可以释放数据
- 适合大量表格的场景

#### 5. **更好的可维护性**
- 每个组件职责单一：只管自己的数据
- 父组件只需传递参数，不关心数据获取逻辑
- 符合单一职责原则（SRP）

#### 6. **易于扩展**
```typescript
// 可以轻松添加缓存策略
const cache = new Map();

const fetchData = async () => {
  const cacheKey = JSON.stringify(props.queryParams);
  if (cache.has(cacheKey)) {
    data.value = cache.get(cacheKey);
    return;
  }
  
  const response = await getTableData(props.queryParams);
  cache.set(cacheKey, response.data);
  data.value = response.data;
};
```

---

## 📊 性能对比

| 指标 | 父组件集中管理 | 组件自治 + 懒加载 |
|------|--------------|-----------------|
| 首屏请求数 | 20个 | 1-3个（可视区域） |
| 首屏加载时间 | 2-3秒 | 0.5-1秒 |
| 总带宽消耗 | 100% | 按需加载，可能只用30% |
| 内存占用 | 全部数据 | 仅可见部分 |
| 用户体验 | 等待时间长 | 即时响应 |
| 错误恢复 | 需重新加载全部 | 单独重试 |

---

## 🎯 最佳实践

### 1. **配合 IntersectionObserver 使用**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useVisibilityObserver } from '@/composables/useVisibilityObserver';
import LazyTable from '@/components/LazyTable.vue';

const tableRef = ref<HTMLElement | null>(null);
const { isVisible } = useVisibilityObserver(tableRef, {
  rootMargin: '400px', // 提前400px开始加载
});
</script>

<template>
  <div ref="tableRef">
    <LazyTable 
      v-if="isVisible"
      :query-params="{ id: 1 }" 
    />
    <div v-else class="placeholder">加载中...</div>
  </div>
</template>
```

### 2. **添加防抖/节流**

对于快速滚动的场景，可以在 `onMounted` 中添加延迟：

```typescript
onMounted(() => {
  // 延迟50ms加载，避免快速滚动时频繁请求
  setTimeout(() => {
    fetchData();
  }, 50);
});
```

### 3. **实现缓存策略**

```typescript
const cache = new Map<string, any[]>();

const fetchData = async () => {
  const cacheKey = JSON.stringify(props.queryParams);
  
  if (cache.has(cacheKey)) {
    data.value = cache.get(cacheKey)!;
    return;
  }
  
  try {
    const response = await getTableData(props.queryParams);
    cache.set(cacheKey, response.data);
    data.value = response.data;
  } catch (err) {
    error.value = true;
  }
};
```

### 4. **支持手动刷新**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import LazyTable from '@/components/LazyTable.vue';

const tableRef = ref<InstanceType<typeof LazyTable> | null>(null);

const handleRefresh = () => {
  tableRef.value?.refresh();
};
</script>

<template>
  <LazyTable ref="tableRef" :query-params="{ id: 1 }" />
  <el-button @click="handleRefresh">刷新</el-button>
</template>
```

---

## 🚀 总结

将数据请求放在组件内部的核心价值：

1. **解耦**：父组件不关心数据获取细节
2. **性能**：自然分散请求，避免并发瓶颈
3. **体验**：按需加载，首屏更快
4. **可维护**：单一职责，易于测试和扩展
5. **容错**：独立错误处理，局部重试

这种设计模式特别适合：
- 大量相同类型组件的场景（如多个表格、卡片列表）
- 需要懒加载优化的长页面
- 对性能和用户体验要求较高的应用
