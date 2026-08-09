<template>
  <div class="screen-layout" :style="gridStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'

/** gap 单位：设计像素（design px），在 gridStyle 中自动转为 rem */
const props = withDefaults(defineProps<{
  cols?: number | string
  rows?: number | string
  gap?: number
}>(), {
  cols: 12,
  rows: 'auto',
  gap: 12,
})

const emit = defineEmits<{
  (e: 'ready'): void
}>()

const gridStyle = computed(() => {
  const cols = typeof props.cols === 'number' ? `repeat(${props.cols}, 1fr)` : props.cols
  const rows = typeof props.rows === 'number' ? `repeat(${props.rows}, 1fr)` : props.rows
  return {
    gridTemplateColumns: cols,
    gridTemplateRows: rows,
    gap: `${props.gap / 16}rem`,
    // padding: `10px`
  }
})

onMounted(() => {
  document.documentElement.classList.add('dashboard-fullscreen')
  emit('ready')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('dashboard-fullscreen')
})
</script>

<style scoped lang="less">
.screen-layout {
  width: 100%;
  height: 100%;
  display: grid;
  overflow: hidden;

  > :deep(*) {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
}
</style>

<style lang="less">
.dashboard-fullscreen,
.dashboard-fullscreen body,
.dashboard-fullscreen #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
