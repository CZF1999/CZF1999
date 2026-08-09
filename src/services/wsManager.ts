/**
 * WebSocket 连接管理器
 * 
 * 功能说明：
 * - 管理多个 WebSocket 连接的生命周期（连接、断开、重连）
 * - 提供自动重连机制（指数退避算法）
 * - 提供心跳检测，防止连接被防火墙关闭
 * - 提供消息队列，连接断开时缓存消息，恢复后自动发送
 * - 支持页面可见性优化（页面隐藏时降低心跳频率）
 * 
 * 使用场景：
 * - 与后端建立 WebSocket 连接，用于实时通信
 * - 例如：视频信令交换、实时数据推送、消息通知等
 */
import type {
  WsConnectionConfig,
  WsConnectionState,
  WsMessageEvent,
} from '@/types/dashboard'

// ==================== WsConnection 类 ====================
/**
 * 单个 WebSocket 连接封装类
 * 
 * 职责：
 * - 管理单个 WebSocket 的完整生命周期
 * - 处理连接状态变化
 * - 实现自动重连和心跳机制
 * - 管理消息队列
 */
export class WsConnection {
  // 连接配置（如 URL、重连参数、心跳间隔等）
  readonly config: WsConnectionConfig
  
  // 当前连接状态：idle(空闲) | connecting(连接中) | connected(已连接) | error(错误) | disconnected(已断开)
  state: WsConnectionState = 'idle'

  // 底层 WebSocket 对象
  private ws: WebSocket | null = null
  
  // 消息队列：当连接未建立时，消息会暂存在这里
  private messageQueue: (string | ArrayBuffer)[] = []
  
  // 当前重连次数
  private reconnectAttempts = 0
  
  // 心跳定时器：定时发送 ping 消息保持连接活跃
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  
  // 连接超时定时器：超过指定时间未连接成功则判定失败
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  
  // 消息回调函数：收到消息时触发
  private onMessageCb: ((event: WsMessageEvent) => void) | null = null
  
  // 状态变化回调函数：连接状态改变时触发
  private onStateChangeCb: ((state: WsConnectionState, conn: WsConnection) => void) | null = null
  
  // 是否已销毁（销毁后不再重连）
  private destroyed = false

