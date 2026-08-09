<template>
  <div class="webrtc-page">
    <header class="page-header">
      <h1>摄像头监控</h1>
      <div class="header-actions">
        <input
          v-model="vodBaseUrl"
          class="vod-url-input"
          placeholder="VOD 服务地址"
          title="HLS 流媒体服务地址"
        />
        <span class="conn-status" :class="signalingReady ? 'online' : 'offline'">
          {{ signalingReady ? '信令已连接' : '信令未连接' }}
        </span>
        <button class="btn-refresh" @click="refreshCameras" :disabled="!signalingReady">
          刷新列表
        </button>
      </div>
    </header>

    <!-- 摄像头列表 -->
    <section class="camera-list">
      <article
        v-for="cam in cameraStore.cameraList"
        :key="cam.cameraId"
        class="camera-card"
        :class="{ active: activeCameras.has(cam.cameraId) }"
        @dblclick="toggleCamera(cam.cameraId)"
      >
        <div class="card-thumb" v-if="!activeCameras.has(cam.cameraId)">
          <span class="card-icon">&#x1F4F7;</span>
          <span class="card-hint">双击播放</span>
        </div>
        <VideoPlayer
          v-else
          :key="cam.cameraId"
          :camera-id="cam.cameraId"
          :camera-name="cam.name"
          :mode="getCameraMode(cam.cameraId)"
          :vod-playlist-url="activeCameras.get(cam.cameraId)?.vodPlaylistUrl ?? ''"
          :show-mode-switch="true"
          :muted="true"
          @connected="onCameraConnected(cam.cameraId)"
          @disconnected="onCameraDisconnected(cam.cameraId)"
          @error="onCameraError"
          @mode-change="(mode: 'live' | 'vod') => onModeChange(cam.cameraId, mode)"
        />
        <!-- VOD 时间范围配置 -->
        <div v-if="getCameraMode(cam.cameraId) === 'vod'" class="vod-config">
          <label class="vod-label">回放时段</label>
          <div class="vod-time-row">
            <input
              type="datetime-local"
              class="vod-time-input"
              :value="getCameraState(cam.cameraId).vodStart"
              @input="(e) => { const s = getCameraState(cam.cameraId); s.vodStart = (e.target as HTMLInputElement).value; scheduleFetchVodUrl(cam.cameraId) }"
            />
            <span class="vod-time-sep">至</span>
            <input
              type="datetime-local"
              class="vod-time-input"
              :value="getCameraState(cam.cameraId).vodEnd"
              @input="(e) => { const s = getCameraState(cam.cameraId); s.vodEnd = (e.target as HTMLInputElement).value; scheduleFetchVodUrl(cam.cameraId) }"
            />
          </div>
          <div v-if="getCameraState(cam.cameraId).vodLoading" class="vod-status vod-loading">
            获取播放地址...
          </div>
          <div v-else-if="getCameraState(cam.cameraId).vodError" class="vod-status vod-error">
            {{ getCameraState(cam.cameraId).vodError }}
          </div>
        </div>
        <div class="card-info">
          <span class="cam-name">{{ cam.name }}</span>
          <span class="cam-status" :class="cam.status">{{ statusLabel(cam.status) }}</span>
          <button
            v-if="activeCameras.has(cam.cameraId)"
            class="btn-mode-toggle"
            :class="getCameraMode(cam.cameraId)"
            @click.stop="onModeChange(cam.cameraId, getCameraMode(cam.cameraId) === 'live' ? 'vod' : 'live')"
          >
            {{ getCameraMode(cam.cameraId) === 'live' ? '📼 回放' : '📡 实时' }}
          </button>
          <span class="cam-res" v-if="cam.resolution">{{ cam.resolution.width }}x{{ cam.resolution.height }}</span>
        </div>
      </article>

      <!-- 空状态 -->
      <div v-if="cameraStore.cameraList.length === 0" class="empty-state">
        <span class="empty-icon">&#x1F4E1;</span>
        <p>暂无可用摄像头</p>
        <p class="empty-hint">请确认信令服务已启动，摄像头端已注册</p>
      </div>
    </section>

    <!-- 连接数指示 -->
    <footer class="page-footer">
      播放中: {{ activeCameras.size }} / {{ cameraStore.maxConcurrent }}
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { WebSocketManager } from '@/services/wsManager'
import { useCameraStore } from '@/stores/cameraStore'
import type { CameraInfo, CameraStatus } from '@/types/dashboard'
import VideoPlayer from '@/components/video/VideoPlayer.vue'

const cameraStore = useCameraStore()
const wsManager = WebSocketManager.getInstance()

const signalingReady = ref(false)
const vodBaseUrl = ref(import.meta.env.VITE_VOD_BASE_URL ?? 'http://10.122.147.40:3001')

interface CameraPlayState {
  mode: 'live' | 'vod'
  vodStart: string
  vodEnd: string
  /** API 返回的播放地址（路径部分，如 /recordings/.../index.m3u8） */
  vodPlaylistUrl: string
  vodLoading: boolean
  vodError: string | null
}
const activeCameras = reactive(new Map<string, CameraPlayState>())

