<script setup lang="ts">
import { useTheme } from '@caf/element-plus-wrapper';
import LazyTable from '@/components/LazyTable.vue';

// 首次调用时注册自定义主题
useTheme([
  { name: 'blue', className: 'theme-blue', label: '蓝色' },
  { name: 'green', className: 'theme-green', label: '绿色' },
  { name: 'orange-dark', className: 'theme-orange-dark', label: '橙色暗黑' },
]);

// 定义列配置
const columns = [
  { prop: 'id', label: 'ID', width: 80, sortable: true },
  { prop: 'name', label: '姓名', minWidth: 120 },
  { prop: 'age', label: '年龄', width: 100, sortable: true },
  { prop: 'address', label: '地址', minWidth: 200 },
];

// 生成20个表格的查询参数
const tableParams = Array.from({ length: 20 }, (_, index) => ({
  tableIndex: index + 1,
  pageSize: 5,
}));
</script>

<template>
  <div class="app-container">
    <h1>LazyTable 组件演示</h1>
    <p class="description">
      以下是20个独立的 LazyTable 组件，每个组件内部自治管理数据请求和状态
    </p>

    <div class="tables-container">
      <div
        v-for="(params, index) in tableParams"
        :key="index"
        class="table-wrapper"
      >
        <h3>表格 {{ index + 1 }}</h3>
        <LazyTable :query-params="params" :columns="columns" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.app-container {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

h1 {
  color: #303133;
  margin-bottom: 10px;
}

.description {
  color: #606266;
  margin-bottom: 30px;
  font-size: 14px;
}

.tables-container {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.table-wrapper {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);

  h3 {
    margin: 0 0 15px 0;
    color: #303133;
    font-size: 16px;
    font-weight: 600;
  }
}
</style>
