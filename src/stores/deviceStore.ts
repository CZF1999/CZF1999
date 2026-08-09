import { shallowRef, readonly, ref } from 'vue'
import { defineStore } from 'pinia'
import type { DeviceData, SubscriberId, DeviceType, DeviceStatus } from '@/types/dashboard'
import { uid } from '@/utils/dashboard'
import { WebSocketManager } from '@/services/wsManager'

// ==================== 服务端消息类型 ====================
interface ServerDeviceItem {
  deviceId: string
  timestamp: number
  type?: string
  temperature: number
  rpm: number
  status: number
  pressure?: number
  voltage?: number
  current?: number
  power?: number
  vibration?: number
  humidity?: number
}

interface ServerMessage {
  type: string
  data?: ServerDeviceItem | ServerDeviceItem[]
  deviceIds?: string[]
  deviceId?: string
  totalSubscriptions?: number
}

// ==================== 批量更新缓冲区 ====================
interface PendingUpdate {
  deviceId: string
  data: DeviceData
}

/** 根据 deviceId 生成稳定的模拟坐标（避免每次更新位置跳动） */
function hashPosition(id: string): { lng: number; lat: number } {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash |= 0
  }
  // 在 110-120°E, 30-35°N 范围内分布
  return {
    lng: 113 + ((hash % 1000) / 1000) * 7,
    lat: 31 + (((hash >> 10) % 1000) / 1000) * 4,
  }
}

/** 将服务端扁平数据映射为前端 DeviceData 格式 */
function mapToDeviceData(raw: ServerDeviceItem): DeviceData {
  const statusMap: Record<number, DeviceStatus> = { 0: 'online', 1: 'warning', 2: 'error' }
  const validTypes: DeviceType[] = ['motor', 'pump', 'conveyor', 'sensor']
  return {
    deviceId: raw.deviceId,
    deviceName: raw.deviceId,
    type: validTypes.includes(raw.type as DeviceType) ? (raw.type as DeviceType) : 'motor',
    status: statusMap[raw.status] ?? 'online',
    position: hashPosition(raw.deviceId),
    metrics: {
      speed: raw.rpm,
      temperature: raw.temperature,
      pressure: raw.pressure,
      voltage: raw.voltage,
      current: raw.current,
      power: raw.power,
      vibration: raw.vibration,
      humidity: raw.humidity,
    },
    timestamp: raw.timestamp,
  }
}