  /**
   * 构造函数
   * @param config 连接配置，包含 URL、心跳间隔、重连参数等
   */
  constructor(config: WsConnectionConfig) {
    // 合并默认配置和用户配置
    this.config = {
      messageQueueSize: 1000,        // 消息队列最大长度
      heartbeatMessage: 'ping',      // 心跳消息内容
      ...config,                     // 用户自定义配置覆盖默认值
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  connect(): void {
    // 如果已销毁，不再连接
    if (this.destroyed) return
    
    // 设置状态为"连接中"
    this.setState('connecting')
    
    // 清理旧的定时器（心跳、超时）
    this.clearTimers()

    // 创建 WebSocket 连接
    try {
      // this.config.url: WebSocket 服务器地址，如 'ws://localhost:8080'
      // this.config.protocols: 子协议（可选）
      this.ws = new WebSocket(this.config.url, this.config.protocols)
    } catch {
      // 创建失败（如网络问题），设置为错误状态并重连
      this.setState('error')
      this.scheduleReconnect()
      return
    }

    // 设置连接超时定时器
    // 如果超过 this.config.timeout 毫秒仍未连接成功，则关闭连接并重试
    this.timeoutTimer = setTimeout(() => {
      if (this.state === 'connecting') {
        this.ws?.close()  // 关闭连接
        this.setState('error')  // 标记为错误
        this.scheduleReconnect()  // 安排重连
      }
    }, this.config.timeout)

    // ====== WebSocket 事件处理 ======
    
    // 连接成功时触发
    this.ws.onopen = () => {
      this.reconnectAttempts = 0  // 重置重连计数
      this.setState('connected')  // 更新状态为"已连接"
      this.clearTimeout()  // 清除超时定时器
      this.flushQueue()  // 发送消息队列中积压的消息
      this.startHeartbeat()  // 启动心跳检测
    }

    // 收到消息时触发
    this.ws.onmessage = (ev: MessageEvent) => {
      // 调用消息回调，传递事件数据
      this.onMessageCb?.({
        connectionId: this.config.id,  // 连接 ID（用于区分多个连接）
        data: ev.data,                 // 消息内容（字符串或 ArrayBuffer）
        timestamp: Date.now(),         // 消息时间戳
      })
    }

    // 连接发生错误时触发
    this.ws.onerror = () => {
      // 注意：这里不设置状态为 error
      // 因为 onclose 会紧随其后触发，由 onclose 统一处理状态变化
    }

    // 连接关闭时触发
    this.ws.onclose = () => {
      this.stopHeartbeat()  // 停止心跳
      
      // 如果不是主动断开连接，则标记为错误并重连
      if (this.state !== 'disconnected') {
        this.setState('error')
        this.scheduleReconnect()
      }
    }
  }

  /**
   * 发送消息
   * @param data 要发送的数据（字符串或 ArrayBuffer）
   */
  send(data: string | ArrayBuffer): void {
    // 如果连接已建立且 WebSocket 处于 OPEN 状态，直接发送
    if (this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    } else {
      // 否则将消息加入队列，等待连接恢复后发送
      const max = this.config.messageQueueSize ?? 1000
      if (this.messageQueue.length < max) {
        this.messageQueue.push(data)
      }
    }
  }

  /**
   * 主动断开连接
   * 调用后不会触发自动重连
   */
  disconnect(): void {
    this.setState('disconnected')  // 标记为"已断开"
    this.clearTimers()             // 清理所有定时器
    this.ws?.close(1000)           // 正常关闭 WebSocket（1000 表示正常关闭）
    this.ws = null
  }

  /**
   * 销毁连接
   * 彻底销毁，不再重连，清理所有资源
   */
  destroy(): void {
    this.destroyed = true    // 标记为已销毁
    this.disconnect()        // 断开连接
    this.messageQueue = []   // 清空消息队列
    this.onMessageCb = null  // 清除回调，释放内存
    this.onStateChangeCb = null
  }

  /**
   * 注册消息监听器
   * @param cb 收到消息时的回调函数
   */
  onMessage(cb: (event: WsMessageEvent) => void): void {
    this.onMessageCb = cb
  }

  /**
   * 注册状态变化监听器
   * @param cb 状态变化时的回调函数
   */
  onStateChange(cb: (state: WsConnectionState, conn: WsConnection) => void): void {
    this.onStateChangeCb = cb
  }

  // ==================== 内部方法 ====================
  
  /**
   * 更新连接状态并触发状态变化回调
   */
  private setState(state: WsConnectionState): void {
    this.state = state
    this.onStateChangeCb?.(state, this)  // 通知外部状态已变化
  }

  /**
   * 安排自动重连
   * 使用指数退避算法：延迟时间 = baseDelay * 2^attempts，最大 30 秒
   * 例如：1s → 2s → 4s → 8s → 16s → 30s (封顶)
   */
  private scheduleReconnect(): void {
    // 如果已销毁或主动断开，不再重连
    if (this.destroyed || this.state === 'disconnected') return
    
    // 如果达到最大重连次数，停止重连
    if (this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
      this.setState('error')
      return
    }
    
    // 计算重连延迟（指数退避）
    const delay = Math.min(
      this.config.reconnectBaseDelay * 2 ** this.reconnectAttempts,
      30_000,  // 最大延迟 30 秒
    )
    
    this.reconnectAttempts++  // 重连次数 +1
    
    // 延迟后重新连接
    setTimeout(() => this.connect(), delay)
  }

  /**
   * 启动心跳检测
   * 定时发送心跳消息，保持连接活跃，防止被防火墙/代理关闭
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()  // 先停止旧的心跳
    
    // 每隔 this.config.heartbeatInterval 毫秒发送一次心跳
    this.heartbeatTimer = setInterval(() => {
      this.send(this.config.heartbeatMessage!)  // 默认发送 'ping'
    }, this.config.heartbeatInterval)
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * 发送消息队列中积压的所有消息
   * 在连接恢复后调用
   */
  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!  // 取出队列头部的消息
      this.send(msg)  // 发送消息
    }
  }

  /**
   * 清理所有定时器（心跳和超时）
   */
  private clearTimers(): void {
    this.clearTimeout()
    this.stopHeartbeat()
  }

  /**
   * 清理超时定时器
   */
  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
  }
}

// ==================== WebSocketManager 单例类 ====================

// 消息监听器类型定义
type MessageListener = (event: WsMessageEvent) => void

/**
 * WebSocket 管理器（单例模式）
 * 
 * 职责：
 * - 管理多个 WebSocket 连接（通过 ID 区分）
 * - 提供全局消息分发机制
 * - 处理页面可见性变化（隐藏时降低心跳，恢复时重连）
 * 
 * 单例模式说明：
 * - 全局只有一个 WebSocketManager 实例
 * - 通过 getInstance() 获取实例
 * - 避免多个管理器导致的状态混乱
 * 
 * 使用示例：
 * ```typescript
 * const manager = WebSocketManager.getInstance()
 * manager.createConnection({ id: 'signaling', url: 'ws://...' })
 * manager.createConnection({ id: 'data', url: 'ws://...' })
 * manager.connectAll()
 * ```
 */
export class WebSocketManager {
  // 单例实例
  private static instance: WebSocketManager | null = null
  
  // 存储所有连接：key 为连接 ID，value 为 WsConnection 实例
  private connections = new Map<string, WsConnection>()
  
  // 全局消息监听器集合：所有连接收到的消息都会分发给这些监听器
  private globalMessageListeners = new Set<MessageListener>()
  
  // 页面可见性变化监听器
  private visibilityHandler: (() => void) | null = null

  /**
   * 私有构造函数（防止外部直接 new）
   * 单例模式必须使用 getInstance() 获取实例
   */
  private constructor() {
    // 设置页面可见性监听
    this.setupVisibilityListener()
  }

