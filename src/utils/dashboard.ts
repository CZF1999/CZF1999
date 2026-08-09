import type { PerformanceMetrics } from '@/types/dashboard'

// ==================== 性能监控 ====================
export class PerformanceMonitor {
  private frames = 0
  private lastFrameTime = performance.now()
  private fps = 0
  private frameTime = 0
  private wsMessageCount = 0
  private renderTime = 0
  private rafId: number | null = null

  start(): void {
    const tick = () => {
      this.frames++
      const now = performance.now()
      if (now - this.lastFrameTime >= 1000) {
        this.fps = Math.round((this.frames * 1000) / (now - this.lastFrameTime))
        this.frameTime = (now - this.lastFrameTime) / this.frames
        this.frames = 0
        this.lastFrameTime = now
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  recordWsMessage(): void {
    this.wsMessageCount++
  }

  recordRender(duration: number): void {
    this.renderTime = duration
  }

  getSnapshot(): PerformanceMetrics {
    const snap: PerformanceMetrics = {
      fps: this.fps,
      frameTime: this.frameTime,
      wsMessageRate: this.wsMessageCount,
      renderTime: this.renderTime,
    }
    this.wsMessageCount = 0
    return snap
  }
}

// ==================== 时间格式化 ====================
export function formatTime(timestamp: number, fmt: 'time' | 'datetime' | 'full' = 'time'): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (fmt === 'time') return hms
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (fmt === 'datetime') return `${ymd} ${hms}`
  return `${ymd} ${hms}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

// ==================== 请求去重 ====================
export class DedupScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<string, unknown>()

  /**
   * 在 delay 窗口内，同一 key 只保留最后一次调用
   */
  schedule(key: string, fn: () => void, delay = 16): void {
    this.pending.set(key, fn)
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const fns = Array.from(this.pending.values())
      this.pending.clear()
      for (const f of fns) {
        ;(f as () => void)()
      }
    }, delay)
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending.clear()
  }
}

// ==================== 唯一 ID 生成 ====================
let _uid = 0
export function uid(prefix = 'd'): string {
  return `${prefix}_${++_uid}`
}

// ==================== Three.js / Canvas DPR 适配 ====================
export function getOptimalDPR(maxDPR = 2): number {
  return Math.min(window.devicePixelRatio, maxDPR)
}
