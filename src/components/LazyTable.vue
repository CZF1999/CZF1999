<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';
import { getTableData, type QueryParams } from '@/api/table';

/**
 * 表格列配置接口
 */
interface TableColumn {
  prop: string;
  label: string;
  width?: string | number;
  minWidth?: string | number;
  fixed?: boolean | 'left' | 'right';
  sortable?: boolean;
}

/**
 * 组件 Props 定义
 */
const props = defineProps<{
  /**
   * 查询参数，用于获取表格数据
   */
  queryParams: QueryParams;

  /**
   * 表格列配置（可选）
   */
  columns?: TableColumn[];
}>();

// 数据状态
const loading = ref<boolean>(false);
const error = ref<boolean>(false);
const data = ref<any[]>([]);

/**
 * 获取表格数据
 */
const fetchData = async () => {
  // 重置状态
  loading.value = true;
  error.value = false;
  data.value = [];

  try {
    const response = await getTableData(props.queryParams);
    data.value = response.data;
    loading.value = false;
  } catch (err) {
    console.error('获取表格数据失败:', err);
    error.value = true;
    loading.value = false;
  }
};

/**
 * 重试加载
 */
const handleRetry = () => {
  fetchData();
};

// 组件挂载时自动加载数据
onMounted(() => {
  fetchData();
});

// 暴露方法给父组件（可选）
defineExpose({
  refresh: fetchData,
});
</script>

<template>
  <div class="lazy-table" v-bind="$attrs">
    <!-- 加载中状态 - 骨架屏 -->
    <div v-if="loading" class="skeleton-container">
      <div
        v-for="i in 5"
        :key="i"
        class="skeleton-row"
      >
        <div
          v-for="j in (columns?.length || 4)"
          :key="j"
          class="skeleton-cell"
        />
      </div>
    </div>

    <!-- 加载失败状态 -->
    <div v-else-if="error" class="error-container">
      <el-icon class="error-icon"><WarningFilled /></el-icon>
      <p class="error-text">加载失败</p>
      <el-button type="primary" size="small" @click="handleRetry">
        点击重试
      </el-button>
    </div>

    <!-- 数据展示状态 -->
    <el-table v-else :data="data" border stripe>
      <!-- 动态渲染列 -->
      <template v-if="columns && columns.length > 0">
        <el-table-column
          v-for="column in columns"
          :key="column.prop"
          :prop="column.prop"
          :label="column.label"
          :width="column.width"
          :min-width="column.minWidth"
          :fixed="column.fixed"
          :sortable="column.sortable"
        />
      </template>

      <!-- 如果没有定义列，则自动根据数据生成列 -->
      <template v-else-if="data.length > 0">
        <el-table-column
          v-for="(value, key) in data[0]"
          :key="key as string"
          :prop="key as string"
          :label="key as string"
        />
      </template>

      <!-- 空数据状态 -->
      <template #empty>
        <el-empty description="暂无数据" />
      </template>
    </el-table>
  </div>
</template>

<style scoped lang="less">
.lazy-table {
  width: 100%;
  min-height: 200px; // 5行 × 40px
}

// 骨架屏样式
.skeleton-container {
  width: 100%;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
}

.skeleton-row {
  display: flex;
  height: 40px; // 与真实表格行高一致
  border-bottom: 1px solid #ebeef5;

  &:last-child {
    border-bottom: none;
  }
}

.skeleton-cell {
  flex: 1;
  padding: 8px 12px;
  background: linear-gradient(
    90deg,
    #f2f2f2 25%,
    #e6e6e6 50%,
    #f2f2f2 75%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;

  &:not(:last-child) {
    border-right: 1px solid #ebeef5;
  }
}

// 骨架屏闪烁动画
@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

// 错误状态样式
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px; // 5行 × 40px
  color: #909399;

  .error-icon {
    font-size: 48px;
    color: #f56c6c;
    margin-bottom: 12px;
  }

  .error-text {
    margin: 0 0 16px 0;
    font-size: 14px;
  }
}

// 透传属性支持
:deep(.el-table) {
  width: 100%;
}
</style>
