import { ref, shallowRef, watch, type Ref } from 'vue'
import Hls from 'hls.js'
import type { VodState } from '@/types/dashboard'

export interface UseVodPlayerOptions {
  videoRef: Ref<HTMLVideoElement | null>
  playlistUrl: Ref<string>
  autoplay?: boolean
  muted?: boolean
}

export function useVodPlayer(options: UseVodPlayerOptions) {
  const { videoRef, playlistUrl, autoplay = true, muted = false } = options

  const hls = shallowRef<Hls | null>(null)
  const state = ref<VodState>({ status: 'idle', error: null })
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const buffered = ref(0)
  const playbackRate = ref(1)
  const volume = ref(1)
  const isMuted = ref(muted)

  let timeRafId = 0
  let destroyed = false
  /** 标记当前流是否为已完结的 VOD（检测到 #EXT-X-ENDLIST） */
  let vodComplete = false

  function trackTime(): void {
    const video = videoRef.value
    if (!video || destroyed) return
    currentTime.value = video.currentTime
    if (video.buffered.length > 0) {
      buffered.value = video.buffered.end(video.buffered.length - 1)
    }
    timeRafId = requestAnimationFrame(trackTime)
  }

  function load(url: string): void {
    destroy()

    const video = videoRef.value
    if (!video) return

    video.muted = muted
    video.volume = volume.value
    video.playbackRate = playbackRate.value

    state.value = { status: 'loading', error: null }

    if (Hls.isSupported()) {
      const instance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      })

      instance.loadSource(url)
      instance.attachMedia(video)

      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (destroyed) return
        duration.value = instance.media?.duration ?? 0
        state.value = { status: 'paused', error: null }
        if (autoplay) {
          play()
        }
      })

      // 检测 #EXT-X-ENDLIST：已完结的 VOD 无需轮询 playlist
      instance.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        if (destroyed || vodComplete) return
        if (data.details.live === false) {
          vodComplete = true
          // 取消 playlist 轮询计时器，同时保持分片加载能力（拖动进度条仍可 seek）
          instance.stopLoad()
          const pos = instance.media?.currentTime ?? 0
          instance.startLoad(pos)
        }
      })

      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (destroyed) return
        if (data.fatal) {
          const errorMsg = data.type === 'networkError'
            ? '网络错误，无法加载视频流'
            : data.type === 'mediaError'
              ? '媒体解码错误'
              : `HLS 播放错误: ${data.details}`
          state.value = { status: 'error', error: errorMsg }
          destroy()
        }
      })

      hls.value = instance
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      const onMeta = () => {
        if (destroyed) return
        duration.value = video.duration
        state.value = { status: 'paused', error: null }
        if (autoplay) play()
      }
      video.addEventListener('loadedmetadata', onMeta, { once: true })
    } else {
      state.value = { status: 'error', error: '当前浏览器不支持 HLS 播放' }
    }
  }

  async function play(): Promise<void> {
    const video = videoRef.value
    if (!video || state.value.status === 'error') return
    try {
      await video.play()
      state.value = { ...state.value, status: 'playing' }
      isPlaying.value = true
      trackTime()
    } catch {
      // autoplay blocked — browser policy
      state.value = { ...state.value, status: 'paused' }
      isPlaying.value = false
    }
  }

  function pause(): void {
    const video = videoRef.value
    if (!video) return
    video.pause()
    state.value = { ...state.value, status: 'paused' }
    isPlaying.value = false
    cancelAnimationFrame(timeRafId)
  }

  function togglePlay(): void {
    isPlaying.value ? pause() : play()
  }

  function seek(time: number): void {
    const video = videoRef.value
    if (!video) return
    video.currentTime = Math.max(0, Math.min(time, duration.value || video.duration || 0))
    currentTime.value = video.currentTime
  }

  function seekRelative(delta: number): void {
    seek(currentTime.value + delta)
  }

  function setPlaybackRate(rate: number): void {
    playbackRate.value = rate
    const video = videoRef.value
    if (video) video.playbackRate = rate
  }

  function setVolume(vol: number): void {
    volume.value = Math.max(0, Math.min(1, vol))
    const video = videoRef.value
    if (video) video.volume = volume.value
    if (volume.value > 0) {
      isMuted.value = false
      if (video) video.muted = false
    }
  }

  function toggleMute(): void {
    isMuted.value = !isMuted.value
    const video = videoRef.value
    if (video) video.muted = isMuted.value
  }

  function destroy(): void {
    destroyed = true
    cancelAnimationFrame(timeRafId)
    if (hls.value) {
      hls.value.destroy()
      hls.value = null
    }
    const video = videoRef.value
    if (video) {
      video.pause()
      video.removeAttribute('src')
      video.src = ''
      video.load()
    }
    state.value = { status: 'idle', error: null }
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    buffered.value = 0
    vodComplete = false
    destroyed = false
  }

  // react to playlistUrl changes
  watch(playlistUrl, (url) => {
    if (url) load(url)
  })

  return {
    state,
    isPlaying,
    currentTime,
    duration,
    buffered,
    playbackRate,
    volume,
    isMuted,
    load,
    play,
    pause,
    togglePlay,
    seek,
    seekRelative,
    setPlaybackRate,
    setVolume,
    toggleMute,
    destroy,
  }
}
