<template>
  <svg
    :class="svgClass"
    aria-hidden="true"
    @mouseenter="onmouseenter"
    @mouseout="onmouseout"
    :style="{
      color: color,
      transform: `rotateY(${rotateY}deg) rotateX(${rotateX}deg) rotate(${rotate}deg)`,
      height: height,
      width: width
    }"
    @click="onClick"
  >
    <title>{{ title }}</title>
    <use :xlink:href="`#${iconName}`"></use>
  </svg>
</template>

<script setup lang="ts">
/**
 * SVG 图标组件，通过 `<use>` 引用 symbol 渲染图标。
 * 支持 hover 时切换填充色、XYZ 三轴旋转、自定义宽高。
 * iconName 对应 SVG symbol 的 id，来自基座或本地项目的 svg-sprite。
 */
import { ref, computed, watch } from 'vue'

defineOptions({ name: 'CzfIcon' });

const props = defineProps({
  /** 基座传入 icon-svg名称； 项目传入 local-svg名称 */
  iconName: {
    type: String,
    required: true
  },
  className: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: ''
  },
  fill: {
    type: String,
    default: ''
  },
  hoverFill: {
    type: String,
    default: ''
  },
  rotateY: {
    type: Number,
    default: 0
  },
  rotateX: {
    type: Number,
    default: 0
  },
  rotate: {
    type: Number,
    default: 0
  },
  from: {
    type: String,
    default: ''
  },
  height: {
    type: String,
    default: ''
  },
  width: {
    type: String,
    default: ''
  }
})

const color = ref(props.fill)

// 监听 fill 变化同步到 color
watch(() => props.fill, (val) => {
  color.value = val
})

const svgClass = computed(() => {
  if (props.className) {
    return 'svg-icon ' + props.className
  }
  return 'svg-icon'
})

const onmouseenter = () => {
  color.value = props.hoverFill || props.fill
}

const onmouseout = () => {
  color.value = props.fill
}

const onClick = () => {
  // 触发 click 事件
  // 在 Vue 3 中，emit 需要显式声明或通过 defineEmits 使用
  // 此处我们直接 emit 即可，无需接收回调
  // 因为 template 中已绑定 @click，所以只要触发即可
  // 如果父组件监听了 @click，则会响应
}
</script>

<style scoped lang="less">
.svg-icon {
  width: 14px;
  height: 14px;
  fill: currentColor;
  overflow: hidden;
}
</style>