<template>
  <ChartBox title="设备分布" :subtitle="`${devices.length} 个设备`">
    <EChart ref="echartRef" :option="chartOption" class="map-view" @ready="onChartReady" />
  </ChartBox>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { ScatterChart, EffectScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import { useDeviceStore } from '@/stores/deviceStore'
import { useLayoutStore } from '@/stores/layoutStore'
import type { DeviceData } from '@/types/dashboard'
import ChartBox from '@/components/ChartBox.vue'
import EChart from '@/components/EChart.vue'
import { useScreenScale } from '@/utils/useScreenScale'

echarts.use([ScatterChart, EffectScatterChart, GridComponent, TooltipComponent, CanvasRenderer])

const echartRef = ref<InstanceType<typeof EChart> | null>(null)
const { scale } = useScreenScale()
let chartInstance: EChartsType | null = null
let subscriberId: string | null = null
let unsubBatch: (() => void) | null = null
let rafPending = false

const deviceStore = useDeviceStore()
const layoutStore = useLayoutStore()

const devices = computed<DeviceData[]>(() => deviceStore.getAllDevices())
const deviceMapByCoord = new Map<string, string>()

const chartOption = computed(() => {
  const s = scale.value
  return {
    grid: { left: 10, right: 10, top: 10, bottom: 10 },
    xAxis: {
      type: 'value' as const,
      show: true,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
      axisLabel: { color: '#8899bb', fontSize: 9 * s, formatter: (v: number) => v.toFixed(1) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      min: undefined as number | undefined,
      max: undefined as number | undefined,
    },
    yAxis: {
      type: 'value' as const,
      show: true,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
      axisLabel: { color: '#8899bb', fontSize: 9 * s, formatter: (v: number) => v.toFixed(1) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      min: undefined as number | undefined,
      max: undefined as number | undefined,
    },
    tooltip: {
      backgroundColor: 'rgba(6,12,48,0.9)',
      borderColor: 'rgba(30,144,255,0.5)',
      textStyle: { color: '#e0e6f0', fontSize: 12 * s },
      formatter: (p: { data: number[] }) => {
        const id = deviceMapByCoord.get(`${p.data[0]},${p.data[1]}`)
        const d = id ? deviceStore.getDevice(id) : null
        if (!d) return ''
        return `<b>${d.deviceName}</b><br/>
          状态: ${d.status}<br/>
          温度: ${d.metrics.temperature ?? '--'}℃<br/>
          转速: ${d.metrics.speed ?? '--'} rpm`
      },
    },
    series: [{
      type: 'effectScatter' as const,
      symbolSize: 12 * s,
      rippleEffect: { brushType: 'stroke' as const, scale: 2.5 },
      itemStyle: { color: '#40c8ff' },
      data: [] as number[][],
    }],
  }
})

function onChartReady(instance: EChartsType): void {
  chartInstance = instance
  instance.on('click', (params: { data: number[] }) => {
    const id = deviceMapByCoord.get(`${params.data[0]},${params.data[1]}`)
    if (id) layoutStore.selectDevice(id)
  })
}

function flushUpdate(): void {
  rafPending = false
  const chart = echartRef.value?.getInstance()
  if (!chart) return
  const all = deviceStore.getAllDevices()
  if (all.length === 0) return

  deviceMapByCoord.clear()
  const points = all.map((d) => {
    const key = `${d.position.lng},${d.position.lat}`
    deviceMapByCoord.set(key, d.deviceId)
    return [d.position.lng, d.position.lat]
  })

  const lngs = points.map((p) => p[0]!)
  const lats = points.map((p) => p[1]!)
  const xMin = Math.min(...lngs) - 0.5
  const xMax = Math.max(...lngs) + 0.5
  const yMin = Math.min(...lats) - 0.5
  const yMax = Math.max(...lats) + 0.5

  chart.setOption({
    xAxis: { min: xMin, max: xMax },
    yAxis: { min: yMin, max: yMax },
    series: [{ data: points }],
  })
}

function scheduleUpdate(): void {
  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(flushUpdate)
  }
}

function onDeviceData(_devices: DeviceData[]): void {
  scheduleUpdate()
}

const ids = deviceStore.serverDeviceIds.length > 0
  ? deviceStore.serverDeviceIds
  : deviceStore.getAllDevices().map((d) => d.deviceId)
if (ids.length > 0) {
  subscriberId = deviceStore.subscribe(ids)
}
unsubBatch = deviceStore.onBatch(onDeviceData)

watch(
  () => deviceStore.serverDeviceIds,
  (ids) => {
    if (ids.length === 0) return
    subscriberId = deviceStore.subscribe(ids, subscriberId ?? undefined)
    scheduleUpdate()
  },
)

onBeforeUnmount(() => {
  if (subscriberId) deviceStore.unsubscribe(subscriberId)
  if (unsubBatch) { unsubBatch(); unsubBatch = null }
  chartInstance = null
})
</script>

<style scoped lang="less">
.map-view { width: 100%; height: 100%; }
</style>
