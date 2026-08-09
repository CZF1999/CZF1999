<template>
  <div
    class="webrtc-player"
    :class="{
      'is-online': state.connectionState === 'connected',
      'is-connecting': state.connectionState === 'connecting',
      'is-error': !!state.error,
      'has-audio': showAudio,
    }"
    :style="containerStyle"
  >
    <!-- 视频画面 -->
    <video
      ref="videoRef"
      class="player-video"
      autoplay
      playsinline
      muted
      :srcObject="remoteStream"
      @loadedmetadata="onVideoReady"
    />

    <!-- 加载遮罩 -->
    <div v-if="state.connectionState !== 'connected'" class="player-overlay">
      <div class="overlay-content">
        <span class="spinner" v-if="state.connectionState === 'connecting' || state.connectionState === 'new'" />
        <span class="icon-warning" v-else-if="state.error">!</span>
        <span class="status-text">
          <template v-if="state.connectionState === 'connecting'">连接中...</template>
          <template v-else-if="state.connectionState === 'new'">等待连接</template>
          <template v-else-if="state.error">{{ state.error }}</template>
          <template v-else>离线</template>
        </span>
        <button v-if="state.error" class="btn-retry" @click="handleRetry">重试</button>
      </div>
    </div>

    <!-- 信息栏 -->
    <div class="player-info-bar">
      <span class="camera-name" :title="cameraName">{{ cameraName }}</span>
      <span class="latency" v-if="state.connectionState === 'connected'">
        {{ latestLatency }}ms
      </span>
      <span class="status-dot" :class="statusDotClass" />
    </div>

    <!-- 对讲按钮 -->
    <button
      v-if="showAudio"
      class="btn-talk"
      :class="{ active: talking }"
      :disabled="talkDisabled"
      :title="talkTitle"
      @click="toggleTalk"
    >
      <span class="mic-icon">{{ talking ? '&#x1F3A4;' : '&#x1F507;' }}</span>
    </button>

    <!-- 全屏按钮 -->
    <button class="btn-fullscreen" @click="toggleFullscreen" title="全屏">
      <span>&#x26F6;</span>
    </button>

    <!-- 分辨率标签（可选） -->
    <span v-if="resolution" class="resolution-tag">{{ resolution }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, readonly } from 'vue'
import { useWebRTC } from '@/composables/useWebRTC'
import { useCameraStore } from '@/stores/cameraStore'
import { useCameraPermission } from '@/composables/useCameraPermission'
import { VideoSyncManager } from '@/utils/VideoSyncManager'
import type { VideoSyncPoint } from '@/types/dashboard'

const props = withDefaults(defineProps<{
  cameraId: string
  cameraName?: string
  serverUrl?: string
  showAudio?: boolean
  iceServers?: RTCIceServer[]
  /** 容器宽高，为空则 100% */
  width?: number | string
  height?: number | string
  /** 是否启用时间戳同步回调 */
  enableSync?: boolean
}>(), {
  cameraName: '',
  serverUrl: 'ws://localhost:3001/ws/signaling',
  showAudio: false,
  enableSync: false,
})

const emit = defineEmits<{
  (e: 'connected', cameraId: string): void
  (e: 'disconnected', cameraId: string): void
  (e: 'error', error: string): void
  (e: 'sync', point: VideoSyncPoint): void
}>()

// ==================== Store & Composables ====================
const cameraStore = useCameraStore()
const { acquireMicrophoneStream } = useCameraPermission()

const {
  state,
  remoteStream,
  talking,
  start,
  stop,
  destroy,
  startTalk,
  stopTalk,
} = useWebRTC({
  cameraId: props.cameraId,
  signalingConnectionId: 'signaling',
  iceServers: props.iceServers,
})

const syncManager = props.enableSync ? new VideoSyncManager() : null

// ==================== Refs ====================
const videoRef = ref<HTMLVideoElement | null>(null)
const latencyStart = ref(0)
const latestLatency = ref(0)

// ==================== Computed ====================
const containerStyle = computed(() => {
  const s: Record<string, string> = {}
  if (props.width) s.width = typeof props.width === 'number' ? `${props.width}px` : props.width
  if (props.height) s.height = typeof props.height === 'number' ? `${props.height}px` : props.height
  return s
})

const statusDotClass = computed(() => ({
  'dot-online': state.value.connectionState === 'connected',
  'dot-connecting': state.value.connectionState === 'connecting',
  'dot-error': !!state.value.error || state.value.connectionState === 'failed',
}))

const talkDisabled = computed(() =>
  state.value.connectionState !== 'connected',
)

const talkTitle = computed(() =>
  talking.value ? '关闭对讲' : '开启对讲',
)

const resolution = ref<string | null>(null)

// ==================== 生命周期 ====================
onMounted(() => {
  // 注册到 store
  const ok = cameraStore.registerPlayer(props.cameraId)
  if (!ok) {
    state.value.error = '已达到最大播放路数限制'
    emit('error', '已达到最大播放路数限制')
    return
  }
  connect()
})

