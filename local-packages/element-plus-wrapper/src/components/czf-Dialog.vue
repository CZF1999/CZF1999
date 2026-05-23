<template>
  <el-dialog
    v-bind="$attrs"
    :model-value="modelValue"
    @update:model-value="handleClose"
    @close="handleCloseDialog"
  >
    <slot></slot>
    <template #footer>
      <slot name="footer"></slot>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 基于 el-dialog 的确认关闭弹窗组件。
 * 通过 `confirmBeforeClose` 控制在关闭弹窗前弹出二次确认；
 * 支持 v-model 双向绑定显示状态，其余属性通过 $attrs 透传至 el-dialog。
 */
import { ElDialog, ElMessageBox } from 'element-plus'

defineOptions({ name: 'CzfDialog' });

interface DialogProps {
  modelValue?: boolean
  confirmBeforeClose?: boolean
  confirmMessage?: string
  confirmTitle?: string
}

const props = withDefaults(defineProps<DialogProps>(), {
  modelValue: false,
  confirmBeforeClose: false,
  confirmMessage: '确定要关闭弹窗吗？',
  confirmTitle: '提示'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
}>()

const doClose = () => {
  emit('update:modelValue', false)
  emit('close')
}

const handleClose = (_value: boolean) => {
  if (props.confirmBeforeClose) {
    ElMessageBox.confirm(props.confirmMessage, props.confirmTitle, {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
      .then(() => doClose())
      .catch(() => {})
  } else {
    doClose()
  }
}

const handleCloseDialog = () => {
  if (props.confirmBeforeClose) {
    ElMessageBox.confirm(props.confirmMessage, props.confirmTitle, {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
      .then(() => doClose())
      .catch(() => {})
  } else {
    doClose()
  }
}
</script>