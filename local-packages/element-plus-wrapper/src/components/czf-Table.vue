<!-- TaskTable.vue -->
<template>
  <div class="flex flex-col">
    <slot name="default" />
    <div class="flex-1 relative">
      <el-table
        ref="tableRef"
        v-bind="computedTableAttrs"
        :data="data"
        :highlight-current-row="true"
        :header-cell-style="{
          background: 'var(--el-fill-color-light)',
          fontWeight: '600',
          color: 'var(--el-text-color-primary)',
        }"
        :height="computeHeight"
        :loading="loading"
        border
        @row-click="handleRowClick"
      >
        <!-- 单选列 -->
        <el-table-column
          v-if="selectType === 'single'"
          width="60"
          label="选择"
          :fixed="defaultFixed.includes('select') ? 'left' : false"
        >
          <template #default="{ row }">
            <el-radio
              :model-value="curRow?.[singleKey]"
              :label="row[singleKey]"
              @change="onSingleSelectionChange(row)"
            >
              {{ "" }}
            </el-radio>
          </template>
        </el-table-column>

        <!-- 多选列 -->
        <el-table-column
          v-if="selectType === 'multi'"
          type="selection"
          :selectable="selectable"
          :fixed="defaultFixed.includes('select') ? 'left' : false"
        />

        <!-- 拖拽列 -->
        <el-table-column
          v-if="draggable"
          width="40"
          :fixed="defaultFixed.includes('drag') ? 'left' : false"
        >
          <template #default>
            <div class="out_drag_btn cursor-move">
              <JatIcon icon-name="icon-icon-move" className="move-icon" />
            </div>
          </template>
        </el-table-column>

        <!-- 序号列（带分页） -->
        <el-table-column
          v-if="hasIndex && hasPage"
          type="index"
          label="序号"
          width="80"
          :fixed="defaultFixed.includes('index') ? 'left' : false"
        >
          <template #default="{ row, $index }">
            {{
              row.CUSTOM_INDEX ||
              (currentPage - 1) * pageSize +
                ($index + 1)
            }}
          </template>
        </el-table-column>

        <!-- 序号列（无分页） -->
        <el-table-column
          v-if="hasIndex && !hasPage"
          type="index"
          label="序号"
          width="80"
          :fixed="defaultFixed.includes('index') ? 'left' : false"
        />

        <!-- 操作列 -->
        <el-table-column
          v-if="operates"
          label="操作"
          :width="operateWidth"
          :fixed="defaultFixed.includes('operate') ? 'left' : false"
        >
          <template #default="{ row }">
            <template v-if="!showOperates(row).length">——</template>
            <ListOperate v-else :operates="showOperates(row)" :curRow="row" />
          </template>
        </el-table-column>

        <!-- 动态业务列（保持原有） -->
        <el-table-column
          v-for="c in columns"
          :key="c.id"
          :prop="c.prop"
          :label="c.label"
          :width="c.width"
          :min-width="c.minWidth"
          :align="c.align || 'left'"
          :show-overflow-tooltip="c.showOverflowTooltip !== false"
          :sortable="c.sortable ? 'custom' : false"
          :formatter="
            (row, column, cellValue, index) =>
              c.render ? c.render(row, column, cellValue, index) : cellValue
          "
        >
          <template #default="{ row, column, $index }">
            <slot
              v-if="c.renderName"
              :name="c.renderName"
              :row="row"
              :column="column"
              :index="$index"
            />
            <span v-else>
              {{
                c.render
                  ? c.render(row, column, row[c.prop], $index)
                  : row[c.prop]
              }}
            </span>
          </template>
          <template #header="{ column }">
            {{ column.label }}
            <template v-if="c.hasContext">
              <el-tooltip
                popper-class="hasContextMenuIconTooltip"
                effect="light"
                placement="right"
                :visible-arrow="false"
                content="本列数据支持右键操作"
              >
                <span class="hasContextMenuIcon"></span>
              </el-tooltip>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-pagination
      v-if="hasPage"
      v-bind="computedPaginationAttrs"
      :total="total"
      :page-size="pageSize"
      :current-page="currentPage"
      layout="sizes,total, ->,  prev, pager, next, jumper"
      @current-change="onCurrentChange"
      @size-change="onSizeChange"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 自驱动表格组件，通过 `columns` 配置列，禁止手写 el-table-column。
 * 内置单选/多选、行拖拽排序、分页、序号列、操作列、右键提示列头、
 * 动态高度计算及 loading 态。其余属性通过 $attrs 智能分流透传至 el-table 与 el-pagination。
 */
