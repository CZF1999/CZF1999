<template>
  <ChartBox :title="config.title" :subtitle="config.metric">
    <EChart ref="echartRef" :option="chartOption" class="bar-chart" @ready="onChartReady" />
  </ChartBox>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart as EBarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { ChartConfig, DeviceData } from '@/types/dashboard'
import { useDeviceStore } from '@/stores/deviceStore'
import ChartBox from '@/components/ChartBox.vue'
import EChart from '@/components/EChart.vue'
import { useScreenScale } from '@/utils/useScreenScale'

echarts.use([EBarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = defineProps<{
  config: ChartConfig
}>()

const { scale } = useScreenScale()

const echartRef = ref<InstanceType<typeof EChart> | null>(null)
let chartInstance: EChartsType | null = null
let subscriberId: string | null = null
let unsubBatch: (() => void) | null = null
let rafPending = false
const deviceStore = useDeviceStore()

const chartOption = computed(() => {
  const names = props.config.deviceIds
  const data = names
    .map((id) => deviceStore.getDevice(id))
    .filter(Boolean)
    .map((d: DeviceData) => d.metrics[props.config.metric] ?? 0)

  const s = scale.value
  return {
    grid: { left: 60 * s, right: 20 * s, top: 10 * s, bottom: 30 * s },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(6,12,48,0.9)',
      borderColor: 'rgba(30,144,255,0.5)',
      textStyle: { color: '#e0e6f0', fontSize: 12 * s },
    },
    xAxis: {
      type: 'category' as const,
      data: names,
      axisLabel: { color: '#8899bb', fontSize: 10 * s, rotate: names.length > 8 ? 30 : 0 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#8899bb', fontSize: 10 * s },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [{
      type: 'bar' as const,
      data,
      itemStyle: {
        borderRadius: [2, 2, 0, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: props.config.color ?? '#40c8ff' },
          { offset: 1, color: 'rgba(64, 200, 255, 0.2)' },
        ]),
      },
      barMaxWidth: 40 * s,
    }],
  }
})

function onChartReady(instance: EChartsType): void {
  chartInstance = instance
}

function onDeviceData(): void {
  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      echartRef.value?.getInstance()?.setOption({
        series: [{
          data: props.config.deviceIds
            .map((id) => deviceStore.getDevice(id))
            .filter(Boolean)
            .map((d: DeviceData) => d.metrics[props.config.metric] ?? 0),
        }],
      })
    })
  }
}

watch(
  () => props.config.deviceIds,
  () => {
    subscriberId = deviceStore.subscribe(props.config.deviceIds, subscriberId ?? undefined)
  },
)

subscriberId = deviceStore.subscribe(props.config.deviceIds)
unsubBatch = deviceStore.onBatch(onDeviceData)

onBeforeUnmount(() => {
  if (subscriberId) deviceStore.unsubscribe(subscriberId)
  if (unsubBatch) { unsubBatch(); unsubBatch = null }
  chartInstance = null
})
</script>

<style scoped lang="less">
.bar-chart { width: 100%; height: 100%; }
</style>
