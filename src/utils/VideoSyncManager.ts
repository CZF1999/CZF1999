import type { VideoSyncPoint } from '@/types/dashboard'

/**
 * 视频—数据时间戳同步管理器
 *
 * 两种工作模式：
 *   1. NTP 校准模式（默认）：使用服务器时间 + video.currentTime 推算绝对时间
 *   2. SEI 嵌入模式（若后端支持）：解析视频流中的 SEI 时间戳
 *
 * 使用 requestAnimationFrame 驱动同步循环，确保与图表渲染帧对齐。
 */
export class VideoSyncManager {
  /** 服务器时间与本地时间的偏移 (ms)，serverTime = localTime + offset */
  private _timeOffset = 0

  /** 该摄像头的播放起始服务器时间戳 */
  private _playStartServerTime = 0

  /** 同步缓冲区：最近 N 帧的对应关系 */
  private _buffer: VideoSyncPoint[] = []
  private _maxBufferSize = 300

  /** 时间偏移校准样本 */
  private _offsetSamples: number[] = []
  private _maxOffsetSamples = 20

  private _videoElement: HTMLVideoElement | null = null
  private _rafId: ReturnType<typeof requestAnimationFrame> | null = null
  private _onSync: ((point: VideoSyncPoint) => void) | null = null

  /** 校准一次服务器时间偏移（NTP 式单次 RTT/2 估算） */
  async calibrate(fetchServerTime: () => Promise<number>): Promise<void> {
    const sendTime = Date.now()
    let serverTime: number
    try {
      serverTime = await fetchServerTime()
    } catch {
      return
    }
    const recvTime = Date.now()
    const rtt = recvTime - sendTime
    // 假设上下行对称，减去一半 RTT
    const estimatedOffset = serverTime - (sendTime + rtt / 2)

    this._offsetSamples.push(estimatedOffset)
    if (this._offsetSamples.length > this._maxOffsetSamples) {
      this._offsetSamples.shift()
    }

    // 取中位数作为稳定偏移量
    const sorted = [...this._offsetSamples].sort((a, b) => a - b)
    this._timeOffset = sorted[Math.floor(sorted.length / 2)]
  }

  /** 手动设置服务器时间偏移 */
  setTimeOffset(offsetMs: number): void {
    this._timeOffset = offsetMs
  }

  /** 标记播放开始（记录起始服务器时间） */
  markPlayStart(serverTime?: number): void {
    this._playStartServerTime = serverTime ?? this.getServerTime()
    this._buffer = []
  }

  /** 获取当前估算的服务器时间 */
  getServerTime(): number {
    return Date.now() + this._timeOffset
  }

  /** 根据 video.currentTime 推算当前帧的绝对服务器时间 */
  getAbsoluteTime(currentTime?: number): number {
    const ct = currentTime ?? this._videoElement?.currentTime ?? 0
    return this._playStartServerTime + ct * 1000
  }

  /** 绑定 video 元素，启动 rAF 同步循环 */
  attach(video: HTMLVideoElement, onSync: (point: VideoSyncPoint) => void): void {
    this._videoElement = video
    this._onSync = onSync
    this._startLoop()
  }

  /** 停止同步循环并解绑 */
  detach(): void {
    this._stopLoop()
    this._videoElement = null
    this._onSync = null
    this._buffer = []
  }

  /** 当设备数据到达时调用，与最近一帧视频画面关联 */
  recordDeviceData(deviceMetrics: Map<string, number>): void {
    const ct = this._videoElement?.currentTime ?? 0
    const serverTs = this.getAbsoluteTime(ct)

    const point: VideoSyncPoint = {
      videoTimestamp: ct,
      serverTimestamp: serverTs,
      deviceDataMap: new Map(deviceMetrics),
    }

    this._buffer.push(point)
    if (this._buffer.length > this._maxBufferSize) {
      this._buffer.shift()
    }
  }

  /** 查找与给定设备时间戳最接近的同步点 */
  findClosest(deviceTimestamp: number): VideoSyncPoint | null {
    if (this._buffer.length === 0) return null

    let best: VideoSyncPoint | null = null
    let bestDiff = Infinity

    for (const point of this._buffer) {
      const diff = Math.abs(point.serverTimestamp - deviceTimestamp)
      if (diff < bestDiff) {
        bestDiff = diff
        best = point
      }
    }

    return best
  }

  /** 获取最近一个同步点 */
  get latest(): VideoSyncPoint | null {
    return this._buffer.length > 0 ? this._buffer[this._buffer.length - 1] : null
  }

  /** 重置所有状态 */
  reset(): void {
    this.detach()
    this._timeOffset = 0
    this._playStartServerTime = 0
    this._offsetSamples = []
    this._buffer = []
  }

  get timeOffset(): number {
    return this._timeOffset
  }

  // ---------- 内部 ----------

  private _startLoop(): void {
    this._stopLoop()
    const tick = (): void => {
      if (!this._videoElement || !this._onSync) return
      const ct = this._videoElement.currentTime
      if (ct > 0) {
        const point: VideoSyncPoint = {
          videoTimestamp: ct,
          serverTimestamp: this.getAbsoluteTime(ct),
          deviceDataMap: new Map(),
        }
        this._onSync(point)
      }
      this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }

  private _stopLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }
}