  /**
   * 获取单例实例
   * 如果实例不存在则创建，确保全局只有一个管理器
   */
  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager()
    }
    return WebSocketManager.instance
  }

  /**
   * 将单例挂载到 window 对象
   * 方便在浏览器控制台调试：window.__wsManager
   */
  static mountGlobal(): void {
    ;(window as unknown as Record<string, unknown>).__wsManager =
      WebSocketManager.getInstance()
  }

  /**
   * 创建一个新的 WebSocket 连接
   * @param config 连接配置（必须包含 id 和 url）
   * @returns WsConnection 实例
   * 
   * 示例：
   * ```typescript
   * manager.createConnection({
   *   id: 'signaling',           // 连接唯一标识
   *   url: 'ws://localhost:8080', // WebSocket 地址
   *   heartbeatInterval: 30000,   // 心跳间隔 30 秒
   *   reconnectMaxAttempts: 5,    // 最大重连 5 次
   * })
   * ```
   */
  createConnection(config: WsConnectionConfig): WsConnection {
    // 如果该 ID 的连接已存在，直接返回（避免重复创建）
    if (this.connections.has(config.id)) {
      return this.connections.get(config.id)!
    }
    
    // 创建新连接
    const conn = new WsConnection(config)
    
    // 注册消息回调：收到消息时分发给所有全局监听器
    conn.onMessage((event) => {
      this.dispatchToListeners(event)
    })
    
    // 存储连接
    this.connections.set(config.id, conn)
    
    return conn
  }

  /**
   * 根据 ID 获取连接
   * @param id 连接 ID
   */
  getConnection(id: string): WsConnection | undefined {
    return this.connections.get(id)
  }

  /**
   * 移除并销毁指定连接
   * @param id 连接 ID
   */
  removeConnection(id: string): void {
    const conn = this.connections.get(id)
    if (conn) {
      conn.destroy()  // 销毁连接（不再重连）
      this.connections.delete(id)  // 从 Map 中删除
    }
  }

  /**
   * 连接所有已创建的 WebSocket
   */
  connectAll(): void {
    this.connections.forEach((c) => c.connect())
  }

  /**
   * 断开所有 WebSocket 连接（可重连）
   */
  disconnectAll(): void {
    this.connections.forEach((c) => c.disconnect())
  }

  /**
   * 销毁所有 WebSocket 连接（不可恢复）
   */
  destroyAll(): void {
    this.connections.forEach((c) => c.destroy())
    this.connections.clear()  // 清空 Map
  }

  /**
   * 添加全局消息监听器
   * 所有连接收到的消息都会触发这个监听器
   * @param handler 消息处理函数
   * @returns 取消订阅函数（调用后移除该监听器）
   * 
   * 使用示例：
   * ```typescript
   * const unsub = manager.addGlobalMessageListener((event) => {
   *   console.log('收到消息:', event.data)
   * })
   * 
   * // 不需要时取消监听
   * unsub()
   * ```
   */
  addGlobalMessageListener(handler: MessageListener): () => void {
    this.globalMessageListeners.add(handler)
    
    // 返回取消订阅函数
    return () => {
      this.globalMessageListeners.delete(handler)
    }
  }

  /**
   * 将消息分发给所有监听器
   * @param event 消息事件
   */
  private dispatchToListeners(event: WsMessageEvent): void {
    for (const listener of this.globalMessageListeners) {
      try {
        listener(event)  // 调用监听器
      } catch {
        // 如果一个监听器报错，不影响其他监听器继续执行
      }
    }
  }

  // ==================== 页面可见性优化 ====================
  
  /**
   * 设置页面可见性监听
   * 
   * 优化策略：
   * - 页面隐藏时（切换标签页、最小化）：停止心跳，降低资源消耗
   * - 页面恢复时：自动重连断开的连接，快速恢复通信
   * 
   * 好处：
   * - 节省带宽和服务器资源
   * - 避免页面隐藏期间频繁心跳导致的性能问题
   * - 页面恢复时自动重建连接，用户无感知
   */
  private setupVisibilityListener(): void {
    this.visibilityHandler = () => {
      if (document.hidden) {
        // ====== 页面隐藏（不可见）======
        console.log('[WebSocketManager] 页面隐藏，降低心跳频率')
        
        // 对所有已连接的连接发送轻量消息，确认存活
        this.connections.forEach((c) => {
          if (c.state === 'connected') {
            c.send('pause')  // 发送轻量消息（替代正常心跳）
          }
        })
      } else {
        // ====== 页面恢复（可见）======
        console.log('[WebSocketManager] 页面恢复，重连断开的连接')
        
        // 快速重连所有未连接的连接
        this.connections.forEach((c) => {
          if (c.state !== 'connected' && c.state !== 'connecting') {
            c.connect()  // 重新建立连接
          }
        })
      }
    }
    
    // 注册可见性变化事件监听
    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  /**
   * 销毁管理器
   * 清理所有资源，移除事件监听
   */
  destroy(): void {
    this.destroyAll()  // 销毁所有连接
    
    // 移除页面可见性监听
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
    }
    
    // 清空单例引用（允许重新创建）
    WebSocketManager.instance = null
  }
}
