/**
 * WebRTC 实时视频流连接管理
 * 
 * 功能说明：
 * - 封装 WebRTC PeerConnection 的完整生命周期
 * - 实现视频流接收（从摄像头/服务器拉取视频）
 * - 支持双向对讲（发送本地麦克风音频）
 * - 自动重连机制
 * 
 * WebRTC 基础知识：
 * - WebRTC (Web Real-Time Communication) 是一种实时通信技术
 * - 可以在浏览器之间直接传输音视频流（P2P），延迟极低
 * - 需要通过"信令服务器"交换连接信息（SDP 和 ICE 候选）
 * 
 * 信令交换流程：
 * 1. 客户端创建 Offer（包含自己的媒体能力）
 * 2. 通过 WebSocket 发送 Offer 给服务端
 * 3. 服务端返回 Answer（包含自己的媒体能力）
 * 4. 双方交换 ICE 候选（NAT 穿透信息）
 * 5. 建立 P2P 连接，开始传输视频流
 * 
 * 使用示例：
 * ```typescript
 * const { remoteStream, start, stop, talking, startTalk, stopTalk } = useWebRTC({
 *   cameraId: 'camera_001',
 *   signalingConnectionId: 'signaling',
 * })
 * 
 * // 开始观看视频
 * await start()
 * 
 * // 开始对讲
 * await startTalk()
 * 
 * // 停止对讲
 * stopTalk()
 * 
 * // 停止观看
 * stop()
 * ```
 */
import { ref, readonly, shallowRef } from 'vue'
import type { SignalingMessage, WebRTCState } from '@/types/dashboard'
import { WebSocketManager } from '@/services/wsManager'

// WebRTC 连接配置选项
export interface UseWebRTCOptions {
  cameraId: string                    // 摄像头 ID（要连接哪个摄像头）
  signalingConnectionId?: string      // 信令 WebSocket 连接 ID（需在 wsManager 中预先创建）
  iceServers?: RTCIceServer[]         // ICE 服务器配置（用于 NAT 穿透）
  maxReconnect?: number               // 最大重连次数
}

// 默认 ICE 服务器（STUN 服务器）
// STUN 服务器用于获取公网 IP 地址，实现 NAT 穿透
const defaultIceServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },  // Google 的公共 STUN 服务器
]

/**
 * WebRTC 连接管理 composable（Vue 3 组合式函数）
 * 
 * 封装单个 RTCPeerConnection 的完整生命周期：
 *   创建 → 信令交换 (offer/answer) → ICE 协商 → 媒体流接收 → 关闭
 * 
 * 支持两种模式：
 *   - 仅拉流 (recvonly)：只接收远端视频（默认模式）
 *   - 拉流 + 对讲 (recvonly + sendonly audio)：额外推送本地麦克风音频
 * 
 * @param options 连接配置选项
 * @returns 状态和方法对象
 */
