<template>
  <div
    class="video-player"
    :class="{
      'is-live': mode === 'live' && liveState.connectionState === 'connected',
      'is-connecting': mode === 'live' && liveState.connectionState === 'connecting',
      'is-error': hasError,
      'is-vod': mode === 'vod',
      'is-paused': mode === 'vod' && vodState.status === 'paused',
    }"
    :style="containerStyle"
  >
    <video
      ref="videoRef"
      class="player-video"
      autoplay
      playsinline
      :muted="isEffectivelyMuted"
      :srcObject="mode === 'live' ? remoteStream : null"
      @loadedmetadata="onVideoReady"
      @ended="onVideoEnded"
      @click="onVideoClick"
    />

    <!-- 加载 / 错误遮罩 -->
    <div v-if="showOverlay" class="player-overlay">
      <div class="overlay-content">
        <span
          v-if="overlayState === 'loading'"
          class="spinner"
        />
        <span
          v-else-if="overlayState === 'error'"
          class="icon-warning"
        >!</span>
        <span class="status-text">{{ overlayText }}</span>
        <button
          v-if="overlayState === 'error'"
          class="btn-retry"
          @click="handleRetry"
        >
          重试
        </button>
      </div>
    </div>

    <!-- VOD 暂停遮罩 -->
    <div
      v-if="mode === 'vod' && vodState.status === 'paused' && !hasError"
      class="pause-overlay"
      @click="vodPlayer?.togglePlay()"
    >
      <span class="pause-icon">&#9654;</span>
    </div>

    <!-- 信息栏 -->
    <div class="player-info-bar">
      <span class="camera-name" :title="displayName">{{ displayName }}</span>
      <span
        v-if="mode === 'live' && liveState.connectionState === 'connected'"
        class="latency"
      >
        {{ latestLatency }}ms
      </span>
      <span
        v-else-if="mode === 'vod' && vodState.status === 'playing'"
        class="vod-time"
      >
        {{ formatTime(vodCurrentTime) }} / {{ formatTime(vodDuration) }}
      </span>
      <span class="status-dot" :class="statusDotClass" />
    </div>

    <!-- 模式切换栏 -->
    <div v-if="showModeSwitch" class="mode-switch-bar">
      <button
        class="mode-btn"
        :class="{ active: mode === 'live' }"
        @click="mode !== 'live' && toggleMode()"
      >
        实时监控
      </button>
      <button
        class="mode-btn"
        :class="{ active: mode === 'vod' }"
        @click="mode !== 'vod' && toggleMode()"
      >
        历史回放
      </button>
    </div>

    <!-- 全屏按钮 -->
    <button class="btn-fullscreen" @click="toggleFullscreen" title="全屏">
      <span>&#x26F6;</span>
    </button>

    <!-- VOD 控制栏 -->
    <div v-if="mode === 'vod' && showControls && !hasError" class="vod-controls">
      <!-- 进度条 -->
      <div
        class="progress-track"
        ref="progressTrackRef"
        @mousedown="onProgressMouseDown"
      >
        <div class="progress-buffered" :style="{ width: bufferedPercent + '%' }" />
        <div class="progress-filled" :style="{ width: progressPercent + '%' }" />
        <div
          class="progress-thumb"
          :style="{ left: progressPercent + '%' }"
          @mousedown.stop="onThumbMouseDown"
        />
      </div>

      <div class="controls-row">
        <!-- 播放/暂停 -->
        <button class="ctrl-btn" @click="vodPlayer?.togglePlay()" :title="vodState.status === 'playing' ? '暂停' : '播放'">
          <span v-if="vodState.status === 'playing'">&#9649;&#9649;</span>
          <span v-else>&#9654;</span>
        </button>

        <!-- 时间 -->
        <span class="time-display">{{ formatTime(vodCurrentTime) }} / {{ formatTime(vodDuration) }}</span>

        <!-- 倍速选择 -->
        <div class="speed-select">
          <button
            class="ctrl-btn speed-btn"
            @click="cycleSpeed"
            title="播放速度"
          >
            {{ vodPlaybackRate.toFixed(1) }}x
          </button>
          <div class="speed-menu">
            <button
              v-for="rate in speedOptions"
              :key="rate"
              class="speed-item"
              :class="{ active: vodPlaybackRate === rate }"
              @click="vodPlayer?.setPlaybackRate(rate)"
            >
              {{ rate.toFixed(1) }}x
            </button>
          </div>
        </div>

        <!-- 音量 -->
        <button class="ctrl-btn" @click="vodPlayer?.toggleMute()" :title="vodIsMuted ? '取消静音' : '静音'">
          <span v-if="vodIsMuted || vodVolume === 0">&#x1F507;</span>
          <span v-else-if="vodVolume < 0.5">&#x1F508;</span>
          <span v-else>&#x1F50A;</span>
        </button>
        <div class="volume-slider">
          <input
            type="range"
            min="0"
            max="100"
            :value="vodVolume * 100"
            class="volume-range"
            @input="vodPlayer?.setVolume(($event.target as HTMLInputElement).valueAsNumber / 100)"
          />
        </div>

        <!-- 全屏 -->
        <button class="ctrl-btn" @click="toggleFullscreen" title="全屏">
          &#x26F6;
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useWebRTC } from '@/composables/useWebRTC'
import { useVodPlayer } from '@/composables/useVodPlayer'