import { ref, computed, watch, onMounted, nextTick, useAttrs } from "vue";
import {
  ElTable,
  ElTableColumn,
  ElPagination,
  ElRadio,
  ElTooltip,
} from "element-plus";
import Sortable from "sortablejs";
import ListOperate from "./czf-ListOperate.vue";
import JatIcon from "./czf-Icon.vue";

defineOptions({ name: 'CzfTable' });

// ------------------------------------------------------------------
// Props 定义 —— 将需要暴露给父组件的外部特性全部声明在这里
// ------------------------------------------------------------------
interface Props {
  columns: any[];
  data: any[];
  total?: number;
  pageSize?: number;

  height?: string | number;
  operates?: any[] | ((scope: any) => any[]);
  selectType?: "none" | "single" | "multi";
  selectable?: (row: any) => boolean;
  draggable?: boolean;
  singleKey?: string;
  loading?: boolean;
  hasPage?: boolean;
  hasIndex?: boolean;
  isTableAbsolute?: boolean;
  operateWidth?: string;
  selectedSingleRow?: Record<string, any>;
  isAuto?: boolean;
  defaultFixed?: string[];
  currentPage?: number;

  // 新增：明确分页常用透传属性，避免进入 $attrs 并传给 el-table
  layout?: string;
  background?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  columns: () => [],
  data: () => [],
  total: 0,
  pageSize: 50,
  height: "",
  operates: undefined,
  selectType: "none",
  selectable: () => true,
  draggable: false,
  singleKey: "",
  loading: false,
  hasPage: true,
  hasIndex: true,
  isTableAbsolute: false,
  operateWidth: "200px",
  selectedSingleRow: undefined,
  isAuto: false,
  defaultFixed: () => ["select", "index", "operate", "drag"],
  currentPage: 1,
  layout: "sizes,total, ->, prev, pager, next, jumper",
  background: false,
});

// ------------------------------------------------------------------
// Emits 定义 —— 组件对外抛出的事件
// ------------------------------------------------------------------
const emit = defineEmits<{
  (e: "current-page-change", curPage: number): void;
  (e: "size-page-change", curSize: number): void;
  (e: "selection-change", selection: any[]): void;
  (e: "single-selection-change", selection: any): void;
  (e: "onDraggableEnd", dragInfo: any): void;
}>();

// ------------------------------------------------------------------
// 透传处理 —— 基于 Vue 3 统一透传思路
// ------------------------------------------------------------------
const attrs = useAttrs(); // 包含所有未被 props/emits 声明的属性和事件

/**
 * 我们需要将 $attrs 透传给 el-table，
 * 但为了安全，额外过滤掉那些明确属于分页或本组件独有的属性。
 * （这些属性理论上已在 props/emits 中定义，不应出现在 $attrs 中，
 *   但若父组件误传了驼峰/短横线变体，这里可以兜底。）
 */
const PAGINATION_ATTR_KEYS = new Set([
  "total",
  "pageSize",
  "currentPage",
  "layout",
  "background",
  "small",
  "pageSizes",
  "prevText",
  "nextText",
  "onCurrentPageChange",
  "onSizePageChange",
  "onUpdate:currentPage",
  "onUpdate:pageSize",
]);

const computedTableAttrs = computed(() => {
  const filtered: Record<string, any> = {};
  for (const key in attrs) {
    if (!PAGINATION_ATTR_KEYS.has(key)) {
      filtered[key] = attrs[key];
    }
  }
  return filtered;
});

/**
 * 分页组件需要接收的透传属性（例如 layout, background 等），
 * 这里直接从 props 中取出，若未来想支持更灵活的分页属性，可扩展数组。
 */