onUnmounted(() => {
  cameraStore.unregisterPlayer(props.cameraId)
  syncManager?.detach()
  destroy()
})

// ==================== 方法 ====================
async function connect(): Promise<void> {
  await start()
}

function handleRetry(): void {
  state.value.error = null
  connect()
}

function onVideoReady(): void {
  const video = videoRef.value
  if (!video) return
  cameraStore.updateCameraStatus(props.cameraId, 'online')

  if (video.videoWidth) {
    resolution.value = `${video.videoWidth}x${video.videoHeight}`
  }

  // 启动时间戳同步
  if (syncManager && video) {
    syncManager.markPlayStart()
    syncManager.attach(video, (point) => {
      emit('sync', point)
    })
  }

  // 简单延迟测量
  latencyStart.value = Date.now()
  // 每次播放时估算延迟（从 SDP 或 remote HR timestamp 可更准确）
  latestLatency.value = Date.now() - latencyStart.value
  // 持续更新延迟
  const trackLatency = (): void => {
    if (!video || video.paused || video.ended) return
    // 基于播放进度估算（简化；实际应使用 RTCP SR 或 getStats）
    const playTime = video.currentTime * 1000
    const wallTime = Date.now() - latencyStart.value
    latestLatency.value = Math.max(0, Math.round(wallTime - playTime))
    requestAnimationFrame(trackLatency)
  }
  trackLatency()

  emit('connected', props.cameraId)
}

// ==================== 对讲 ====================
async function toggleTalk(): Promise<void> {
  if (talking.value) {
    stopTalk()
  } else {
    const ok = await startTalk()
    if (!ok) {
      // 权限或采集失败已在 useWebRTC 内部设置 error
    }
  }
}

// ==================== 全屏 ====================
async function toggleFullscreen(): Promise<void> {
  const el = videoRef.value?.parentElement
  if (!el) return
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await el.requestFullscreen()
    }
  } catch { /* 某些元素不支持全屏 */ }
}

// ==================== watch：cameraId 切换 ====================
watch(
  () => props.cameraId,
  (newId, oldId) => {
    if (oldId) {
      cameraStore.unregisterPlayer(oldId)
      syncManager?.detach()
      stop()
    }
    if (newId) {
      cameraStore.registerPlayer(newId)
      connect()
    }
  },
)
</script>

<style scoped lang="less">
.webrtc-player {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 200px;
  min-height: 150px;
  background: #0a0f1e;
  border-radius: 6px;
  overflow: hidden;
  will-change: transform;
  border: 1px solid rgba(30, 144, 255, 0.15);
  transition: border-color 0.3s;

  &.is-online {
    border-color: rgba(0, 200, 100, 0.35);
  }
  &.is-error {
    border-color: rgba(255, 80, 80, 0.45);
  }
}

.player-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

// ---------- 遮罩 ----------
.player-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 12, 40, 0.75);
  backdrop-filter: blur(2px);
  z-index: 2;
}
.overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #8899bb;
  font-size: 13px;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(30, 144, 255, 0.2);
  border-top-color: #1e90ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.icon-warning {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 80, 80, 0.25);
  color: #ff5050;
  font-weight: bold;
  font-size: 16px;
  line-height: 28px;
  text-align: center;
}
.btn-retry {
  padding: 4px 16px;
  border: 1px solid #1e90ff;
  border-radius: 4px;
  background: transparent;
  color: #1e90ff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
  &:hover { background: rgba(30, 144, 255, 0.15); }
}

// ---------- 信息栏 ----------
.player-info-bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  background: linear-gradient(transparent, rgba(0,0,0,0.65));
  z-index: 3;
  font-size: 11px;
  color: rgba(255,255,255,0.7);
}
.camera-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.latency {
  font-family: 'Consolas', monospace;
  color: rgba(255,255,255,0.5);
}
.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #666;
  flex-shrink: 0;
  &.dot-online { background: #00c864; box-shadow: 0 0 4px rgba(0,200,100,0.5); }
  &.dot-connecting { background: #ffaa00; animation: pulse 1s infinite; }
  &.dot-error { background: #ff5050; }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

// ---------- 按钮 ----------
.btn-talk, .btn-fullscreen {
  position: absolute;
  z-index: 4;
  width: 32px; height: 32px;
  border: none;
  border-radius: 4px;
  background: rgba(0,0,0,0.45);
  color: rgba(255,255,255,0.7);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, color 0.2s;
  &:hover { background: rgba(0,0,0,0.7); color: #fff; }
  &:disabled { opacity: 0.35; cursor: not-allowed; }
}
.btn-talk {
  bottom: 36px;
  right: 8px;
  &.active {
    background: rgba(220, 50, 50, 0.6);
    color: #fff;
  }
}
.btn-fullscreen {
  top: 6px;
  right: 6px;
}
.mic-icon {
  font-size: 14px;
  line-height: 1;
}

// ---------- 分辨率标签 ----------
.resolution-tag {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(0,0,0,0.5);
  font-size: 10px;
  color: rgba(255,255,255,0.5);
  pointer-events: none;
}
</style>
