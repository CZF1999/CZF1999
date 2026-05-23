<template>
  <div class="list-operate flex">
    <div
      class="cursor-pointer mr-8px"
      v-for="o in fixedOperates"
      :key="o.key"
      :style="o.style || {}"
      :class="{
        'display-none': o.displaynone ? o.displaynone(curRow) : false,
        'is-disabled': o.disabled
      }"
      @click="!o.disabled && o.action(o, curRow)"
    >
      {{ o.title }}
    </div>
    <div v-if="moreOperates.length">
      <el-popover
        popper-class="list-popover"
        trigger="hover"
        placement="bottom-end"
        :visible-arrow="false"
        :close-delay="100"
        :open-delay="100"
      >
        <div class="more-wrap flex flex-col mb--8px">
          <div
            class="more-item py-4px mb-8px"
            :class="{
              'is-disabled': m.disabled
            }"
            :style="m.style || {}"
            v-for="m in moreOperates"
            :key="m.key"
            @click="!m.disabled && m.action(m, curRow)"
          >
            {{ m.title }}
          </div>
        </div>
        <template #reference>
          <div class="h-full flex items-center cursor-pointer">
            <czf-icon iconName="icon-icon-more" />
          </div>
        </template>
      </el-popover>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 表格行操作按钮组件，将操作项分为固定区（fixed）和更多区（more）。
 * 固定操作直接平铺展示，更多操作折叠在 hover 触发的 popover 中。
 * 支持按行数据动态显隐（displaynone）和禁用（disabled）。
 */
import { computed } from 'vue'
import { ElPopover } from 'element-plus'
import czfIcon from './czf-Icon.vue'

defineOptions({ name: 'CzfListOperate' })

interface OperateItem {
  key: string | number
  title: string
  action: (item: OperateItem, row: any) => void
  style?: Record<string, any>
  type?: 'fixed' | 'more'
  hidden?: boolean
  displaynone?: (row: any) => boolean
  disabled?: boolean
}

const props = defineProps<{
  operates?: OperateItem[]
  curRow?: Record<string, any>
}>()

const { operates = [], curRow = {} } = props

const showOperates = computed(() => operates.filter((item) => !item.hidden))

const fixedOperates = computed(() =>
  showOperates.value.filter((item) => !item.type || item.type === 'fixed')
)

const moreOperates = computed(() =>
  showOperates.value.filter((item) => item.type === 'more')
)
</script>

<style lang="less" scoped>
.list-operate {
  color: var(--el-color-primary);
  .is-disabled {
    color: var(--el-text-color-disabled);
    cursor: not-allowed;
  }
}
</style>

<style lang="less">
.list-popover {
  padding: 10px 0 !important;
  .more-wrap {
    .more-item {
      padding-left: 14px;
      cursor: pointer;
      color: var(--el-color-primary);
      &:hover {
        background: var(--el-fill-color-light);
      }
      &.is-disabled {
        color: var(--el-text-color-disabled);
        cursor: not-allowed;
      }
    }
  }
}
</style>