const props = withDefaults(defineProps<{
  cameraId: string
  mode: 'live' | 'vod'
  vodPlaylistUrl?: string
  vodStart?: string
  vodEnd?: string
  showControls?: boolean
  muted?: boolean
  showModeSwitch?: boolean
  cameraName?: string
  iceServers?: RTCIceServer[]
  autoplay?: boolean
}>(), {
  mode: 'live',
  showControls: undefined,
  muted: false,
  showModeSwitch: false,
  cameraName: '',
  autoplay: true,
})

const emit = defineEmits<{
  (e: 'connected', cameraId: string): void
  (e: 'disconnected', cameraId: string): void
  (e: 'error', error: string): void
  (e: 'mode-change', mode: 'live' | 'vod'): void
}>()

// ==================== WebRTC (live) ====================
const {
  state: liveState,
  remoteStream,
  start,
  stop,
  destroy: destroyWebRTC,
} = useWebRTC({
  cameraId: props.cameraId,
  signalingConnectionId: 'signaling',
  iceServers: props.iceServers,
})

// ==================== VOD Player ====================
const videoRef = ref<HTMLVideoElement | null>(null)
const vodPlaylistUrlRef = computed(() => props.mode === 'vod' ? (props.vodPlaylistUrl ?? '') : '')

const vodPlayer = useVodPlayer({
  videoRef,
  playlistUrl: vodPlaylistUrlRef,
  autoplay: props.autoplay,
  muted: props.muted,
})

const {
  state: vodState,
  currentTime: vodCurrentTime,
  duration: vodDuration,
  buffered: vodBuffered,
  playbackRate: vodPlaybackRate,
  volume: vodVolume,
  isMuted: vodIsMuted,
  load: vodLoad,
  destroy: destroyVod,
} = vodPlayer

// ==================== 本地状态 ====================
const latestLatency = ref(0)
let latencyStart = 0

const showControls = computed(() => {
  if (props.showControls !== undefined) return props.showControls
  return props.mode === 'vod'
})

// 静音：直播默认静音（避免回声），VOD 按 props
const isEffectivelyMuted = computed(() => {
  if (props.mode === 'live') return true
  // VOD: if user clicked unmute (vodIsMuted), respect that; otherwise fall back to props
  return vodIsMuted.value
})

const hasError = computed(() => {
  if (props.mode === 'live') return !!liveState.value.error
  return vodState.value.status === 'error'
})

interface OverlayInfo { state: 'hidden' | 'loading' | 'error'; text: string }
const showOverlay = computed(() => overlayInfo.value.state !== 'hidden')
const overlayState = computed(() => overlayInfo.value.state)
const overlayText = computed(() => overlayInfo.value.text)

const overlayInfo = computed<OverlayInfo>(() => {
  if (props.mode === 'live') {
    const s = liveState.value
    if (s.error) return { state: 'error', text: s.error }
    if (s.connectionState === 'connecting' || s.connectionState === 'new') return { state: 'loading', text: '连接中...' }
    if (s.connectionState === 'connected') return { state: 'hidden', text: '' }
    return { state: 'loading', text: '等待连接' }
  }
  // vod
  const vs = vodState.value
  if (vs.status === 'error') return { state: 'error', text: vs.error ?? '播放错误' }
  if (vs.status === 'loading' || vs.status === 'idle') return { state: 'loading', text: '加载中...' }
  if (vs.status === 'ended') return { state: 'loading', text: '回放已结束' }
  return { state: 'hidden', text: '' }
})