export const useDeviceStore = defineStore('device', () => {
  // 使用 shallowRef — 数据量大时避免深度响应式开销
  // key: deviceId, value: 最新的 DeviceData
  const deviceMap = shallowRef<Map<string, DeviceData>>(new Map())

  // 服务端已知的设备 ID 列表
  const serverDeviceIds = ref<string[]>([])

  // 订阅表: deviceId → Set<subscriberId>
  const subscriptions = new Map<string, Set<SubscriberId>>()

  // 反向索引: subscriberId → Set<deviceId>
  const subscriberIndex = new Map<SubscriberId, Set<string>>()

  // requestAnimationFrame 合并缓冲区
  let pendingUpdates: PendingUpdate[] = []
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null
  const batchListeners = new Set<(devices: DeviceData[]) => void>()

  function getDevice(deviceId: string): DeviceData | undefined {
    return deviceMap.value.get(deviceId)
  }

  function getAllDevices(): DeviceData[] {
    return Array.from(deviceMap.value.values())
  }

  /**
   * 向服务端发送订阅消息
   */
  function sendServerSubscribe(deviceIds: string[]): void {
    const conn = WebSocketManager.getInstance().getConnection('high-freq')
    if (conn && deviceIds.length > 0) {
      conn.send(JSON.stringify({ action: 'subscribe', deviceIds }))
    }
  }

  /**
   * 订阅设备数据（前端级）。同时同步到服务端。
   */
  function subscribe(deviceIds: string[], subscriberId?: SubscriberId): SubscriberId {
    const sid = subscriberId ?? uid('sub')
    for (const deviceId of deviceIds) {
      if (!subscriptions.has(deviceId)) {
        subscriptions.set(deviceId, new Set())
      }
      subscriptions.get(deviceId)!.add(sid)

      if (!subscriberIndex.has(sid)) {
        subscriberIndex.set(sid, new Set())
      }
      subscriberIndex.get(sid)!.add(deviceId)
    }

    // 收集所有已被前端订阅的设备 ID，发送给服务端
    const allSubscribed = Array.from(subscriptions.keys())
    sendServerSubscribe(allSubscribed)
    return sid
  }

  function unsubscribe(subscriberId: SubscriberId, deviceIds?: string[]): void {
    const ids = deviceIds ?? Array.from(subscriberIndex.get(subscriberId) ?? [])
    for (const deviceId of ids) {
      subscriptions.get(deviceId)?.delete(subscriberId)
      if (subscriptions.get(deviceId)?.size === 0) {
        subscriptions.delete(deviceId)
      }
    }
    if (!deviceIds) {
      subscriberIndex.delete(subscriberId)
    } else {
      const remaining = subscriberIndex.get(subscriberId)
      if (remaining) {
        for (const id of deviceIds) remaining.delete(id)
        if (remaining.size === 0) subscriberIndex.delete(subscriberId)
      }
    }

    // 同步服务端：发送剩余订阅集合
    const allSubscribed = Array.from(subscriptions.keys())
    sendServerSubscribe(allSubscribed)
  }

  function hasSubscriber(deviceId: string): boolean {
    return (subscriptions.get(deviceId)?.size ?? 0) > 0
  }

  function getSubscribers(deviceId: string): SubscriberId[] {
    return Array.from(subscriptions.get(deviceId) ?? [])
  }

  function ingestData(rawList: DeviceData[]): void {
    for (const data of rawList) {
      pendingUpdates.push({ deviceId: data.deviceId, data })
    }
    scheduleFlush()
  }

  function scheduleFlush(): void {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      flush()
    })
  }

  function flush(): void {
    if (pendingUpdates.length === 0) return

    const latest = new Map<string, DeviceData>()
    for (const { deviceId, data } of pendingUpdates) {
      latest.set(deviceId, data)
    }

    const newMap = new Map(deviceMap.value)
    for (const [deviceId, data] of latest) {
      newMap.set(deviceId, data)
    }
    deviceMap.value = newMap

    const subscribedDevices = Array.from(latest.entries())
      .filter(([deviceId]) => hasSubscriber(deviceId))
      .map(([, data]) => data)

    if (subscribedDevices.length > 0) {
      for (const cb of batchListeners) {
        try { cb(subscribedDevices) } catch { /* 隔离异常 */ }
      }
    }
    pendingUpdates = []
  }

  function onBatch(cb: (devices: DeviceData[]) => void): () => void {
    batchListeners.add(cb)
    return () => { batchListeners.delete(cb) }
  }

  // ---------- WebSocket 集成 ----------
  let unsubWs: (() => void) | null = null

  function bindWsManager(): void {
    if (unsubWs) return
    const wsManager = WebSocketManager.getInstance()
    unsubWs = wsManager.addGlobalMessageListener((event) => {
      if (event.connectionId !== 'high-freq') return

      let text: string
      if (typeof event.data === 'string') {
        text = event.data
      } else if (event.data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(event.data)
      } else if (event.data instanceof Blob) {
        event.data.text().then((t) => processDeviceMessage(t)).catch(() => {})
        return
      } else {
        return
      }
      processDeviceMessage(text)
    })
  }

  function processDeviceMessage(text: string): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }

    switch (msg.type) {
      case 'device-list': {
        // 服务端告知可用设备列表
        if (msg.deviceIds) {
          serverDeviceIds.value = msg.deviceIds
          // 自动订阅全部设备：同时注册前端级订阅 + 发送服务端订阅
          subscribe(msg.deviceIds, 'auto-system')
        }
        break
      }
      case 'device-data': {
        // 服务端推送的设备数据
        if (!msg.data) return
        const items = Array.isArray(msg.data) ? msg.data : [msg.data]
        const mapped = items.map(mapToDeviceData)
        ingestData(mapped)
        break
      }
      case 'subscribed': {
        // 订阅确认（可忽略，仅日志）
        break
      }
      // 忽略其他类型
    }
  }

  function injectData(rawList: DeviceData[]): void {
    ingestData(rawList)
  }

  function $reset(): void {
    if (unsubWs) { unsubWs(); unsubWs = null }
    deviceMap.value = new Map()
    serverDeviceIds.value = []
    subscriptions.clear()
    subscriberIndex.clear()
    pendingUpdates = []
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  return {
    deviceMap: readonly(deviceMap),
    serverDeviceIds: readonly(serverDeviceIds),
    getDevice,
    getAllDevices,
    subscribe,
    unsubscribe,
    hasSubscriber,
    getSubscribers,
    ingestData,
    injectData,
    onBatch,
    bindWsManager,
    $reset,
  }
})
