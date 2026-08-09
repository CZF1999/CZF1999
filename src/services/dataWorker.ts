/// <reference lib="webworker" />

import type {
  WorkerInMessage,
  WorkerOutMessage,
  DeviceData,
  TrendDataPoint,
} from '../types/dashboard'

interface WorkerConfig {
  downSampleThreshold: number
  maxDataPoints: number
}

const config: WorkerConfig = {
  downSampleThreshold: 500,
  maxDataPoints: 200,
}

/**
 * 简单降采样：当数据点超过阈值时，每隔 N 个点取一个
 */
function downsample(points: TrendDataPoint[], maxPoints: number): TrendDataPoint[] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const result: TrendDataPoint[] = []
  for (let i = 0; i < points.length; i += step) {
    result.push(points[i]!)
  }
  // 确保最后一个点被包含
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]!)
  }
  return result
}

/**
 * 按时间戳排序
 */
function sortByTimestamp<T extends { timestamp: number }>(items: T[]): T[] {
  return items.sort((a, b) => a.timestamp - b.timestamp)
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const { type, payload } = e.data

  if (type === 'set_config') {
    const p = payload as import('../types/dashboard').WorkerConfigPayload
    config.downSampleThreshold = p.downSampleThreshold
    config.maxDataPoints = p.maxDataPoints
    return
  }

  if (type === 'process') {
    const p = payload as import('../types/dashboard').WorkerProcessPayload
    const { batchId, rawData, subscribedDeviceIds, metrics } = p
    const subSet = new Set(subscribedDeviceIds)

    // 过滤已订阅的设备
    const devices: DeviceData[] = rawData.filter((d) => subSet.has(d.deviceId))

    // 按 metric 聚合成趋势点
    const trendRaw: Record<string, TrendDataPoint[]> = {}
    for (const d of devices) {
      const metricKeys = metrics ?? Object.keys(d.metrics)
      for (const metric of metricKeys) {
        const val = d.metrics[metric]
        if (val === undefined) continue
        const key = `${d.deviceId}:${metric}`
        if (!trendRaw[key]) trendRaw[key] = []
        trendRaw[key]!.push({ timestamp: d.timestamp, value: val })
      }
    }

    // 排序 + 降采样
    const trendData: Record<string, TrendDataPoint[]> = {}
    for (const [key, points] of Object.entries(trendRaw)) {
      const sorted = sortByTimestamp(points)
      trendData[key] =
        sorted.length > config.downSampleThreshold
          ? downsample(sorted, config.maxDataPoints)
          : sorted
    }

    const out: WorkerOutMessage = {
      type: 'processed',
      batchId,
      devices,
      trendData,
    }
    self.postMessage(out)
  }
}
