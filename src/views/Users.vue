<script setup lang="ts">
import { ref, computed, h } from 'vue';
import { CzfTable, CzfInput, CzfButton } from '@caf/element-plus-wrapper';
import { ElMessageBox, ElMessage } from 'element-plus';

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  stock: number;
  status: 'on' | 'off';
  createTime: string;
}

const searchKeyword = ref('');
const currentPage = ref(1);
const pageSize = ref(10);

const allProducts = ref<Product[]>([
  {
    id: 1,
    name: 'iPhone 15 Pro Max',
    price: 9999,
    category: '手机',
    stock: 120,
    status: 'on',
    createTime: '2026-01-15',
  },
  {
    id: 2,
    name: 'MacBook Pro 14寸',
    price: 14999,
    category: '笔记本',
    stock: 45,
    status: 'on',
    createTime: '2026-02-20',
  },
  {
    id: 3,
    name: 'AirPods Pro 2',
    price: 1899,
    category: '耳机',
    stock: 200,
    status: 'on',
    createTime: '2026-03-10',
  },
  {
    id: 4,
    name: 'iPad Air',
    price: 4799,
    category: '平板',
    stock: 0,
    status: 'off',
    createTime: '2026-01-28',
  },
  {
    id: 5,
    name: 'Apple Watch Ultra',
    price: 6299,
    category: '手表',
    stock: 78,
    status: 'on',
    createTime: '2026-04-05',
  },
  {
    id: 6,
    name: '华为 Mate 60 Pro',
    price: 6999,
    category: '手机',
    stock: 30,
    status: 'on',
    createTime: '2026-02-14',
  },
  {
    id: 7,
    name: 'Sony WH-1000XM5',
    price: 2499,
    category: '耳机',
    stock: 15,
    status: 'off',
    createTime: '2026-03-22',
  },
  {
    id: 8,
    name: 'ThinkPad X1 Carbon',
    price: 10999,
    category: '笔记本',
    stock: 22,
    status: 'on',
    createTime: '2026-04-18',
  },
  {
    id: 9,
    name: '三星 Galaxy Tab S9',
    price: 5499,
    category: '平板',
    stock: 60,
    status: 'on',
    createTime: '2026-01-08',
  },
  {
    id: 10,
    name: '小米 14 Pro',
    price: 4999,
    category: '手机',
    stock: 150,
    status: 'on',
    createTime: '2026-05-01',
  },
  {
    id: 11,
    name: 'Dell XPS 15',
    price: 12999,
    category: '笔记本',
    stock: 8,
    status: 'on',
    createTime: '2026-03-30',
  },
  {
    id: 12,
    name: 'Garmin Fenix 7',
    price: 5499,
    category: '手表',
    stock: 0,
    status: 'off',
    createTime: '2026-02-28',
  },
]);

const filteredProducts = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();
  if (!keyword) return allProducts.value;
  return allProducts.value.filter(
    (p) => p.name.toLowerCase().includes(keyword) || p.category.toLowerCase().includes(keyword),
  );
});

const total = computed(() => filteredProducts.value.length);

const pagedProducts = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredProducts.value.slice(start, start + pageSize.value);
});

const columns = [
  { id: 'id', prop: 'id', label: 'ID', width: '80px', sortable: true },
  { id: 'name', prop: 'name', label: '商品名称', minWidth: '180px' },
  {
    id: 'price',
    prop: 'price',
    label: '价格',
    width: '140px',
    sortable: true,
  },
  { id: 'category', prop: 'category', label: '分类', width: '120px' },
  {
    id: 'stock',
    prop: 'stock',
    label: '库存',
    width: '100px',
    sortable: true,
  },
  {
    id: 'status',
    prop: 'status',
    label: '状态',
    width: '100px',
  },
  { id: 'createTime', prop: 'createTime', label: '创建时间', width: '140px', sortable: true },
];

const operates = [
  {
    key: 'edit',
    title: '编辑',
    action: (_item: any, row: Product) => {
      onEdit(row);
    },
  },
  {
    key: 'delete',
    title: '删除',
    action: (_item: any, row: Product) => {
      onDelete(row);
    },
  },
];

const onSearch = () => {
  currentPage.value = 1;
};

const onPageChange = (page: number) => {
  currentPage.value = page;
};

const onSizeChange = (size: number) => {
  pageSize.value = size;
  currentPage.value = 1;
};

const onAdd = () => {
  ElMessage.info('新增商品功能待实现');
};

const onEdit = (row: Product) => {
  ElMessage.info(`编辑商品：${row.name}`);
};

const onDelete = (row: Product) => {
  ElMessageBox.confirm(`确定要删除商品"${row.name}"吗？`, '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(() => {
      allProducts.value = allProducts.value.filter((p) => p.id !== row.id);
      ElMessage.success(`已删除商品"${row.name}"`);
    })
    .catch(() => {});
};
</script>

<template>
  <div class="product-container">
    <h2 class="page-title">商品列表</h2>
    <czf-table
      :columns="columns"
      :data="pagedProducts"
      :total="total"
      :currentPage="currentPage"
      :pageSize="pageSize"
      :hasIndex="false"
      background
      height="500px"
      :operates="operates"
      operateWidth="160px"
      stripe
      border
      @current-page-change="onPageChange"
      @size-page-change="onSizeChange"
    >
      <div class="search-bar">
        <czf-input
          v-model="searchKeyword"
          label="关键字"
          placeholder="搜索商品名称或分类"
          :debounce="300"
          @debounceInput="onSearch"
        />
        <czf-button type="primary" @click="onAdd" :is-confirm="true">新增商品</czf-button>
      </div>
    </czf-table>
  </div>
</template>

<style scoped lang="less">
.product-container {
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.page-title {
  margin: 0 0 20px;
  color: #303133;
  font-size: 18px;
  font-weight: 600;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.col-price {
  color: #f56c6c;
  font-weight: 500;
}

.col-stock-zero {
  color: #f56c6c;
  font-weight: 500;
}

.status-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 20px;

  &--on {
    color: #67c23a;
    background: #e1f3d8;
  }

  &--off {
    color: #f56c6c;
    background: #fde2e2;
  }
}
</style>