const statusDotClass = computed(() => {
  if (props.mode === 'live') {
    if (liveState.value.connectionState === 'connected') return 'dot-online'
    if (liveState.value.connectionState === 'connecting') return 'dot-connecting'
    return 'dot-error'
  }
  // vod
  if (vodState.value.status === 'playing') return 'dot-online'
  if (vodState.value.status === 'loading') return 'dot-connecting'
  if (vodState.value.status === 'error') return 'dot-error'
  return 'dot-paused'
})

const displayName = computed(() => props.cameraName || props.cameraId)

const progressPercent = computed(() => {
  const dur = vodDuration.value
  if (!dur || dur <= 0) return 0
  return Math.min(100, (vodCurrentTime.value / dur) * 100)
})

const bufferedPercent = computed(() => {
  const dur = vodDuration.value
  if (!dur || dur <= 0) return 0
  return Math.min(100, (vodBuffered.value / dur) * 100)
})

// ==================== 进度条拖拽 ====================
const progressTrackRef = ref<HTMLElement | null>(null)

function getProgressFromEvent(e: MouseEvent): number {
  const track = progressTrackRef.value
  if (!track) return 0
  const rect = track.getBoundingClientRect()
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
  return x / rect.width
}

function onProgressMouseDown(e: MouseEvent): void {
  const ratio = getProgressFromEvent(e)
  vodPlayer?.seek(ratio * vodDuration.value)

  const onMove = (ev: MouseEvent) => {
    const r = getProgressFromEvent(ev)
    vodPlayer?.seek(r * vodDuration.value)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onThumbMouseDown(e: MouseEvent): void {
  // same as track drag but stops propagation so only thumb handles it
  onProgressMouseDown(e)
}

// ==================== 倍速 ====================
const speedOptions = [0.5, 1.0, 1.5, 2.0]

function cycleSpeed(): void {
  const rates = speedOptions
  const idx = rates.indexOf(vodPlaybackRate.value)
  const next = rates[(idx + 1) % rates.length]
  vodPlayer?.setPlaybackRate(next)
}

// ==================== 模式切换 ====================
function toggleMode(): void {
  const newMode = props.mode === 'live' ? 'vod' : 'live'
  emit('mode-change', newMode)
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
  } catch { /* 不支持全屏 */ }
}

// ==================== 视频事件 ====================
function onVideoReady(): void {
  const video = videoRef.value
  if (!video) return

  if (props.mode === 'live') {
    latencyStart = Date.now()
    const trackLatency = (): void => {
      if (!video || video.paused || video.ended) return
      const playTime = video.currentTime * 1000
      latestLatency.value = Math.max(0, Math.round((Date.now() - latencyStart) - playTime))
      requestAnimationFrame(trackLatency)
    }
    trackLatency()
    emit('connected', props.cameraId)
  }
}

function onVideoEnded(): void {
  if (props.mode === 'vod') {
    vodState.value = { status: 'ended', error: null }
  }
}

function onVideoClick(): void {
  if (props.mode === 'vod' && vodState.value.status === 'paused') {
    vodPlayer?.togglePlay()
  }
}

// ==================== 重试 ====================
function handleRetry(): void {
  if (props.mode === 'live') {
    start() // start() internally clears error state
  } else if (props.mode === 'vod' && props.vodPlaylistUrl) {
    vodLoad(props.vodPlaylistUrl)
  }
}

// ==================== 工具函数 ====================
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

// ==================== 模式切换管理 ====================
let currentMode: 'live' | 'vod' | null = null

function switchToLive(): void {
  if (currentMode === 'live') return
  // 先停止 VOD
  destroyVod()
  currentMode = 'live'
  start()
}

function switchToVod(): void {
  if (currentMode === 'vod') return
  // stop() internally closes PeerConnection and clears remoteStream
  stop()
  currentMode = 'vod'
  if (props.vodPlaylistUrl) {
    vodLoad(props.vodPlaylistUrl)
  } else {
    vodState.value = { status: 'error', error: '未提供 VOD 播放地址 (vodPlaylistUrl)' }
  }
}

watch(
  () => props.mode,
  (newMode) => {
    if (newMode === 'live') switchToLive()
    else switchToVod()
  },
)

watch(
  () => props.vodPlaylistUrl,
  (url) => {
    if (props.mode === 'vod' && url) {
      vodLoad(url)
    }
  },
)

// ==================== 生命周期 ====================
onMounted(() => {
  if (props.mode === 'live') {
    switchToLive()
  } else {
    switchToVod()
  }
})

onUnmounted(() => {
  if (currentMode === 'live') {
    destroyWebRTC()
  } else {
    destroyVod()
  }
})

// ==================== 容器样式 ====================
const containerStyle = computed(() => ({}))
</script>

<style scoped lang="less">
.video-player {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 200px;
  min-height: 150px;
  background: #0a0f1e;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(30, 144, 255, 0.15);
  transition: border-color 0.3s;
  user-select: none;

  &.is-live {
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
  cursor: pointer;
}

// ---------- 遮罩 ----------
.player-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 12, 40, 0.78);
  backdrop-filter: blur(2px);
  z-index: 5;
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

// ---------- VOD 暂停遮罩 ----------
.pause-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  z-index: 4;
  cursor: pointer;
}
.pause-icon {
  font-size: 48px;
  color: rgba(255, 255, 255, 0.8);
  text-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
  transition: transform 0.2s;
  .pause-overlay:hover & {
    transform: scale(1.1);
  }
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
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
  z-index: 6;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  pointer-events: none;
}
.camera-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.latency, .vod-time {
  font-family: 'Consolas', monospace;
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}
.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #666;
  flex-shrink: 0;
  &.dot-online { background: #00c864; box-shadow: 0 0 4px rgba(0, 200, 100, 0.5); }
  &.dot-connecting { background: #ffaa00; animation: pulse 1s infinite; }
  &.dot-error { background: #ff5050; }
  &.dot-paused { background: #e6a23c; }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

// ---------- 模式切换栏 ----------
.mode-switch-bar {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgba(30, 144, 255, 0.3);
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}
.mode-btn {
  padding: 4px 14px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, color 0.2s;
  &.active {
    background: #1e90ff;
    color: #fff;
    font-weight: 600;
  }
  &:not(.active):hover {
    background: rgba(30, 144, 255, 0.2);
    color: rgba(255, 255, 255, 0.8);
  }
}

// ---------- 全屏按钮 ----------
.btn-fullscreen {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 7;
  width: 28px; height: 28px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, color 0.2s;
  &:hover { background: rgba(0, 0, 0, 0.7); color: #fff; }
}

// ---------- VOD 控制栏 ----------
.vod-controls {
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  z-index: 7;
  padding-bottom: 4px;
}

.progress-track {
  position: relative;
  height: 4px;
  margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  cursor: pointer;
  transition: height 0.15s;
  &:hover { height: 6px; }
}
.progress-buffered {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}
.progress-filled {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  background: #1e90ff;
  border-radius: 2px;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  width: 12px; height: 12px;
  margin-left: -6px; margin-top: -6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: auto;
  .progress-track:hover & { opacity: 1; }
}

.controls-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
}

.ctrl-btn {
  width: 28px; height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
  &:hover { background: rgba(255, 255, 255, 0.1); }
}

.time-display {
  font-family: 'Consolas', monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
  flex-shrink: 0;
  min-width: 90px;
  text-align: center;
}

.speed-select {
  position: relative;
  flex-shrink: 0;
  .speed-btn {
    width: auto;
    min-width: 36px;
    padding: 0 6px;
    font-size: 11px;
    font-family: 'Consolas', monospace;
    color: rgba(255, 255, 255, 0.6);
  }
  &:hover .speed-menu {
    display: flex;
  }
}
.speed-menu {
  display: none;
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  flex-direction: column;
  background: rgba(10, 15, 30, 0.95);
  border: 1px solid rgba(30, 144, 255, 0.2);
  border-radius: 4px;
  padding: 2px 0;
  z-index: 10;
}
.speed-item {
  padding: 4px 16px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-family: 'Consolas', monospace;
  cursor: pointer;
  white-space: nowrap;
  text-align: center;
  &:hover { background: rgba(30, 144, 255, 0.2); }
  &.active { color: #1e90ff; }
}

.volume-slider {
  flex-shrink: 0;
  width: 60px;
  display: flex;
  align-items: center;
}
.volume-range {
  width: 100%;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
  }
  &::-moz-range-thumb {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #fff;
    border: none;
    cursor: pointer;
  }
}
</style>
