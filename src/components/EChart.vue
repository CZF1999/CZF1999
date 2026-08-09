<template>
  <div ref="containerRef" class="echart-container"></div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import type { EChartsType, EChartsOption } from 'echarts/core'
import { getOptimalDPR } from '@/utils/dashboard'

const props = withDefaults(defineProps<{
  option: EChartsOption
  theme?: string
  initOpts?: Record<string, unknown>
}>(), {
  theme: undefined,
  initOpts: () => ({}),
})

const emit = defineEmits<{
  (e: 'ready', instance: EChartsType): void
}>()

const containerRef = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let resizeObserver: ResizeObserver | null = null
let rafId: number | null = null
let lastSize: { w: number; h: number } | null = null

function getInstance(): EChartsType | null {
  return chart && !chart.isDisposed() ? chart : null
}

function doResize(): void {
  const el = containerRef.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (w === 0 || h === 0) return
  if (lastSize && lastSize.w === w && lastSize.h === h) return
  lastSize = { w, h }
  chart?.resize({ width: w, height: h })
}

function scheduleResize(): void {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    doResize()
  })
}

function initChart(): void {
  if (!containerRef.value) return

  const dpr = getOptimalDPR(2)
  chart = echarts.init(containerRef.value, props.theme, {
    devicePixelRatio: dpr,
    ...props.initOpts,
  })
  chart.setOption(props.option)

  resizeObserver = new ResizeObserver(() => {
    console.log('你变化了',containerRef.value);
    
    scheduleResize()
  })
  resizeObserver.observe(containerRef.value)

  emit('ready', chart)
}

watch(
  () => props.option,
  (opt) => {
    if (!chart || chart.isDisposed()) return
    chart.setOption(opt, { notMerge: false })
    // display:none blind spot: container may have been hidden (tab switch)
    // and ResizeObserver may not fire on re-show in some browsers
    nextTick(() => {
      const el = containerRef.value
      if (el && el.clientWidth > 0 && el.clientHeight > 0) {
        if (!lastSize || lastSize.w !== el.clientWidth || lastSize.h !== el.clientHeight) {
          doResize()
        }
      }
    })
  },
)

onMounted(() => {
  initChart()
})

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  if (chart && !chart.isDisposed()) {
    chart.dispose()
  }
  chart = null
})

defineExpose({ getInstance, resize: doResize })
</script>

<style scoped>
.echart-container {
  width: 100%;
  height: 100%;
}
</style>
