<script setup lang="ts">
import type { ElTable } from 'element-plus';

type TableData = Record<string, any>;

interface ColumnConfig {
  prop: string;
  label: string;
  width?: string | number;
  minWidth?: string | number;
  fixed?: boolean | 'left' | 'right';
  sortable?: boolean;
}

interface Props {
  data?: TableData[];
  columns?: ColumnConfig[];
  loading?: boolean;
  height?: string | number;
  maxHeight?: string | number;
  border?: boolean;
  stripe?: boolean;
  highlightCurrentRow?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  data: () => [],
  columns: () => [],
  loading: false,
  border: true,
  stripe: true,
  highlightCurrentRow: true,
});

const emit = defineEmits<{
  (e: 'row-click', row: TableData, column: any, event: Event): void;
  (e: 'selection-change', selection: TableData[]): void;
  (e: 'current-change', currentRow: TableData | null, oldCurrentRow: TableData | null): void;
}>();

// 处理行点击事件
const handleRowClick = (row: TableData, column: any, event: Event) => {
  emit('row-click', row, column, event);
};

// 处理选择变化事件
const handleSelectionChange = (selection: TableData[]) => {
  emit('selection-change', selection);
};

// 处理当前行变化事件
const handleCurrentChange = (currentRow: TableData | null, oldCurrentRow: TableData | null) => {
  emit('current-change', currentRow, oldCurrentRow);
};
</script>

<template>
  <el-table
    :data="data"
    :loading="loading"
    :height="height"
    :max-height="maxHeight"
    :border="border"
    :stripe="stripe"
    :highlight-current-row="highlightCurrentRow"
    @row-click="handleRowClick"
    @selection-change="handleSelectionChange"
    @current-change="handleCurrentChange"
  >
    <!-- 动态渲染列 -->
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

    <!-- 如果没有定义列，则自动根据数据生成列 -->
    <template v-if="columns.length === 0 && data.length > 0">
      <el-table-column
        v-for="(value, key) in data[0]"
        :key="key as string"
        :prop="key as string"
        :label="key as string"
      />
    </template>
  </el-table>
</template>

<style scoped lang="less">
:deep(.el-table) {
  width: 100%;

  .el-table__header {
    th {
      background-color: #f5f7fa;
      color: #606266;
      font-weight: 600;
    }
  }

  .el-table__body {
    tr:hover > td {
      background-color: #f5f7fa !important;
    }
  }
}
</style>
