import { ref, readonly, computed } from 'vue'
import { defineStore } from 'pinia'
import type { CameraInfo, CameraStatus } from '@/types/dashboard'
import { WebSocketManager } from '@/services/wsManager'

/** 单路最大播放时长（避免连接泄漏），超过后自动断开重连 */
const MAX_PLAY_DURATION_MS = 30 * 60 * 1000

export const useCameraStore = defineStore('camera', () => {
  /** 所有摄像头信息 */
  const cameras = ref<Map<string, CameraInfo>>(new Map())

  /** 当前正在播放的摄像头 ID 集合 */
  const activePlayers = ref<Set<string>>(new Set())

  /** 最大同时播放路数 */
  const maxConcurrent = ref(4)

  /** 信令 WebSocket 是否已连接 */
  const signalingReady = ref(false)

  // ---------- Getters ----------
  const cameraList = computed<CameraInfo[]>(() =>
    Array.from(cameras.value.values()),
  )

  const onlineCameras = computed<CameraInfo[]>(() =>
    cameraList.value.filter((c) => c.status === 'online'),
  )

  const activeCount = computed(() => activePlayers.value.size)

  const canPlayMore = computed(() => activeCount.value < maxConcurrent.value)

  // ---------- Actions ----------
  function setCameras(list: CameraInfo[]): void {
    const map = new Map<string, CameraInfo>()
    for (const c of list) {
      map.set(c.cameraId, c)
    }
    cameras.value = map
  }

  function updateCameraStatus(cameraId: string, status: CameraStatus): void {
    const cam = cameras.value.get(cameraId)
    if (cam) {
      cam.status = status
      cam.connectedAt = status === 'online' ? Date.now() : cam.connectedAt
    }
  }

  function registerPlayer(cameraId: string): boolean {
    if (!canPlayMore.value && !activePlayers.value.has(cameraId)) {
      return false
    }
    activePlayers.value = new Set([...activePlayers.value, cameraId])
    updateCameraStatus(cameraId, 'connecting')
    return true
  }

  function unregisterPlayer(cameraId: string): void {
    const next = new Set(activePlayers.value)
    next.delete(cameraId)
    activePlayers.value = next
    updateCameraStatus(cameraId, 'online')
  }

  /**
   * 将摄像头列表同步到服务端，以便服务端知道前端需要哪些流
   * （某些信令方案需要预先告知前端订阅的摄像头）
   */
  function syncActiveCameras(): void {
    const conn = WebSocketManager.getInstance().getConnection('signaling')
    if (conn && conn.state === 'connected') {
      conn.send(JSON.stringify({
        type: 'get-cameras',
        cameraIds: Array.from(activePlayers.value),
      }))
    }
  }

  /** 收到服务端的 camera-status 消息时调用 */
  function handleCameraStatus(msg: { cameraId: string; status: CameraStatus }): void {
    const cam = cameras.value.get(msg.cameraId)
    if (cam) {
      cam.status = msg.status
      if (msg.status === 'online') cam.connectedAt = Date.now()
    }
  }

  function $reset(): void {
    cameras.value = new Map()
    activePlayers.value = new Set()
    signalingReady.value = false
  }

  return {
    cameras: readonly(cameras),
    cameraList,
    onlineCameras,
    activePlayers: readonly(activePlayers),
    activeCount,
    canPlayMore,
    maxConcurrent,
    signalingReady,
    setCameras,
    updateCameraStatus,
    registerPlayer,
    unregisterPlayer,
    syncActiveCameras,
    handleCameraStatus,
    $reset,
  }
})