const PAGINATION_PROP_KEYS = [
  "layout",
  "background",
  "small",
  "pageSizes",
  "prevText",
  "nextText",
];
const computedPaginationAttrs = computed(() => {
  const paginationAttrs: Record<string, any> = {};
  for (const key of PAGINATION_PROP_KEYS) {
    if (key in props) {
      paginationAttrs[key] = (props as any)[key];
    }
  }
  // 同时允许 attrs 中携带的其他分页属性（未声明为 prop 但希望透传）
  for (const key in attrs) {
    if (PAGINATION_PROP_KEYS.includes(key) && !(key in props)) {
      paginationAttrs[key] = attrs[key];
    }
  }
  return paginationAttrs;
});

// 这样 el-table 使用 v-bind="computedTableAttrs" 即可包含所有外部传入的表格属性和事件（如 row-click, selection-change 等）
// el-pagination 使用 v-bind="computedPaginationAttrs" 只接收分页相关的额外属性

// ------------------------------------------------------------------
// 高度计算（保持不变）
// ------------------------------------------------------------------
const rowHeight = 43;
const computeHeight = ref<string | number>("auto");
watch(
  () => [props.total, props.height, props.isAuto],
  ([total, height, isAuto]) => {
    if (height) {
      computeHeight.value = height as string;
    } else if (isAuto) {
      computeHeight.value = total
        ? Math.min(props.pageSize, total as number) * rowHeight + 52 + "px"
        : "auto";
    } else {
      computeHeight.value = "60%";
    }
  },
  { immediate: true }
);

// ------------------------------------------------------------------
// 单选逻辑（保持不变）
// ------------------------------------------------------------------
const curRow = ref<Record<string, any> | undefined>(props.selectedSingleRow);
watch(
  () => props.selectedSingleRow,
  (val) => {
    curRow.value = val;
  }
);
const onSingleSelectionChange = (row: any) => {
  curRow.value = row;
  emit("single-selection-change", row);
};

// 多选行点击切换
const tableRef = ref<InstanceType<typeof ElTable>>();
const handleRowClick = (row: any) => {
  if (props.selectType === "multi") {
    tableRef.value?.toggleRowSelection(row);
  }
};

// ------------------------------------------------------------------
// 操作列动态渲染（保持不变）
// ------------------------------------------------------------------
const showOperates = (scope: any) => {
  if (typeof props.operates === "function") {
    return props.operates(scope);
  }
  return props.operates || [];
};

// ------------------------------------------------------------------
// 分页事件转发（保持不变）
// ------------------------------------------------------------------
const currentPage = ref(props.currentPage);
watch(
  () => props.currentPage,
  (val) => {
    currentPage.value = val;
  }
);
const onCurrentChange = (page: number) => {
  currentPage.value = page;
  emit("current-page-change", page);
};
const onSizeChange = (size: number) => {
  emit("size-page-change", size);
};

// ------------------------------------------------------------------
// 拖拽初始化（保持不变）
// ------------------------------------------------------------------
let sortableInstance: Sortable | null = null;
const initDrag = () => {
  nextTick(() => {
    const tbody = (tableRef.value?.$el as HTMLElement)?.querySelector(
      ".el-table__body > tbody"
    ) as HTMLElement | null;
    if (tbody) {
      if (sortableInstance) sortableInstance.destroy();
      sortableInstance = Sortable.create(tbody, {
        handle: ".out_drag_btn",
        onEnd(evt: any) {
          emit("onDraggableEnd", evt);
        },
      });
    }
  });
};

watch(
  () => props.data,
  (val) => {
    if (val.length) {
      nextTick(() => {
        tableRef.value?.doLayout();
      });
      if (props.draggable) {
        initDrag();
      }
    }
  }
);

onMounted(() => {
  if (props.data.length && props.draggable) {
    initDrag();
  }
});
</script>

<style lang="less">
/* 原有样式保持不变 */
.hasContextMenuIconTooltip {
  border: none !important;
  border-radius: 2px !important;
  padding: 4px !important;
  color: var(--el-color-warning);
}
.hasContextMenuIcon {
  display: inline-block;
  width: 14px;
  height: 14px;
  background: url("../../assets/img/hasContextMenuIcon.svg") no-repeat;
  cursor: pointer;
  position: relative;
  top: 2px;
  &:hover {
    background: url("../../assets/img/hasContextMenuIcon-hover.svg") no-repeat;
  }
}
.el-table__row {
  .out_drag_btn {
    display: none;
  }
  &:hover {
    .out_drag_btn {
      display: block;
    }
  }
}
</style>