// API 调用防抖 timer
const vodFetchTimers = new Map<string, ReturnType<typeof setTimeout>>()

// 默认 VOD 时间范围：最近 1 小时
function defaultVodRange(): { start: string; end: string } {
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const fmt = (d: Date) => {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16)
  }
  return { start: fmt(oneHourAgo), end: fmt(now) }
}

function createDefaultState(): CameraPlayState {
  const range = defaultVodRange()
  return { mode: 'live', vodStart: range.start, vodEnd: range.end, vodPlaylistUrl: '', vodLoading: false, vodError: null }
}

function getCameraState(cameraId: string): CameraPlayState {
  const existing = activeCameras.get(cameraId)
  if (existing) return existing
  return createDefaultState()
}

function getCameraMode(cameraId: string): 'live' | 'vod' {
  return activeCameras.get(cameraId)?.mode ?? 'live'
}

/** 调用 API 获取 HLS 播放地址 */
async function fetchVodUrl(cameraId: string): Promise<void> {
  const state = activeCameras.get(cameraId)
  if (!state || state.mode !== 'vod') return

  const start = new Date(state.vodStart).toISOString()
  const end = new Date(state.vodEnd).toISOString()
  const apiUrl = `${vodBaseUrl.value}/api/vod/${cameraId}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`

  state.vodLoading = true
  state.vodError = null

  try {
    const res = await fetch(apiUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { url: string; cameraId: string; date: string }
    if (!data.url) throw new Error('响应缺少 url 字段')
    // url 是路径，拼接 baseUrl 得到完整播放地址
    state.vodPlaylistUrl = /^https?:\/\//.test(data.url) ? data.url : `${vodBaseUrl.value}${data.url}`
  } catch (e) {
    state.vodError = (e as Error).message
    state.vodPlaylistUrl = ''
  } finally {
    state.vodLoading = false
  }
}

/** 带防抖的 API 调用 */
function scheduleFetchVodUrl(cameraId: string): void {
  const existing = vodFetchTimers.get(cameraId)
  if (existing) clearTimeout(existing)
  vodFetchTimers.set(cameraId, setTimeout(() => {
    vodFetchTimers.delete(cameraId)
    fetchVodUrl(cameraId)
  }, 500))
}

function onModeChange(cameraId: string, mode: 'live' | 'vod'): void {
  const state = activeCameras.get(cameraId)
  if (!state) return
  state.mode = mode
  if (mode === 'vod') {
    fetchVodUrl(cameraId)
  } else {
    state.vodPlaylistUrl = ''
    state.vodError = null
  }
}

// ==================== WebSocket 信令连接 ====================
onMounted(() => {
  // 创建信令连接
  wsManager.createConnection({
    id: 'signaling',
    url: import.meta.env.VITE_WS_SIGNALING ?? 'ws://10.122.147.40:3001/ws/signaling',
    heartbeatInterval: 15_000,
    heartbeatMessage: '{"type":"ping"}',
    timeout: 5_000,
    reconnectMaxAttempts: 10,
    reconnectBaseDelay: 1_000,
  })
  
  // 监听信令消息，更新 cameraStore
  const unsub = wsManager.addGlobalMessageListener((event) => {
    if (event.connectionId !== 'signaling') return

    let text: string
    if (typeof event.data === 'string') text = event.data
    else if (event.data instanceof ArrayBuffer) text = new TextDecoder().decode(event.data)
    else if (event.data instanceof Blob) {
      event.data.text().then((t) => handleMsg(JSON.parse(t))).catch(() => {})
      return
    } else return

    try { handleMsg(JSON.parse(text)) } catch { /* 忽略 */ }
  })
  console.log(unsub);
  

  const conn = wsManager.getConnection('signaling')
  console.log(conn);
  
  conn?.onStateChange((state) => {
    signalingReady.value = state === 'connected'
    if (state === 'connected') {
      // 连接成功后立即请求摄像头列表
      conn.send(JSON.stringify({ type: 'get-cameras' }))
    }
  })

  conn?.connect()

  onUnmounted(() => {
    unsub()
    wsManager.removeConnection('signaling')
    vodFetchTimers.forEach((t) => clearTimeout(t))
    vodFetchTimers.clear()
    activeCameras.clear()
    cameraStore.$reset()
  })
})

// ==================== 消息处理 ====================
function handleMsg(msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'camera-list': {
      const cameras = (msg.cameras as CameraInfo[]) ?? []
      cameraStore.setCameras(cameras)
      break
    }
    case 'camera-status':
    case 'producer-online': {
      cameraStore.handleCameraStatus({
        cameraId: msg.cameraId as string,
        status: 'online',
      })
      break
    }
    case 'producer-offline': {
      cameraStore.handleCameraStatus({
        cameraId: msg.cameraId as string,
        status: 'offline',
      })
      break
    }
  }
}

