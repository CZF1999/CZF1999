<template>
  <ScreenLayout :cols="24" :rows="20" :gap="20">
    <!-- 左上：趋势图 (col 1-10, row 1-9) -->
    <TrendChart
      :key="`trend-${trendDeviceIds.join(',')}`"
      :config="trendConfig"
      style="grid-column: span 10; grid-row: span 10;"
      @device-click="layoutStore.selectDevice"
    />

    <!-- 中上：仪表盘 (col 11-15, row 1-9) -->
    <GaugeChart
      v-if="selectedDeviceId"
      :config="gaugeConfig"
      style="grid-column: span 5; grid-row: span 10;"
      @device-click="layoutStore.selectDevice"
    />
    <GaugeChart
      v-else
      :config="{ ...defaultGaugeConfig, title: defaultGaugeConfig.title, deviceIds: ['default'] }"
      style="grid-column: span 5; grid-row: span 10;"
    />

    <!-- 中上2：设备类型扇形图 (col 16-19, row 1-9) -->
    <PieChart dimension="device-type" style="grid-column: span 4; grid-row: span 10;" />

    <!-- 右上：3D 设备模型 (col 20-24, row 1-9) -->
    <Device3DView style="grid-column: span 5; grid-row: span 10;" />

    <!-- 左下：柱状图 (col 1-7, row 10-19) -->
    <BarChart :config="barConfig" style="grid-column: span 7; grid-row: span 10;" />

    <!-- 中下1：设备状态扇形图 (col 8-12, row 10-19) -->
    <PieChart dimension="status" style="grid-column: span 5; grid-row: span 10;" />

    <!-- 中下2：告警列表 (col 13-18, row 10-19) -->
    <AlarmList style="grid-column: span 6; grid-row: span 10;" />

    <!-- 右下：设备分布地图 (col 19-24, row 10-19) -->
    <MapView style="grid-column: span 6; grid-row: span 10;" />

    <!-- FPS 指示器 -->
    <div v-if="showPerf" class="fps-indicator">
      FPS: {{ perfSnapshot.fps }} | WS: {{ perfSnapshot.wsMessageRate }}/s
    </div>
  </ScreenLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useDeviceStore } from '@/stores/deviceStore'
import { useAlarmStore } from '@/stores/alarmStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { WebSocketManager } from '@/services/wsManager'
import { PerformanceMonitor } from '@/utils/dashboard'
import { useScreenScale } from '@/utils/useScreenScale'
import type { ChartConfig, DataSourceConfig, PerformanceMetrics } from '@/types/dashboard'
import ScreenLayout from '@/components/ScreenLayout.vue'
import TrendChart from './components/TrendChart.vue'
import BarChart from './components/BarChart.vue'
import GaugeChart from './components/GaugeChart.vue'
import AlarmList from './components/AlarmList.vue'
import Device3DView from './components/Device3DView.vue'
import MapView from './components/MapView.vue'
import PieChart from './components/PieChart.vue'

// ==================== 屏幕自适应缩放 ====================
// 初始化单例 scale，所有子组件 useScreenScale() 共享同一实例
useScreenScale()

// ==================== Store ====================
const deviceStore = useDeviceStore()
const alarmStore = useAlarmStore()
const layoutStore = useLayoutStore()

// ==================== WebSocket 连接初始化 ====================
const wsManager = WebSocketManager.getInstance()

const dataSourceConfig: DataSourceConfig = {
  highFreqEndpoint: import.meta.env.VITE_WS_HIGH_FREQ ?? 'ws://localhost:3001/ws/device',
  lowFreqEndpoint: import.meta.env.VITE_WS_LOW_FREQ ?? 'ws://localhost:3001/ws/alarm',
  heartbeatInterval: 10_000,
  reconnectBaseDelay: 1_000,
}

// ==================== 图表配置 ====================
const selectedDeviceId = computed(() => layoutStore.selectedDeviceId)
const trendDeviceIds = computed(() => {
  return selectedDeviceId.value
    ? [selectedDeviceId.value]
    : ['dev-001', 'dev-002', 'dev-003']
})

const trendConfig = computed<ChartConfig>(() => ({
  id: 'trend-main',
  title: '设备实时趋势',
  type: 'trend',
  metric: 'speed',
  deviceIds: trendDeviceIds.value,
  color: '#40c8ff',
}))

const barConfig = computed<ChartConfig>(() => ({
  id: 'bar-main',
  title: '设备温度对比',
  type: 'bar',
  metric: 'temperature',
  deviceIds: ['dev-001', 'dev-002', 'dev-003', 'dev-004', 'dev-005'],
  color: '#e6a23c',
}))

const gaugeConfig = computed<ChartConfig & { max: number }>(() => ({
  id: 'gauge-main',
  title: '实时转速',
  type: 'gauge',
  metric: 'speed',
  deviceIds: selectedDeviceId.value ? [selectedDeviceId.value] : ['dev-001'],
  max: 3000,
}))

const defaultGaugeConfig: ChartConfig & { max: number } = {
  id: 'gauge-default',
  title: '实时转速',
  type: 'gauge',
  metric: 'speed',
  deviceIds: ['dev-001'],
  max: 3000,
}


// ==================== 性能监控 ====================
const showPerf = ref(import.meta.env.DEV)
const perf = new PerformanceMonitor()
const perfSnapshot = ref<PerformanceMetrics>({ fps: 0, frameTime: 0, wsMessageRate: 0, renderTime: 0 })
let perfTimer: ReturnType<typeof setInterval> | null = null

const heartbeatMsg = '{"type":"ping"}'

// ==================== 生命周期 ====================
onMounted(() => {

  // 2. WebSocket
  wsManager.createConnection({
    id: 'high-freq',
    url: dataSourceConfig.highFreqEndpoint,
    heartbeatInterval: dataSourceConfig.heartbeatInterval,
    heartbeatMessage: heartbeatMsg,
    timeout: 5_000,
    reconnectMaxAttempts: 10,
    reconnectBaseDelay: dataSourceConfig.reconnectBaseDelay,
  })

  wsManager.createConnection({
    id: 'low-freq',
    url: dataSourceConfig.lowFreqEndpoint,
    heartbeatInterval: dataSourceConfig.heartbeatInterval,
    heartbeatMessage: heartbeatMsg,
    timeout: 5_000,
    reconnectMaxAttempts: 10,
    reconnectBaseDelay: dataSourceConfig.reconnectBaseDelay,
  })

  deviceStore.bindWsManager()
  alarmStore.bindWs()
  wsManager.connectAll()

  // 3. 性能监控
  perf.start()
  perfTimer = setInterval(() => {
    perfSnapshot.value = perf.getSnapshot()
  }, 2_000)
})

onUnmounted(() => {
  perf.stop()
  if (perfTimer) clearInterval(perfTimer)
  wsManager.destroy()
  deviceStore.$reset()
  alarmStore.$reset()
})
</script>

<style scoped lang="less">
@import '@/styles/dashboard.less';

.fps-indicator {
  position: fixed;
  right: 8px;
  top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-family: @font-number;
  pointer-events: none;
  z-index: 9999;
}
</style>
