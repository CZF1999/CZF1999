<script setup lang="ts">
/**
 * 基于 el-input 的增强输入框组件。
 * 内置自动 trim、输入过滤（filter 正则）、数字范围限制（czfnumscope）、
 * 智能 placeholder 生成（根据 label 自动拼接"请输入..."），其余属性透传至 el-input。
 */
import { computed, useAttrs, ref } from "vue";
import { ElInput } from "element-plus";

defineOptions({ name: "CzfInput", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    trim?: boolean;
    debounce?: number;
    clearable?: boolean;
    placeholder?: string;
    label?: string;
    filter?: RegExp;
    /** 数字输入框的数值范围，例如 [0, 999999] */
    czfnumscope?: [number, number];
  }>(),
  {
    trim: true,
    debounce: 0,
    clearable: true,
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
  blur: [e: FocusEvent];
  focus: [e: FocusEvent];
  change: [value: string | number];
  debounceInput: [value: string | number];
}>();

const attrs = useAttrs();

// 推断当前输入框类型（普通 / textarea / number 等）
const type = computed(() => (attrs.type as string) || "text");

// 自动生成 placeholder
const finalPlaceholder = computed(() => {
  if (props.placeholder) return props.placeholder;
  return props.label ? `请输入${props.label}` : undefined;
});

// 最大长度默认值：普通50，textarea500，数字框不限制
const computedMaxlength = computed(() => {
  if (attrs.maxlength != null) return attrs.maxlength as string | number;
  if (type.value === "textarea") return 500;
  if (type.value === "number") return undefined; // number 不支持 maxlength
  return 50;
});

// 最小值：外部 min > czfnumscope[0] > 数字框默认0
const computedMin = computed(() => {
  if (attrs.min !== undefined) return attrs.min;
  if (type.value === "number") {
    if (props.czfnumscope) return props.czfnumscope[0];
    return 0;
  }
  return undefined;
});

// 最大值：外部 max > czfnumscope[1] > 无限制
const computedMax = computed(() => {
  if (attrs.max !== undefined) return attrs.max;
  if (type.value === "number" && props.czfnumscope) {
    return props.czfnumscope[1];
  }
  return undefined;
});

// 双向绑定核心，内部用 computed 处理 trim、filter 以及数字负数过滤
const innerValue = computed({
  get: () => props.modelValue ?? "",
  set: (val) => {
    let processed: string = String(val ?? "");
    if (props.trim) processed = processed.trim();
    if (props.filter) processed = processed.replace(props.filter, "");

    // 数字框：强制移除负号，禁止负数输入
    if (type.value === "number") {
      processed = processed.replace(/^-/, "");
    }

    emit("update:modelValue", processed);
  },
});

function handleInput(val: string | number) {
  innerValue.value = val;
}

function handleBlur(e: FocusEvent) {
  emit("blur", e);
}
function handleFocus(e: FocusEvent) {
  emit("focus", e);
}
function handleChange(val: string | number) {
  emit("change", val);
}

const inputRef = ref<InstanceType<typeof ElInput>>();
defineExpose({
  focus: () => inputRef.value?.focus(),
  blur: () => inputRef.value?.blur(),
  select: () => inputRef.value?.select(),
});
</script>

<template>
  <ElInput
    class="editNum"
    ref="inputRef"
    v-bind="attrs"
    :model-value="innerValue"
    :placeholder="finalPlaceholder"
    :clearable="clearable"
    :maxlength="computedMaxlength"
    :min="computedMin"
    :max="computedMax"
    @input="handleInput"
    @blur="handleBlur"
    @focus="handleFocus"
    @change="handleChange"
  />
</template>
<style scoped>
::deep .el-input__inner[type="number"]::-webkit-outer-spin-button,
.el-input__inner[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none !important;
  margin: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
  display: none !important;
}
</style>