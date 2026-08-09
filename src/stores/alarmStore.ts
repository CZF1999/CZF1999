import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { AlarmItem, AlarmLevel } from '@/types/dashboard'
import { WebSocketManager } from '@/services/wsManager'

const MAX_ALARMS = 500

export const useAlarmStore = defineStore('alarm', () => {
  const alarms = ref<AlarmItem[]>([])
  const filterLevel = ref<AlarmLevel | 'all'>('all')

  const filteredAlarms = computed<AlarmItem[]>(() => {
    if (filterLevel.value === 'all') return alarms.value
    return alarms.value.filter((a) => a.level === filterLevel.value)
  })

  const unacknowledgedCount = computed(
    () => alarms.value.filter((a) => !a.acknowledged).length,
  )

  const latestAlarm = computed<AlarmItem | null>(() => alarms.value[0] ?? null)

  function addAlarms(items: AlarmItem[]): void {
    const merged = [...items, ...alarms.value]
    // 按时间戳倒序，保留最近 MAX_ALARMS 条
    merged.sort((a, b) => b.timestamp - a.timestamp)
    alarms.value = merged.slice(0, MAX_ALARMS)
  }

  function acknowledge(alarmId: string): void {
    const alarm = alarms.value.find((a) => a.id === alarmId)
    if (alarm) alarm.acknowledged = true
  }

  function acknowledgeAll(): void {
    for (const a of alarms.value) a.acknowledged = true
  }

  function setFilter(level: AlarmLevel | 'all'): void {
    filterLevel.value = level
  }

  // ---------- WebSocket 集成 ----------
  let unsubWs: (() => void) | null = null
  let _alarmSeq = 0

  function bindWs(): void {
    if (unsubWs) return
    const wsManager = WebSocketManager.getInstance()
    unsubWs = wsManager.addGlobalMessageListener((event) => {
      if (event.connectionId !== 'low-freq') return

      let text: string
      if (typeof event.data === 'string') {
        text = event.data
      } else if (event.data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(event.data)
      } else if (event.data instanceof Blob) {
        event.data.text().then((t) => processAlarmMessage(t)).catch(() => {})
        return
      } else {
        return
      }
      processAlarmMessage(text)
    })
  }

  function processAlarmMessage(text: string): void {
    let msg: { type?: string; data?: { level?: string; message?: string; timestamp?: number; deviceId?: string } }
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }

    // 服务端格式: { type: 'alarm', data: { level, message, timestamp, deviceId } }
    if (msg.type === 'alarm' && msg.data) {
      _alarmSeq++
      const deviceId = msg.data.deviceId ?? 'unknown'
      const item: AlarmItem = {
        id: `alarm-${Date.now()}-${_alarmSeq}`,
        deviceId,
        deviceName: deviceId !== 'unknown' ? deviceId : '未知设备',
        level: (msg.data.level as AlarmLevel) ?? 'info',
        message: msg.data.message ?? '未知告警',
        value: undefined,
        threshold: undefined,
        timestamp: msg.data.timestamp ?? Date.now(),
        acknowledged: false,
      }
      addAlarms([item])
    }

    // 服务端格式: { type: 'pong' } — 心跳响应，忽略
  }

  function $reset(): void {
    if (unsubWs) { unsubWs(); unsubWs = null }
    alarms.value = []
    filterLevel.value = 'all'
  }

  return {
    alarms,
    filterLevel,
    filteredAlarms,
    unacknowledgedCount,
    latestAlarm,
    addAlarms,
    acknowledge,
    acknowledgeAll,
    setFilter,
    bindWs,
    $reset,
  }
})
