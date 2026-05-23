<!-- czf-Button.vue -->
<script setup lang="ts">
/**
 * 基于 el-button 的二次确认按钮组件。
 * 通过 `isConfirm` 开启点击二次确认弹窗，确认后触发 `confirmed` 事件；
 * 未开启确认时直接触发 `click` 事件。其余属性透传至 el-button。
 */
import { ref, computed, useAttrs } from "vue";
import { ElButton, ElMessageBox } from "element-plus";
import type { ButtonProps } from "element-plus";

defineOptions({ name: "CzfButton", inheritAttrs: false });

// 使用交叉类型，Volar 能更好地展开所有属性用于自动补全
type CzfButtonProps = ButtonProps & {
  /** 二次确认提示文字（不传则直接触发 click） */
  confirmText?: string;
  isConfirm?: boolean;
};

const props = withDefaults(defineProps<CzfButtonProps>(), {
  confirmText: "确定要执行吗？",
  isConfirm: false,
});

const emit = defineEmits<{
  click: [e: MouseEvent];
  confirmed: [];
}>();

const attrs = useAttrs();
const buttonRef = ref<any>(null);

// 过滤出自定义 prop，其余全给 el-button
const nativeProps = computed(() => {
  const { confirmText, isConfirm, ...rest } = props;
  return rest;
});

const mergedProps = computed(() => ({
  ...nativeProps.value,
  ...attrs,
}));

function handleClick(e: MouseEvent) {
  if (props.isConfirm && props.confirmText) {
    ElMessageBox.confirm(props.confirmText)
      .then(() => emit("confirmed"))
      .catch(() => {});
  } else {
    emit("click", e);
  }
}

defineExpose({
  focus: () => buttonRef.value?.focus?.(),
  blur: () => buttonRef.value?.blur?.(),
  showConfirm: () => {
    ElMessageBox.confirm(props.confirmText ?? "确定要执行吗？")
      .then(() => emit("confirmed"))
      .catch(() => {});
  },
});
</script>

<template>
  <el-button ref="buttonRef" v-bind="mergedProps" @click="handleClick">
    <slot />
  </el-button>
</template>