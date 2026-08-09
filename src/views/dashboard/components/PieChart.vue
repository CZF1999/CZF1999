<template>
  <ChartBox :title="title" :subtitle="subtitle">
    <EChart ref="echartRef" :option="chartOption" class="pie-chart" />
  </ChartBox>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart as EPieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import { useDeviceStore } from '@/stores/deviceStore'
import { useAlarmStore } from '@/stores/alarmStore'
import ChartBox from '@/components/ChartBox.vue'
import EChart from '@/components/EChart.vue'
import { useScreenScale } from '@/utils/useScreenScale'

echarts.use([EPieChart, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])

export type PieDimension = 'status' | 'alarm-level' | 'device-type'

const props = withDefaults(defineProps<{
  dimension: PieDimension
  title?: string
}>(), {
  title: '',
})

const echartRef = ref<InstanceType<typeof EChart> | null>(null)
const { scale } = useScreenScale()
const deviceStore = useDeviceStore()
const alarmStore = useAlarmStore()

const DIMENSION_LABELS: Record<PieDimension, string> = {
  'status': '设备状态分布',
  'alarm-level': '告警级别占比',
  'device-type': '设备类型分布',
}

const DIMENSION_SUBTITLES: Record<PieDimension, string> = {
  'status': `${deviceStore.getAllDevices().length} 台设备`,
  'alarm-level': `${alarmStore.alarms.length} 条告警`,
  'device-type': `${deviceStore.getAllDevices().length} 台设备`,
}

const STATUS_COLORS: Record<string, string> = {
  online: '#67c23a',
  warning: '#e6a23c',
  error: '#f56c6c',
  offline: '#909399',
}

const ALARM_LEVEL_COLORS: Record<string, string> = {
  info: '#409eff',
  warning: '#e6a23c',
  critical: '#f56c6c',
}

const DEVICE_TYPE_COLORS: Record<string, string> = {
  motor: '#409eff',
  pump: '#67c23a',
  conveyor: '#e6a23c',
  sensor: '#f56c6c',
}

const DEVICE_TYPE_LABELS: Record<string, string> = {
  motor: '电机',
  pump: '泵',
  conveyor: '输送机',
  sensor: '传感器',
}

const displayTitle = computed(() => props.title || DIMENSION_LABELS[props.dimension])

const subtitle = computed(() => DIMENSION_SUBTITLES[props.dimension])

const chartOption = computed(() => {
  switch (props.dimension) {
    case 'status':
      return buildStatusOption()
    case 'alarm-level':
      return buildAlarmLevelOption()
    case 'device-type':
      return buildDeviceTypeOption()
    default:
      return {}
  }
})

function buildStatusOption() {
  const devices = deviceStore.getAllDevices()
  const counts: Record<string, number> = { online: 0, warning: 0, error: 0, offline: 0 }
  for (const d of devices) {
    counts[d.status] = (counts[d.status] ?? 0) + 1
  }
  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      name,
      value,
      itemStyle: { color: STATUS_COLORS[name] },
    }))

  const s = scale.value
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: 'rgba(6, 12, 48, 0.9)',
      borderColor: 'rgba(30, 144, 255, 0.5)',
      textStyle: { color: '#e0e6f0', fontSize: 12 * s },
      formatter: '{b}: {c} 台 ({d}%)',
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#8899bb', fontSize: 10 * s },
    },
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 2, borderColor: 'rgba(6,12,48,0.8)', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 14 * s, fontWeight: 'bold' },
      },
      data,
    }],
  }
}

function buildAlarmLevelOption() {
  const alarms = alarmStore.alarms
  const counts: Record<string, number> = { info: 0, warning: 0, critical: 0 }
  for (const a of alarms) {
    counts[a.level] = (counts[a.level] ?? 0) + 1
  }
  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      name,
      value,
      itemStyle: { color: ALARM_LEVEL_COLORS[name] },
    }))

  const s = scale.value
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: 'rgba(6, 12, 48, 0.9)',
      borderColor: 'rgba(30, 144, 255, 0.5)',
      textStyle: { color: '#e0e6f0', fontSize: 12 * s },
      formatter: '{b}: {c} 条 ({d}%)',
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#8899bb', fontSize: 10 * s },
    },
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 2, borderColor: 'rgba(6,12,48,0.8)', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 14 * s, fontWeight: 'bold' },
      },
      data,
    }],
  }
}

function buildDeviceTypeOption() {
  const devices = deviceStore.getAllDevices()
  const counts: Record<string, number> = {}
  for (const d of devices) {
    counts[d.type] = (counts[d.type] ?? 0) + 1
  }
  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      name: DEVICE_TYPE_LABELS[name] ?? name,
      value,
      itemStyle: { color: DEVICE_TYPE_COLORS[name] ?? '#409eff' },
    }))

  const s = scale.value
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: 'rgba(6, 12, 48, 0.9)',
      borderColor: 'rgba(30, 144, 255, 0.5)',
      textStyle: { color: '#e0e6f0', fontSize: 12 * s },
      formatter: '{b}: {c} 台 ({d}%)',
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#8899bb', fontSize: 10 * s },
    },
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 2, borderColor: 'rgba(6,12,48,0.8)', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 14 * s, fontWeight: 'bold' },
      },
      data,
    }],
  }
}
</script>

<style scoped lang="less">
.pie-chart {
  width: 100%;
  height: 100%;
}
</style>
