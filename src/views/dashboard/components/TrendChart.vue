<template>
  <ChartBox
    :title="config.title"
    :subtitle="`${config.metric} · ${config.deviceIds.length} 设备`"
  >
    <EChart ref="echartRef" :option="baseOption" class="trend-chart" @ready="onChartReady" />
  </ChartBox>
</template>

<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { ChartConfig, DeviceData } from '@/types/dashboard'
import { useDeviceStore } from '@/stores/deviceStore'
import { formatTime } from '@/utils/dashboard'
import ChartBox from '@/components/ChartBox.vue'
import EChart from '@/components/EChart.vue'
import { useScreenScale } from '@/utils/useScreenScale'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])

const props = defineProps<{
  config: ChartConfig
}>()

const emit = defineEmits<{
  (e: 'deviceClick', deviceId: string): void
}>()

const { scale } = useScreenScale()

const echartRef = ref<InstanceType<typeof EChart> | null>(null)
let chartInstance: EChartsType | null = null
let subscriberId: string | null = null
let unsubBatch: (() => void) | null = null

const dataBuffer: Record<string, TrendDataPoint[]> = {}
const trackedDeviceIds = new Set(props.config.deviceIds)
const deviceStore = useDeviceStore()

// 用户是否正在浏览历史数据（手动拖拽了 dataZoom）
let userBrowsingHistory = false
// 记录最后一个数据点的时间戳，用于判断用户是否在看最新数据
let latestDataTimestamp = 0

const baseOption = computed(() => {
  const s = scale.value
  return {
    grid: { left: 50 * s, right: 20 * s, top: 10 * s, bottom: 50 * s },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(6, 12, 48, 0.9)',
      borderColor: 'rgba(30, 144, 255, 0.5)',
      textStyle: { color: '#e0e6f0', fontSize: 12 * s },
      formatter: (params: { seriesName: string; data: [number, number] }[]) => {
        if (!params?.length) return ''
        const t = formatTime(params[0]!.data[0])
        let html = `<div style="color:#8899bb">${t}</div>`
        for (const p of params) {
          html += `<div>${p.seriesName}: <b style="color:#40c8ff">${p.data[1]?.toFixed(2)}</b></div>`
        }
        return html
      },
    },
    xAxis: {
      type: 'time' as const,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      axisLabel: { color: '#8899bb', fontSize: 10 * s },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#8899bb', fontSize: 10 * s },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    dataZoom: [
      { type: 'inside' as const, start: 0, end: 100 },
      { type: 'slider' as const, start: 0, end: 100, height: 20 * s, bottom: 6 * s },
    ],
    series: props.config.deviceIds.map((deviceId) => ({
      type: 'line' as const,
      name: deviceId,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      data: [] as [number, number][],
    })),
  }
})

function onChartReady(instance: EChartsType): void {
  chartInstance = instance

  instance.on('click', (params: { seriesName?: string }) => {
    if (params.seriesName) {
      emit('deviceClick', params.seriesName)
    }
  })

  // 监听 dataZoom 事件：判断用户是手动拖拽还是数据推动
  instance.on('dataZoom', (params: unknown) => {
    const p = params as { start?: number; end?: number }
    if (p.end !== undefined) {
      // end < 100 说明用户正在浏览历史数据，暂停自动滚动
      userBrowsingHistory = p.end < 100
    }
  })
}

function getChart(): EChartsType | null {
  return chartInstance && !chartInstance.isDisposed() ? chartInstance : null
}

// ---------- 增量追加（每帧合并） ----------
let rafPending = false

function flushAppend(): void {
  const chart = getChart()
  if (!chart) return

  if (Object.keys(dataBuffer).length === 0) {
    rafPending = false
    return
  }

  for (const deviceId of Object.keys(dataBuffer)) {
    const points = dataBuffer[deviceId]
    if (!points?.length) continue
    delete dataBuffer[deviceId]

    const idx = props.config.deviceIds.indexOf(deviceId)
    if (idx === -1) continue

    chart.appendData({
      seriesIndex: idx,
      data: points.map((p) => [p.timestamp, p.value]),
    })
  }

  // 仅在用户未手动拖拽 dataZoom 时，自动滚动到最新数据窗口
  if (!userBrowsingHistory && latestDataTimestamp > 0) {
    chart.dispatchAction({
      type: 'dataZoom',
      startValue: latestDataTimestamp - 60_000,
      endValue: latestDataTimestamp,
    })
  }

  rafPending = false
}

function onDeviceData(devices: DeviceData[]): void {
  let newDeviceSeen = false

  for (const d of devices) {
    if (!trackedDeviceIds.has(d.deviceId)) {
      trackedDeviceIds.add(d.deviceId)
      newDeviceSeen = true
    }

    const val = d.metrics[props.config.metric]
    if (val === undefined) continue

    if (!dataBuffer[d.deviceId]) dataBuffer[d.deviceId] = []
    dataBuffer[d.deviceId]!.push({ timestamp: d.timestamp, value: val })

    if (d.timestamp > latestDataTimestamp) {
      latestDataTimestamp = d.timestamp
    }
  }

  if (newDeviceSeen) {
    subscriberId = deviceStore.subscribe(Array.from(trackedDeviceIds), subscriberId ?? undefined)
    updateChartSeries()
  }

  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(flushAppend)
  }
}

function updateChartSeries(): void {
  const chart = getChart()
  if (!chart) return
  const ids = Array.from(trackedDeviceIds)
  chart.setOption({
    series: ids.map((deviceId) => ({
      type: 'line' as const,
      name: deviceId,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      data: [] as [number, number][],
    })),
  }, { replaceMerge: ['series'] })
}

function subscribe(): void {
  subscriberId = deviceStore.subscribe(Array.from(trackedDeviceIds), subscriberId ?? undefined)
}

function unsubscribe(): void {
  if (subscriberId) {
    deviceStore.unsubscribe(subscriberId)
    subscriberId = null
  }
}

watch(
  () => props.config.deviceIds,
  (newIds) => {
    for (const id of newIds) trackedDeviceIds.add(id)
    unsubscribe()
    subscribe()
    updateChartSeries()
  },
)

subscribe()
unsubBatch = deviceStore.onBatch(onDeviceData)

onBeforeUnmount(() => {
  trackedDeviceIds.clear()
  unsubscribe()
  if (unsubBatch) { unsubBatch(); unsubBatch = null }
  chartInstance = null
})
</script>

<style scoped lang="less">
.trend-chart {
  width: 100%;
  height: 100%;
}
</style>
