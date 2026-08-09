// ==================== 设备数据 ====================
export interface DeviceData {
  deviceId: string
  deviceName: string
  type: DeviceType
  status: DeviceStatus
  position: GeoPosition
  metrics: DeviceMetrics
  timestamp: number
}

export type DeviceType = 'motor' | 'pump' | 'conveyor' | 'sensor' | 'other'

export type DeviceStatus = 'online' | 'offline' | 'warning' | 'error'

export interface GeoPosition {
  lng: number
  lat: number
  altitude?: number
}

export interface DeviceMetrics {
  speed?: number       // rpm
  temperature?: number  // ℃
  pressure?: number     // kPa
  voltage?: number      // V
  current?: number      // A
  power?: number        // kW
  vibration?: number    // mm/s
  humidity?: number     // %
  [key: string]: number | undefined
}

export interface DeviceSummary {
  deviceId: string
  deviceName: string
  type: DeviceType
  status: DeviceStatus
  position: GeoPosition
}

// ==================== 告警数据 ====================
export type AlarmLevel = 'info' | 'warning' | 'critical'

export interface AlarmItem {
  id: string
  deviceId: string
  deviceName: string
  level: AlarmLevel
  message: string
  metric?: string
  value?: number
  threshold?: number
  timestamp: number
  acknowledged: boolean
}

// ==================== 趋势数据点 ====================
export interface TrendDataPoint {
  timestamp: number
  value: number
}

export interface TrendSeries {
  deviceId: string
  metric: string
  data: TrendDataPoint[]
}

// ==================== 订阅相关 ====================
export type SubscriberId = string

export interface SubscriptionInfo {
  deviceIds: Set<string>
  metrics?: string[]
}

// ==================== WebSocket 相关 ====================
export interface WsConnectionConfig {
  id: string
  url: string
  protocols?: string | string[]
  heartbeatInterval: number    // ms
  heartbeatMessage?: string | ArrayBuffer
  timeout: number              // ms
  reconnectMaxAttempts: number
  reconnectBaseDelay: number   // ms, 指数退避基数
  messageQueueSize?: number    // 离线缓存最大条数
}

export type WsConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface WsMessageEvent {
  connectionId: string
  data: unknown
  timestamp: number
}

// ==================== 数据源配置 ====================
export interface DataSourceConfig {
  highFreqEndpoint: string    // 高频数据端点 (设备实时指标)
  lowFreqEndpoint: string     // 低频数据端点 (告警、状态)
  heartbeatInterval: number
  reconnectBaseDelay: number
}

// ==================== Worker 消息协议 ====================
export interface WorkerInMessage {
  type: 'process' | 'set_config'
  payload: WorkerProcessPayload | WorkerConfigPayload
}

export interface WorkerProcessPayload {
  batchId: string
  rawData: DeviceData[]
  subscribedDeviceIds: string[]
  metrics?: string[]
}

export interface WorkerConfigPayload {
  downSampleThreshold: number // 超多少条触发降采样
  maxDataPoints: number       // 降采样后保留的最大点数
}

export interface WorkerOutMessage {
  type: 'processed'
  batchId: string
  devices: DeviceData[]
  trendData: Record<string, TrendDataPoint[]>  // key: `${deviceId}:${metric}`
}

// ==================== 布局 ====================
export type DashboardTheme = 'dark' | 'light' | 'blue'

export interface LayoutState {
  scale: number
  offsetX: number
  offsetY: number
  designWidth: number
  designHeight: number
  theme: DashboardTheme
  isFullscreen: boolean
  selectedDeviceId: string | null
}

// ==================== 图表配置 ====================
export interface ChartConfig {
  id: string
  title: string
  type: 'trend' | 'bar' | 'gauge' | 'pie'
  metric: string
  deviceIds: string[]
  color?: string
  options?: Record<string, unknown>
}

// ==================== 性能监控 ====================
export interface PerformanceMetrics {
  fps: number
  frameTime: number
  wsMessageRate: number
  renderTime: number
}

// ==================== 摄像头 WebRTC ====================
export interface CameraInfo {
  cameraId: string
  name: string
  location?: string
  status: CameraStatus
  resolution?: { width: number; height: number }
  fps?: number
  connectedAt?: number
}

export type CameraStatus = 'online' | 'offline' | 'connecting'

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'camera-list' | 'camera-status'
  cameraId?: string
  sdp?: string
  candidate?: RTCIceCandidateInit
  cameraIds?: string[]
  status?: CameraStatus
  timestamp?: number
}

export interface WebRTCState {
  connectionState: RTCPeerConnectionState
  iceGatheringState: RTCIceGatheringState
  iceConnectionState: RTCIceConnectionState
  signalingState: RTCSignalingState
  error: string | null
}

export interface VideoSyncPoint {
  videoTimestamp: number    // video.currentTime (seconds)
  serverTimestamp: number   // absolute server time (ms)
  deviceDataMap: Map<string, number>  // deviceId → metric value at this time
}

// ==================== 权限状态 ====================
// ==================== VOD 播放器 ====================
export interface VodState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'ended'
  error: string | null
}

// ==================== 权限状态 ====================
export interface PermissionState {
  camera: PermissionStatus | null
  microphone: PermissionStatus | null
}