// ==================== 交互 ====================
function toggleCamera(cameraId: string): void {
  if (activeCameras.has(cameraId)) {
    activeCameras.delete(cameraId)
  } else {
    if (activeCameras.size >= cameraStore.maxConcurrent) {
      const first = activeCameras.keys().next().value
      if (first) activeCameras.delete(first)
    }
    activeCameras.set(cameraId, createDefaultState())
  }
}

function refreshCameras(): void {
  const conn = wsManager.getConnection('signaling')
  if (conn?.state === 'connected') {
    conn.send(JSON.stringify({ type: 'get-cameras' }))
  }
}

function onCameraConnected(cameraId: string): void {
  cameraStore.updateCameraStatus(cameraId, 'online')
}

function onCameraDisconnected(cameraId: string): void {
  cameraStore.updateCameraStatus(cameraId, 'offline')
  activeCameras.delete(cameraId)
}

function onCameraError(err: string): void {
  console.warn('[WebRTCView] Camera error:', err)
}

function statusLabel(status: CameraStatus): string {
  return { online: '在线', offline: '离线', connecting: '连接中' }[status] ?? status
}
</script>

<style scoped lang="less">
.webrtc-page {
  min-height: 100vh;
  padding: 20px 24px;
  background: #0c1430;
  color: #c8d6e5;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;

  h1 {
    font-size: 22px;
    font-weight: 600;
    color: #e0e8f8;
    margin: 0;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.conn-status {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 10px;
  &.online { background: rgba(0,200,100,0.15); color: #00c864; }
  &.offline { background: rgba(255,100,100,0.15); color: #ff6464; }
}

.vod-url-input {
  width: 260px;
  padding: 4px 10px;
  border: 1px solid rgba(30,144,255,0.25);
  border-radius: 4px;
  background: rgba(0,0,0,0.25);
  color: #8ab4e0;
  font-size: 11px;
  font-family: Consolas, monospace;
  outline: none;
  &::placeholder { color: rgba(255,255,255,0.15); }
  &:focus { border-color: rgba(30,144,255,0.5); }
}

.btn-refresh {
  padding: 5px 14px;
  border: 1px solid rgba(30,144,255,0.4);
  border-radius: 4px;
  background: transparent;
  color: #1e90ff;
  font-size: 12px;
  cursor: pointer;
  &:hover:not(:disabled) { background: rgba(30,144,255,0.1); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

// ---------- Camera Grid ----------
.camera-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 16px;
}

.camera-card {
  position: relative;
  background: rgba(6,14,36,0.8);
  border: 1px solid rgba(30,144,255,0.12);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.25s;
  min-height: 280px;

  &.active {
    border-color: rgba(0,200,100,0.3);
  }
  &:hover { border-color: rgba(30,144,255,0.3); }

  .webrtc-player {
    height: 240px;
  }
}

.card-thumb {
  height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0,0,0,0.2);
}
.card-icon {
  font-size: 36px;
  opacity: 0.3;
}
.card-hint {
  font-size: 12px;
  color: rgba(255,255,255,0.2);
}

.card-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  font-size: 12px;
}
.cam-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #aab8d0;
}
.cam-status {
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 11px;
  &.online { background: rgba(0,200,100,0.15); color: #00c864; }
  &.offline { background: rgba(100,100,100,0.2); color: #888; }
  &.connecting { background: rgba(255,170,0,0.15); color: #faa; }
}
.cam-res {
  font-family: Consolas, monospace;
  color: rgba(255,255,255,0.3);
}

.btn-mode-toggle {
  padding: 2px 8px;
  border: 1px solid rgba(30, 144, 255, 0.3);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.25);
  color: #8ab4e0;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: rgba(30, 144, 255, 0.2); border-color: rgba(30, 144, 255, 0.5); }
  &.vod { border-color: rgba(230, 162, 60, 0.4); color: #e6a23c; }
}

// ---------- VOD 配置 ----------
.vod-config {
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.25);
  border-top: 1px solid rgba(30, 144, 255, 0.1);
}
.vod-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 4px;
  display: block;
}
.vod-time-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.vod-time-input {
  flex: 1;
  padding: 3px 6px;
  border: 1px solid rgba(30, 144, 255, 0.2);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.3);
  color: #8ab4e0;
  font-size: 10px;
  font-family: Consolas, monospace;
  outline: none;
  &::-webkit-calendar-picker-indicator {
    filter: invert(0.6);
    cursor: pointer;
  }
  &:focus { border-color: rgba(30, 144, 255, 0.5); }
}
.vod-time-sep {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}
.vod-status {
  margin-top: 4px;
  font-size: 10px;
  &.vod-loading { color: #1e90ff; }
  &.vod-error { color: #ff5050; }
}

// ---------- Empty ----------
.empty-state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 0;
  color: rgba(255,255,255,0.25);
  .empty-icon { font-size: 48px; margin-bottom: 12px; }
  p { margin: 0; font-size: 14px; }
  .empty-hint { font-size: 12px; margin-top: 6px; opacity: 0.6; }
}

// ---------- Footer ----------
.page-footer {
  margin-top: 16px;
  text-align: right;
  font-size: 12px;
  color: rgba(255,255,255,0.25);
}
</style>