export function useWebRTC(options: UseWebRTCOptions) {
  // 解构配置选项，设置默认值
  const { cameraId, signalingConnectionId = 'signaling', iceServers = defaultIceServers, maxReconnect = 3 } = options

  // ==================== 状态管理 ====================
  
  // RTCPeerConnection 实例（WebRTC 核心对象）
  // shallowRef: 不需要深度响应式，提升性能
  const pc = shallowRef<RTCPeerConnection | null>(null)
  
  // 远端视频流（从摄像头接收的视频画面）
  const remoteStream = shallowRef<MediaStream | null>(null)
  
  // 本地音频流（麦克风采集的音频，用于对讲）
  const localAudioStream = shallowRef<MediaStream | null>(null)

  // WebRTC 连接状态（包含各种连接状态和错误信息）
  const state = ref<WebRTCState>({
    connectionState: 'new',        // 连接状态：new | connecting | connected | disconnected | failed
    iceGatheringState: 'new',      // ICE 候选收集状态：new | gathering | complete
    iceConnectionState: 'new',     // ICE 连接状态：new | checking | connected | failed
    signalingState: 'stable',      // 信令状态：stable | have-local-offer | have-remote-offer
    error: null,                   // 错误信息
  })

  // 是否正在对讲（发送本地音频）
  const talking = ref(false)
  
  // 当前重连次数
  const reconnectAttempts = ref(0)
  
  // 是否已销毁
  const destroyed = ref(false)

  // 标记是否已接收到媒体流（用于调试和状态追踪）
  let _hasReceivedTrack = false

  // ==================== 核心：创建 PeerConnection ====================
  
  /**
   * 创建 RTCPeerConnection 实例
   * 
   * RTCPeerConnection 是 WebRTC 的核心 API，负责：
   * - 建立和维护 P2P 连接
   * - 协商媒体编码和传输参数
   * - 传输音视频流
   * 
   * @returns RTCPeerConnection 实例
   */
  function createPeerConnection(): RTCPeerConnection {
    // 创建 PeerConnection，配置 ICE 服务器
    const connection = new RTCPeerConnection({
      iceServers,  // STUN/TURN 服务器，用于 NAT 穿透
    })

    // === 添加媒体接收器 ===
    
    // 添加视频接收器（recvonly 表示只接收视频，不发送）
    // 这意味着：我们只观看摄像头画面，不发送自己的视频
    connection.addTransceiver('video', { direction: 'recvonly' })

    // === 事件监听器 ===

    // ICE 候选事件：当发现新的网络路径时触发
    // ICE 候选包含了连接信息（IP 地址、端口等），需要发送给对方
    connection.onicecandidate = (event) => {
      // 如果发现了新的 ICE 候选，通过信令服务器发送给对方
      if (event.candidate) {
        sendSignaling({
          type: 'ice-candidate',
          cameraId,
          candidate: event.candidate.toJSON(),  // 转换为 JSON 格式
        })
      }
    }

    // ICE 连接状态变化事件
    connection.oniceconnectionstatechange = () => {
      state.value.iceConnectionState = connection.iceConnectionState
      
      // 如果 ICE 连接失败，尝试重连
      if (connection.iceConnectionState === 'failed') {
        attemptReconnect()
      }
    }

    // ICE 候选收集状态变化事件
    connection.onicegatheringstatechange = () => {
      state.value.iceGatheringState = connection.iceGatheringState
    }

    // 信令状态变化事件
    connection.onsignalingstatechange = () => {
      state.value.signalingState = connection.signalingState
    }

    // 连接状态变化事件
    connection.onconnectionstatechange = () => {
      state.value.connectionState = connection.connectionState
      
      // 根据不同状态采取不同措施
      switch (connection.connectionState) {
        case 'connected':
          // 连接成功，重置重连计数
          reconnectAttempts.value = 0
          break
        case 'failed':
        case 'disconnected':
          // 连接失败或断开，尝试重连
          attemptReconnect()
          break
      }
    }

    // 接收到远端媒体流事件（核心！）
    // 当对方开始发送视频流时触发
    connection.ontrack = (event) => {
      // event.streams[0] 是远端发来的媒体流（包含视频轨道）
      if (event.streams[0]) {
        console.log(event.streams[0]);
        
        remoteStream.value = event.streams[0]  // 保存流，供 <video> 标签播放
        _hasReceivedTrack = true  // 标记已接收到流
      }
    }

    return connection
  }

  // ==================== 信令交换 ====================
  
  /**
   * 获取信令 WebSocket 连接
   * 用于发送和接收 WebRTC 信令消息（offer、answer、ICE 候选等）
   */
  function getSignalingWs(): ReturnType<typeof WebSocketManager.prototype.getConnection> {
    return WebSocketManager.getInstance().getConnection(signalingConnectionId)
  }

  /**
   * 发送信令消息到服务端
   * @param msg 信令消息（如 offer、answer、ICE 候选等）
   */
  function sendSignaling(msg: SignalingMessage): void {
    const conn = getSignalingWs()
    
    // 只在连接正常时发送
    if (conn && conn.state === 'connected') {
      conn.send(JSON.stringify(msg))  // 将消息转为 JSON 字符串发送
    }
  }

  /**
   * 监听信令消息
   * 通过 WebSocketManager 的全局消息监听器接收服务端发来的信令
   */
  let _unsubSignaling: (() => void) | null = null  // 取消订阅函数

  function listenSignaling(): void {
    // 如果已经在监听，不重复注册
    if (_unsubSignaling) return
    
    // 注册全局消息监听器
    _unsubSignaling = WebSocketManager.getInstance().addGlobalMessageListener((event) => {
      // 只处理信令连接的消息
      if (event.connectionId !== signalingConnectionId) return

      // 解析消息内容（可能是字符串、ArrayBuffer 或 Blob）
      let text: string
      if (typeof event.data === 'string') {
        text = event.data  // 直接是字符串
      } else if (event.data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(event.data)  // ArrayBuffer 转字符串
      } else if (event.data instanceof Blob) {
        // Blob 需要异步读取
        event.data.text().then((t) => handleSignaling(JSON.parse(t))).catch(() => {})
        return
      } else {
        return  // 其他类型忽略
      }

      // 解析 JSON 并处理信令消息
      try {
        handleSignaling(JSON.parse(text))
      } catch {
        // 忽略非 JSON 消息（如心跳 ping/pong）
      }
    })
  }

  // 标记是否正在等待生产者上线
  let _waitingForProducer = false

  /**
   * 处理信令消息
   * 根据不同的消息类型采取不同行动
   * 
   * 消息类型：
   * - subscribe-ack: 订阅确认（告知摄像头是否在线）
   * - producer-online: 生产者上线通知
   * - answer: SDP Answer（服务端响应）
   * - ice-candidate: ICE 候选（网络路径信息）
   */
  function handleSignaling(msg: SignalingMessage): void {
    // 只处理当前摄像头的消息
    if (msg.cameraId !== cameraId) return

    switch (msg.type) {
      case 'subscribe-ack': {
        // 订阅确认：服务端告知摄像头是否在线
        const ack = msg as unknown as { producerOnline: boolean }
        
        if (ack.producerOnline) {
          // 摄像头在线，立即开始协商
          _waitingForProducer = false
          state.value.connectionState = 'connecting'
          startNegotiation()
        } else {
          // 摄像头离线，等待上线通知
          _waitingForProducer = true
          state.value.connectionState = 'connecting'
        }
        break
      }
      case 'producer-online': {
        // 生产者上线通知：之前离线的摄像头现在上线了
        if (_waitingForProducer) {
          _waitingForProducer = false
          startNegotiation()  // 开始协商
        }
        break
      }
      case 'answer':
        // 收到 SDP Answer，完成连接协商
        handleAnswer(msg)
        break
      case 'ice-candidate':
        // 收到 ICE 候选，添加到 PeerConnection
        handleIceCandidate(msg)
        break
    }
  }

  /**
   * 处理 SDP Answer
   * Answer 包含了服务端的媒体能力和连接信息
   */
  async function handleAnswer(msg: SignalingMessage): Promise<void> {
    if (!pc.value || !msg.sdp) return
    
    try {
      // 设置远端描述（服务端的 Answer）
      await pc.value.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: msg.sdp,
      }))
    } catch (e) {
      state.value.error = `setRemoteDescription 失败: ${(e as Error).message}`
    }
  }

  /**
   * 处理 ICE 候选
   * ICE 候选包含了网络路径信息，用于建立 P2P 连接
   */
  function handleIceCandidate(msg: SignalingMessage): void {
    if (!pc.value || !msg.candidate) return
    
    try {
      // 添加 ICE 候选到 PeerConnection
      pc.value.addIceCandidate(new RTCIceCandidate(msg.candidate))
    } catch (e) {
      state.value.error = `addIceCandidate 失败: ${(e as Error).message}`
    }
  }

  // ==================== 启动连接 ====================
  
  /**
   * 启动 WebRTC 连接（第一步）
   * 
   * 流程：
   * 1. 关闭旧连接（如果有）
   * 2. 开始监听信令消息
   * 3. 发送订阅消息，等待服务端响应
   * 4. 收到 subscribe-ack 后，触发 startNegotiation
   * 
   * @example
   * await start()  // 开始观看摄像头视频
   */
  async function start(): Promise<void> {
    // 如果已销毁，不执行
    if (destroyed.value) return
    
    state.value.error = null  // 清除错误状态

    // 关闭旧连接（清理资源）
    closePeerConnection()

    // 开始监听信令消息
    listenSignaling()

    // 设置状态为"连接中"
    state.value.connectionState = 'connecting'
    
    // 发送订阅消息，告诉服务端我们要观看这个摄像头
    sendSignaling({ type: 'subscribe', cameraId, timestamp: Date.now() })
  }

  /**
   * 发起 WebRTC 协商（第二步）
   * 
   * 这是 WebRTC 的核心流程：
   * 1. 创建 Offer（包含本地媒体能力）
   * 2. 设置本地描述
   * 3. 发送 Offer 给服务端
   * 4. 等待服务端返回 Answer
   * 
   * 注意：这个方法由 handleSignaling 在收到 subscribe-ack 后自动调用
   */
  async function startNegotiation(): Promise<void> {
    // 如果 PeerConnection 不存在或正在进行协商，先关闭重建
    if (!pc.value || pc.value.signalingState !== 'stable') {
      closePeerConnection()
    }

    // 创建新的 PeerConnection
    const newPc = createPeerConnection()
    pc.value = newPc

    try {
      // 第一步：创建 Offer（包含本地支持的编解码器、媒体类型等）
      const offer = await newPc.createOffer()
      
      // 第二步：设置本地描述（保存 Offer）
      await newPc.setLocalDescription(offer)

      // 第三步：发送 Offer 给服务端
      sendSignaling({
        type: 'offer',
        cameraId,
        sdp: offer.sdp,  // SDP（Session Description Protocol）协议描述
        timestamp: Date.now(),
      })
    } catch (e) {
      state.value.error = `创建 Offer 失败: ${(e as Error).message}`
    }
  }

  /**
   * 停止 WebRTC 连接
   * 
   * 流程：
   * 1. 发送取消订阅消息
   * 2. 关闭 PeerConnection
   * 3. 取消信令监听
   * 4. 清理状态
   */
  function stop(): void {
    // 告诉服务端不再接收这个摄像头的流
    sendSignaling({ type: 'unsubscribe', cameraId, timestamp: Date.now() })
    
    // 关闭 PeerConnection
    closePeerConnection()
    
    // 取消信令监听
    if (_unsubSignaling) {
      _unsubSignaling()
      _unsubSignaling = null
    }
    
    // 清理状态
    remoteStream.value = null
    _waitingForProducer = false
    stopTalk()  // 停止对讲（如果正在对讲）
  }

  /**
   * 销毁：彻底清理所有资源
   * 调用后不能再使用此 composable
   */
  function destroy(): void {
    destroyed.value = true
    stop()
  }

  // ==================== 对讲功能 ====================
  
  /**
   * 开始对讲（发送本地麦克风音频）
   * 
   * 流程：
   * 1. 采集本地麦克风音频
   * 2. 将音频轨道添加到 PeerConnection
   * 3. 重新协商 SDP（因为新增了音频轨道）
   * 4. 发送新的 Offer 给服务端
   * 
   * @returns 是否成功开始对讲
   */
  async function startTalk(): Promise<boolean> {
    // 如果 PeerConnection 不存在或已经在对讲，返回失败
    if (!pc.value || talking.value) return false

    try {
      // 请求麦克风权限，获取音频流
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localAudioStream.value = stream

      // 获取音频轨道
      const audioTrack = stream.getAudioTracks()[0]
      if (!audioTrack) {
        // 没有音频轨道，清理并返回失败
        stream.getTracks().forEach((t) => t.stop())
        return false
      }

      // 将本地音频轨道添加到 PeerConnection（sendonly 表示只发送，不接收）
      pc.value.addTrack(audioTrack, stream)
      talking.value = true

      // 重新协商 SDP（因为添加了音频发送轨道）
      const offer = await pc.value.createOffer()
      await pc.value.setLocalDescription(offer)
      sendSignaling({ type: 'offer', cameraId, sdp: offer.sdp })

      // 监听音频轨道结束事件（如用户从浏览器设置中停止麦克风）
      audioTrack.onended = () => {
        stopTalk()  // 自动停止对讲
      }

      return true
    } catch (e) {
      // 麦克风采集失败（如用户拒绝权限）
      state.value.error = `麦克风采集失败: ${(e as Error).message}`
      return false
    }
  }

  /**
   * 停止对讲
   * 
   * 流程：
   * 1. 停止本地音频流的所有轨道
   * 2. 从 PeerConnection 中移除音频发送器
   * 3. 更新状态
   */
  function stopTalk(): void {
    // 停止本地音频流
    if (localAudioStream.value) {
      localAudioStream.value.getTracks().forEach((t) => t.stop())
      localAudioStream.value = null
    }
    
    // 从 PeerConnection 中移除音频发送器
    if (pc.value) {
      const senders = pc.value.getSenders()  // 获取所有发送器
      for (const sender of senders) {
        if (sender.track?.kind === 'audio') {
          pc.value.removeTrack(sender)  // 移除音频发送器
        }
      }
    }
    
    talking.value = false  // 更新对讲状态
  }

  // ==================== 自动重连 ====================
  
  /**
   * 尝试重新连接
   * 
   * 使用指数退避算法：
   * - 第 1 次重连：延迟 2 秒
   * - 第 2 次重连：延迟 4 秒
   * - 第 3 次重连：延迟 8 秒
   * - 最大延迟 10 秒
   * 
   * 公式：delay = min(1000 * 2^attempts, 10000)
   */
  function attemptReconnect(): void {
    // 如果已销毁或达到最大重连次数，不再重连
    if (destroyed.value || reconnectAttempts.value >= maxReconnect) return
    
    reconnectAttempts.value++  // 重连次数 +1
    
    // 计算延迟（指数退避）
    const delay = Math.min(1000 * 2 ** reconnectAttempts.value, 10_000)
    
    // 延迟后重新连接
    setTimeout(() => {
      if (destroyed.value) return
      start()  // 重新启动连接流程
    }, delay)
  }

  // ==================== 内部辅助方法 ====================
  
  /**
   * 关闭 PeerConnection 并清理资源
   */
  function closePeerConnection(): void {
    if (pc.value) {
      // 清除事件监听器（防止内存泄漏）
      pc.value.onicecandidate = null
      pc.value.ontrack = null
      
      // 关闭连接
      pc.value.close()
      pc.value = null
    }
    
    // 清理流和状态
    remoteStream.value = null
    _hasReceivedTrack = false
    state.value = {
      connectionState: 'new',
      iceGatheringState: 'new',
      iceConnectionState: 'new',
      signalingState: 'stable',
      error: null,
    }
  }

  // ==================== 返回值 ====================
  
  /**
   * 返回状态和方法供外部使用
   * 
   * 状态（只读）：
   * - state: 连接状态信息
   * - remoteStream: 远端视频流（用于 <video> 标签播放）
   * - localAudioStream: 本地音频流
   * - talking: 是否正在对讲
   * - reconnectAttempts: 当前重连次数
   * 
   * 方法：
   * - start: 开始观看视频
   * - stop: 停止观看
   * - destroy: 销毁连接
   * - startTalk: 开始对讲
   * - stopTalk: 停止对讲
   */
  return {
    // 状态（使用 readonly 防止外部修改）
    state: readonly(state),
    remoteStream: readonly(remoteStream),
    localAudioStream: readonly(localAudioStream),
    talking: readonly(talking),
    reconnectAttempts: readonly(reconnectAttempts),

    // 方法
    start,
    stop,
    destroy,
    startTalk,
    stopTalk,
  }
}
