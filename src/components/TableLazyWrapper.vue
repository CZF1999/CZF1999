<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { useVisibilityObserver } from '@/composables/useVisibilityObserver';
import type { QueryParams } from '@/api/table';

/**
 * 组件 Props 定义
 */
const props = defineProps<{
  /**
   * 查询参数，传递给 LazyTable
   */
  queryParams: QueryParams;

  /**
   * 预估高度（像素），用于占位
   */
  estimatedHeight: number;
}>();

// 目标元素引用
const observerTarget = ref<HTMLElement | null>(null);

// 使用视口可见性监听
const { isVisible } = useVisibilityObserver(observerTarget, {
  rootMargin: '200px', // 提前 200px 开始加载
  threshold: 0,
});

// 动态导入 LazyTable 组件
const LazyTable = defineAsyncComponent({
  loader: () => import('./LazyTable.vue'),
  loadingComponent: undefined, // 不使用额外的 loading 组件
  delay: 0, // 立即显示
  timeout: 10000, // 10秒超时
});
</script>

<template>
  <div ref="observerTarget" class="table-lazy-wrapper">
    <!-- 未进入视口：显示占位符 -->
    <div
      v-if="!isVisible"
      class="placeholder"
      :style="{ height: `${estimatedHeight}px` }"
    >
      <div class="placeholder-content">
        <span class="placeholder-text">表格加载中...</span>
      </div>
    </div>

    <!-- 已进入视口：动态加载 LazyTable -->
    <LazyTable
      v-else
      :query-params="queryParams"
      class="lazy-table-loaded"
    />
  </div>
</template>

<style scoped lang="less">
.table-lazy-wrapper {
  width: 100%;
}

// 占位符样式
.placeholder {
  width: 100%;
  background-color: #f5f7fa;
  border: 1px dashed #dcdfe6;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;

  .placeholder-content {
    text-align: center;
  }

  .placeholder-text {
    color: #909399;
    font-size: 14px;
  }
}

// 已加载的表格
.lazy-table-loaded {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
