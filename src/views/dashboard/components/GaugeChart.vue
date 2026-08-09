<template>
  <ChartBox
    :title="config.title"
    :subtitle="`${deviceName} · ${config.metric}`"
  >
    <EChart ref="echartRef" :option="chartOption" class="gauge-chart" @ready="onChartReady" />
  </ChartBox>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { GaugeChart as EGaugeChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { ChartConfig, DeviceData } from '@/types/dashboard'
import { useDeviceStore } from '@/stores/deviceStore'
import ChartBox from '@/components/ChartBox.vue'
import EChart from '@/components/EChart.vue'
import { useScreenScale } from '@/utils/useScreenScale'

echarts.use([EGaugeChart, CanvasRenderer])

const props = defineProps<{
  config: ChartConfig & { max?: number }
}>()

const emit = defineEmits<{
  (e: 'deviceClick', deviceId: string): void
}>()

const { scale } = useScreenScale()

const echartRef = ref<InstanceType<typeof EChart> | null>(null)
let chartInstance: EChartsType | null = null
let subscriberId: string | null = null
let unsubBatch: (() => void) | null = null
let rafPending = false
const deviceStore = useDeviceStore()

const deviceName = computed(() => props.config.deviceIds[0] ?? '--')
const max = computed(() => props.config.max ?? 100)

const chartOption = computed(() => {
  const s = scale.value
  return {
    series: [{
      type: 'gauge' as const,
      startAngle: 210,
      endAngle: -30,
      center: ['50%', '58%'],
      radius: '85%',
      min: 0,
      max: max.value,
      splitNumber: 10,
      axisLine: {
        show: true,
        lineStyle: {
          width: 14 * s,
          color: [
            [0.3, '#67c23a'],
            [0.7, '#e6a23c'],
            [1, '#f56c6c'],
          ],
        },
      },
      pointer: {
        icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
        length: '70%',
        width: 6 * s,
      },
      axisTick: { distance: -(14 * s), length: 6 * s, lineStyle: { width: 1, color: '#555' } },
      splitLine: { distance: -(20 * s), length: 12 * s, lineStyle: { width: 2, color: '#555' } },
      axisLabel: { color: '#8899bb', distance: 28 * s, fontSize: 10 * s },
      anchor: { show: true, showAbove: true, size: 14 * s },
      title: { show: false },
      detail: {
        valueAnimation: true,
        fontSize: 28 * s,
        fontFamily: "'DIN','Roboto Mono',monospace",
        color: '#40c8ff',
        offsetCenter: [0, '75%'],
        formatter: '{value}',
      },
      data: [{ value: 0 }],
    }],
  }
})

function onChartReady(instance: EChartsType): void {
  chartInstance = instance
  instance.on('click', (params: { seriesName?: string }) => {
    if (params.seriesName) {
      emit('deviceClick', params.seriesName)
    }
  })
}

function onDeviceData(): void {
  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      const deviceId = props.config.deviceIds[0]
      if (!deviceId) return
      const device = deviceStore.getDevice(deviceId)
      const value = device?.metrics[props.config.metric] ?? 0
      echartRef.value?.getInstance()?.setOption({
        series: [{ data: [{ value }] }],
      })
    })
  }
}

subscriberId = deviceStore.subscribe(props.config.deviceIds)
unsubBatch = deviceStore.onBatch(onDeviceData)

onBeforeUnmount(() => {
  if (subscriberId) deviceStore.unsubscribe(subscriberId)
  if (unsubBatch) { unsubBatch(); unsubBatch = null }
  chartInstance = null
})
</script>

<style scoped lang="less">
.gauge-chart { width: 100%; height: 100%; }
</style>
