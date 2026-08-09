# 实时监控 — 拉流端实现详解（面试版）

> 本文档从**拉流端（Consumer / 浏览器前端）**的视角，逐层拆解实时监控的完整实现。
> 看完后你可以向面试官清晰地讲述：WebSocket 怎么建、信令怎么走、RTCPeerConnection 怎么用、每一行代码为什么这么写。

---

## 目录

1. [整体架构：拉流端是什么](#1-整体架构拉流端是什么)
2. [第一步：建立 WebSocket 连接](#2-第一步建立-websocket-连接)
3. [第二步：获取摄像头列表](#3-第二步获取摄像头列表)
4. [第三步：订阅摄像头 + 收到 subscribe-ack](#4-第三步订阅摄像头--收到-subscribe-ack)
5. [第四步：创建 RTCPeerConnection + 发送 Offer](#5-第四步创建-rtcpeerconnection--发送-offer)
6. [第五步：接收 Answer + ICE 候选交换](#6-第五步接收-answer--ice-候选交换)
7. [第六步：ontrack — 视频流到达](#7-第六步ontrack--视频流到达)
8. [第七步：停止播放与资源清理](#8-第七步停止播放与资源清理)
9. [进阶：对讲功能](#9-进阶对讲功能)
10. [进阶：自动重连](#10-进阶自动重连)
11. [代码架构：分层设计](#11-代码架构分层设计)
12. [面试自测清单](#12-面试自测清单)

---

## 1. 整体架构：拉流端是什么

实时监控系统有三个角色：

```
推流端 (Producer)          服务端 (Server)          拉流端 (Consumer)
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│ 摄像头设备     │        │ Node.js 服务  │        │ 浏览器大屏    │
│               │        │              │        │              │
│ getUserMedia  │   WS   │ 信令中继      │   WS   │ VideoPlayer  │
│   ↓           │◄──────►│ 消息路由      │◄──────►│   ↓          │
│ RTCPeerConn  │        │              │        │ useWebRTC    │
│   ↓           │        └──────────────┘        │   ↓          │
│ 发送视频流    │───P2P──────────────────────────→│ 接收视频流    │
└──────────────┘                                └──────────────┘
```

**拉流端就是浏览器中大屏页面的那部分**，它的职责是：

1. 通过 WebSocket 与服务端建立信令通道
2. 获取可用摄像头列表
3. 订阅某个摄像头，发起 WebRTC 协商
4. 接收视频流，渲染到 `<video>` 标签
5. 处理断线重连、资源清理

---

## 2. 第一步：建立 WebSocket 连接

### 2.1 为什么需要 WebSocket？

WebRTC 的 P2P 连接建立之前，两端需要交换 **SDP（媒体能力）** 和 **ICE 候选（网络地址）**。这些信息必须通过一个中间服务器来中转——这就是**信令服务器**。WebSocket 是信令通道的最佳选择，因为它是全双工的、低延迟的、浏览器原生支持的。

### 2.2 代码调用链

```
WebRTCView.vue onMounted()
  │
  └─> wsManager.createConnection({
        id: 'signaling',
        url: 'ws://10.122.147.40:3001/ws/signaling',
        heartbeatInterval: 15000,
        timeout: 5000,
        reconnectMaxAttempts: 10,
        reconnectBaseDelay: 1000,
      })
        │
        └─> new WsConnection(config)
              │
              └─> conn.connect()
```

### 2.3 WsConnection 内部做了什么（逐行解释）

```typescript
connect(): void {
    // ① 防重入：如果已经销毁了，不要再连接
    if (this.destroyed) return

    // ② 更新状态为 'connecting'，通知所有订阅者
    this.setState('connecting')

    // ③ 清除上一次连接的残留定时器（心跳、超时）
    this.clearTimers()

    // ④ 创建浏览器原生 WebSocket 对象
    try {
        this.ws = new WebSocket(this.config.url, this.config.protocols)
        //   ↑
        //   这一步做了三件事（浏览器内核完成）：
        //   a) TCP 三次握手（SYN → SYN-ACK → ACK）
        //   b) HTTP Upgrade 请求（GET /ws/signaling + Upgrade: websocket）
        //   c) 协议切换（HTTP 101 Switching Protocols → WebSocket 帧协议）
    } catch {
        // 如果 URL 格式错误或网络不可达，进入错误重连
        this.setState('error')
        this.scheduleReconnect()
        return
    }

    // ⑤ 连接超时保护
    //   如果 5 秒内还没连上，主动关闭并重连
    this.timeoutTimer = setTimeout(() => {
        if (this.state === 'connecting') {
            this.ws?.close()
            this.setState('error')
            this.scheduleReconnect()
        }
    }, this.config.timeout)  // timeout = 5000ms

    // ⑥ 注册 WebSocket 四个核心事件回调
    this.ws.onopen = () => { ... }
    this.ws.onmessage = (ev) => { ... }
    this.ws.onerror = () => { ... }
    this.ws.onclose = () => { ... }
}
```

### 2.4 四个事件回调详解

**onopen — 连接成功：**

```typescript
this.ws.onopen = () => {
    this.reconnectAttempts = 0   // 重置重连计数（连接成功说明网络恢复了）
    this.setState('connected')   // 通知外部：已连接
    this.clearTimeout()          // 取消超时定时器（已经连上了，不需要了）
    this.flushQueue()            // 把离线期间缓存的消息全部发出去
    this.startHeartbeat()        // 启动心跳：每 15 秒发一次 ping
}
```

**onmessage — 收到消息：**

```typescript
this.ws.onmessage = (ev: MessageEvent) => {
    this.onMessageCb?.({
        connectionId: this.config.id, // 哪个连接收到的
        data: ev.data,                // 消息体（string / ArrayBuffer / Blob）
        timestamp: Date.now(),        // 打时间戳
    })
}
// 注意：onMessageCb 由 WebSocketManager 在 createConnection 时设置，
// 它会将消息分发给所有全局监听器（globalMessageListeners）
```

**onerror — 发生错误：**

```typescript
this.ws.onerror = () => {
    // ⚠️ 这里不调用 setState('error')！
    // 原因：onerror 之后 onclose 一定会紧接着触发。
    // 如果在 onerror 里触发重连，onclose 又会触发一次，导致重复重连。
    // 正确的做法：只在 onclose 中统一处理所有断开场景。
}
```

**onclose — 连接关闭：**

```typescript
this.ws.onclose = () => {
    this.stopHeartbeat()  // 停止心跳定时器

    // 区分 "主动断开" 和 "异常断开"
    if (this.state !== 'disconnected') {
        // 异常断开（网络问题、服务端重启等）
        this.setState('error')
        this.scheduleReconnect()  // 触发指数退避重连
    }
    // 如果 state === 'disconnected'，说明是主动调用 disconnect()，不重连
}
```

### 2.5 心跳机制

```typescript
private startHeartbeat(): void {
    this.stopHeartbeat()  // 先清除旧的心跳，防止重复
    this.heartbeatTimer = setInterval(() => {
        this.send(this.config.heartbeatMessage!)  // 默认发 'ping' 或 '{"type":"ping"}'
    }, this.config.heartbeatInterval)  // 15000ms = 15秒
}
```

**为什么需要心跳？**

WebSocket 连接在 TCP 层面是长连接，但中间的网络设备（NAT 路由器、防火墙、代理）通常有超时机制——如果一段时间没有数据传输，会主动断开连接，而两端都不会收到任何通知（TCP 半开连接）。心跳定期发送小消息，让中间设备认为连接仍活跃。

---

## 3. 第二步：获取摄像头列表

### 3.1 信令连接就绪后的第一件事

```typescript
// WebRTCView.vue onMounted()

const conn = wsManager.getConnection('signaling')

conn?.onStateChange((state) => {
    signalingReady.value = state === 'connected'

    if (state === 'connected') {
        // 信令通道刚建立，立即询问"有哪些摄像头"
        conn.send(JSON.stringify({ type: 'get-cameras' }))
    }
})

conn?.connect()
```

### 3.2 处理服务端返回

```typescript
function handleMsg(msg: Record<string, unknown>): void {
    switch (msg.type) {
        case 'camera-list': {
            const cameras = (msg.cameras as CameraInfo[]) ?? []
            cameraStore.setCameras(cameras)
            // setCameras 内部：
            //   cameras.value = new Map(cameras.map(c => [c.cameraId, c]))
            break
        }
    }
}
```

### 3.3 全局消息监听器是怎么工作的

```
WebSocketManager
  │
  ├── connections: Map { 'signaling' → WsConnection }
  │
  └── globalMessageListeners: Set [
        listener1 = useWebRTC 注册的（用于接收信令）
        listener2 = WebRTCView 注册的（用于接收 camera-list、producer-online）
      ]

消息到达流程：
  ws.onmessage 触发
    → WsConnection.onMessageCb
      → WebSocketManager.dispatchToListeners(event)
        → 遍历 globalMessageListeners
          → 每个 listener(event) 被调用
          → 如果某个 listener 报错，try/catch 隔离，不影响其他
```

**为什么要用全局监听器而不是每个连接单独设置？**

因为可能有多个组件、多个 Store 都需要接收同一个连接的消息。比如 `cameraStore` 需要 `camera-list`，`useWebRTC` 需要 `answer`/`ice-candidate`。全局监听器模式让每个订阅者独立注册和取消，互不干扰。

---

## 4. 第三步：订阅摄像头 + 收到 subscribe-ack

### 4.1 用户双击卡片

```typescript
// WebRTCView.vue
function toggleCamera(cameraId: string): void {
    if (activeCameras.has(cameraId)) {
        activeCameras.delete(cameraId)  // 已播放 → 停止
    } else {
        if (activeCameras.size >= cameraStore.maxConcurrent) {
            // 超出并发限制，淘汰最早播放的
            const first = activeCameras.keys().next().value
            if (first) activeCameras.delete(first)
        }
        // 创建播放状态，默认 live 模式
        activeCameras.set(cameraId, createDefaultState())
    }
}
```

模板中的响应：

```html
<!-- activeCameras.has(cam.cameraId) === true → 渲染 VideoPlayer -->
<VideoPlayer
    v-else
    :camera-id="cam.cameraId"
    :mode="'live'"
    :show-mode-switch="true"
    ...
/>
```

### 4.2 VideoPlayer mount → useWebRTC.start()

```typescript
// VideoPlayer.vue
onMounted(() => {
    if (props.mode === 'live') {
        switchToLive()
    }
})

function switchToLive() {
    destroyVod()        // 清理 VOD（如果有）
    currentMode = 'live'
    start()             // → useWebRTC.start()
}
```

### 4.3 useWebRTC.start() 内部

```typescript
async function start(): Promise<void> {
    if (destroyed.value) return  // 已销毁，不执行

    state.value.error = null     // 清除上次的错误

    closePeerConnection()        // 关闭旧连接（如果有）

    listenSignaling()            // 注册全局消息监听

    state.value.connectionState = 'connecting'
    // ↑ 触发 VideoPlayer 模板更新：显示 spinner + "连接中..."

    sendSignaling({
        type: 'subscribe',
        cameraId,
        timestamp: Date.now()
    })
    // ↑ 告诉服务端：我要看这个摄像头
}
```

### 4.4 listenSignaling() — 注册信令监听

```typescript
function listenSignaling(): void {
    if (_unsubSignaling) return  // 已有监听，不重复注册

    _unsubSignaling = WebSocketManager.getInstance()
        .addGlobalMessageListener((event) => {
            // 过滤：只处理信令连接的消息
            if (event.connectionId !== signalingConnectionId) return

            // 解析消息体（兼容 string / ArrayBuffer / Blob）
            let text: string
            if (typeof event.data === 'string') {
                text = event.data
            } else if (event.data instanceof ArrayBuffer) {
                text = new TextDecoder().decode(event.data)
            } else if (event.data instanceof Blob) {
                event.data.text()
                    .then((t) => handleSignaling(JSON.parse(t)))
                    .catch(() => {})
                return
            } else {
                return
            }

            try {
                handleSignaling(JSON.parse(text))
            } catch {
                // 忽略非 JSON 消息（如心跳 ping）
            }
        })
}
```

### 4.5 handleSignaling — subscribe-ack 处理

```typescript
function handleSignaling(msg: SignalingMessage): void {
    if (msg.cameraId !== cameraId) return  // 只处理自己的消息

    switch (msg.type) {
        case 'subscribe-ack': {
            const ack = msg as unknown as { producerOnline: boolean }

            if (ack.producerOnline) {
                // 摄像头在线 → 立即开始 WebRTC 协商
                _waitingForProducer = false
                state.value.connectionState = 'connecting'
                startNegotiation()
            } else {
                // 摄像头离线 → 等待 producer-online 通知
                _waitingForProducer = true
                state.value.connectionState = 'connecting'
            }
            break
        }

        case 'producer-online': {
            // 之前等待的摄像头现在上线了
            if (_waitingForProducer) {
                _waitingForProducer = false
                startNegotiation()
            }
            break
        }
    }
}
```

**两种情况的处理逻辑：**

```
情况 A: subscribe 时 producer 已在线
  → subscribe-ack(producerOnline: true)
  → 立即 startNegotiation()

情况 B: subscribe 时 producer 离线
  → subscribe-ack(producerOnline: false)
  → 设置 _waitingForProducer = true
  → 等待 producer-online 消息
  → 收到后立即 startNegotiation()
```

---

## 5. 第四步：创建 RTCPeerConnection + 发送 Offer

这是整个流程的**核心**。面试时一定要能讲清楚每一步。

### 5.1 startNegotiation() — 发起协商

```typescript
async function startNegotiation(): Promise<void> {
    // 如果已有 PC 且在上一次协商中，先关闭重建
    if (!pc.value || pc.value.signalingState !== 'stable') {
        closePeerConnection()
    }

    // 创建新的 PeerConnection
    const newPc = createPeerConnection()
    pc.value = newPc

    try {
        // ① 创建 Offer（SDP）
        const offer = await newPc.createOffer()

        // ② 设置为本地描述
        await newPc.setLocalDescription(offer)

        // ③ 通过信令发送给服务端
        sendSignaling({
            type: 'offer',
            cameraId,
            sdp: offer.sdp,
            timestamp: Date.now(),
        })
    } catch (e) {
        state.value.error = `创建 Offer 失败: ${(e as Error).message}`
    }
}
```

### 5.2 createPeerConnection() — 逐行详解

```typescript
function createPeerConnection(): RTCPeerConnection {
    // ═══════════════════════════════════════════
    // ① 构造 RTCPeerConnection
    // ═══════════════════════════════════════════
    const connection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    })
    // ICE (Interactive Connectivity Establishment)：
    // 用于在 NAT 之后的两个设备之间建立直接的 P2P 连接。
    //
    // STUN 服务器的作用：
    // 告诉每个设备"你的公网 IP 和端口是什么"。
    // 浏览器内核向 STUN 服务器发送 Binding Request，
    // STUN 回复 Binding Response，包含客户端的公网映射地址。
    //
    // 三种候选类型：
    // 1. host：本地网卡地址 (192.168.x.x)
    // 2. srflx：NAT 映射地址 (从 STUN 获取)
    // 3. relay：TURN 中继地址 (对称 NAT 兜底，未配置)

    // ═══════════════════════════════════════════
    // ② 添加媒体收发器
    // ═══════════════════════════════════════════
    connection.addTransceiver('video', { direction: 'recvonly' })
    // direction: 'recvonly' 的含义：
    //   - 只接收视频，不发送视频
    //   - 浏览器内核据此：
    //     a) 在 SDP 中标记 a=recvonly
    //     b) 不初始化本地视频编码器（省 CPU）
    //     c) 告诉对方"我不会发视频给你"
    //
    // Transceiver 是 WebRTC 1.0 Unified Plan 的概念，
    // 取代了旧版 Plan B 的 addStream API。
    // 每个 Transceiver 代表一个媒体流的"收发器"，
    // 可以独立控制 direction: sendrecv | sendonly | recvonly | inactive

    // ═══════════════════════════════════════════
    // ③ 注册事件监听器
    // ═══════════════════════════════════════════

    // --- ICE candidate 事件 ---
    connection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignaling({
                type: 'ice-candidate',
                cameraId,
                candidate: event.candidate.toJSON(),
            })
        }
    }
    // ICE candidates 的发现是异步并行的：
    // setLocalDescription(offer) 之后，浏览器开始收集候选地址。
    // 每发现一个就可以发送，不需要等全部收集完。
    // 这叫 Trickle ICE（逐滴 ICE），可以显著加快连接建立。

    // --- ICE 连接状态 ---
    connection.oniceconnectionstatechange = () => {
        state.value.iceConnectionState = connection.iceConnectionState
        if (connection.iceConnectionState === 'failed') {
            attemptReconnect()
        }
    }
    // iceConnectionState 的状态转移：
    // new → checking (开始连通性检测)
    //     → connected (找到可用路径 ✓)
    //     → failed (所有路径不通 ✗)
    //     → disconnected (暂时断开，可能恢复)
    //     → closed

    // --- ICE 收集状态 ---
    connection.onicegatheringstatechange = () => {
        state.value.iceGatheringState = connection.iceGatheringState
    }
    // iceGatheringState: new → gathering → complete

    // --- 信令状态 ---
    connection.onsignalingstatechange = () => {
        state.value.signalingState = connection.signalingState
    }
    // signalingState 判断是否可以安全地进行 SDP 协商：
    //   stable ← 可以创建 offer 或 answer
    //   have-local-offer ← 已设置本地 offer，等待远端 answer
    //   have-remote-offer ← 已收到远端 offer，正在创建 answer

    // --- 连接状态 ---
    connection.onconnectionstatechange = () => {
        state.value.connectionState = connection.connectionState
        switch (connection.connectionState) {
            case 'connected':
                reconnectAttempts.value = 0  // 重置重连计数
                break
            case 'failed':
            case 'disconnected':
                attemptReconnect()
                break
        }
    }
    // connectionState 是整体连接的健康指标：
    // new → connecting → connected → disconnected → failed → closed
    //
    // 注意：connectionState 和 iceConnectionState 的区别：
    // - connectionState 涵盖所有组件（ICE + DTLS + 数据传输）
    // - iceConnectionState 只看 ICE 层

    // ═══════════════════════════════════════════
    // ④ ontrack — 接收远端媒体流
    // ═══════════════════════════════════════════
    connection.ontrack = (event) => {
        if (event.streams[0]) {
            remoteStream.value = event.streams[0]
            _hasReceivedTrack = true
        }
    }
    // ontrack 事件在远端媒体流到达时触发。
    // event.streams[0] 是一个 MediaStream 对象，
    // 可以直接赋值给 <video> 的 srcObject 属性。
    //
    // shallowRef 的选择：
    // remoteStream 用 shallowRef 而不是 ref 存储。
    // 原因：MediaStream 是浏览器内核管理的原生对象，
    // 包含大量的内部属性和方法（track 列表、编解码状态、RTP 统计等）。
    // 如果使用 ref()，Vue 3 会递归地将整个对象包装成深层 Proxy，
    // 这是无意义且昂贵的。我们只需要知道 stream 对象是否被替换
    // （.value = newStream），不关心内部属性的变化。
    // shallowRef 只追踪 .value 的替换，恰好满足需求。

    return connection
}
```

### 5.3 Offer SDP 长什么样

`createOffer()` 返回的 SDP（Session Description Protocol）描述了拉流端的媒体能力：

```
v=0
o=- 4616505862662925077 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE video
a=ice-ufrag:wZqK                          ← ICE 用户名（用于身份验证）
a=ice-pwd:W6mZsJdF...                     ← ICE 密码
a=fingerprint:sha-256 6A:4F:...           ← DTLS 证书指纹（加密密钥）
a=setup:actpass                           ← DTLS 角色协商
m=video 9 UDP/TLS/RTP/SAVPF 96 97 98      ← 视频媒体行
c=IN IP4 0.0.0.0
a=rtpmap:96 VP8/90000                     ← 支持 VP8 编码
a=rtpmap:97 H264/90000                    ← 支持 H.264 编码
a=rtpmap:98 red/90000                     ← 支持 RED（冗余编码）
a=recvonly                                ← ★ 关键：我只接收，不发送
a=rtcp-mux                                ← RTP 和 RTCP 复用同一端口
a=candidate:... 1 udp 2130706431 192.168.1.5 54321 typ host
a=candidate:... 1 udp 1694498815 203.0.113.5 12345 typ srflx  ← STUN 获取的公网地址
```

**每一行的含义：**

| 行 | 含义 |
|----|------|
| `a=ice-ufrag` / `a=ice-pwd` | ICE 凭据，用于验证对方身份 |
| `a=fingerprint` | DTLS 证书指纹，用于加密 P2P 通道 |
| `m=video 9 ...` | 媒体行，"9" 是占位端口（实际端口由 ICE 决定） |
| `a=rtpmap:96 VP8` | RTP 负载类型 96 = VP8 编码 |
| `a=rtpmap:97 H264` | RTP 负载类型 97 = H.264 编码 |
| `a=recvonly` | 方向：只接收（拉流端标志） |
| `candidate typ host` | 本地地址候选 |
| `candidate typ srflx` | STUN 发现的公网映射地址 |

---

## 6. 第五步：接收 Answer + ICE 候选交换

### 6.1 handleAnswer — 接收 SDP Answer

```typescript
async function handleAnswer(msg: SignalingMessage): Promise<void> {
    if (!pc.value || !msg.sdp) return

    try {
        await pc.value.setRemoteDescription(
            new RTCSessionDescription({
                type: 'answer',
                sdp: msg.sdp,
            })
        )
    } catch (e) {
        state.value.error = `setRemoteDescription 失败: ${(e as Error).message}`
    }
}
```

`setRemoteDescription` 的作用：
- 解析推流端的 SDP 内容
- 双方 SDP 对齐后，媒体编解码参数确定
- ICE 连通性检测正式开始

### 6.2 handleIceCandidate — 接收 ICE 候选

```typescript
function handleIceCandidate(msg: SignalingMessage): void {
    if (!pc.value || !msg.candidate) return

    try {
        pc.value.addIceCandidate(new RTCIceCandidate(msg.candidate))
    } catch (e) {
        state.value.error = `addIceCandidate 失败: ${(e as Error).message}`
    }
}
```

### 6.3 ICE 候选到达顺序问题

```
时间线：
  T=0:   发送 Offer
  T=1:   ICE candidate host 发现 → 发送
  T=10:  ICE candidate srflx 发现 → 发送
  T=15:  收到 Answer → setRemoteDescription

  ICE 候选的到达可能是无序的：
  - 候选可能在 answer 之前到达（T=1, T=10 < T=15）
  - 也可能在 answer 之后到达

  处理策略：
  - `addIceCandidate` 被调用时，浏览器内核会将候选暂存在 ICE agent 中
  - 一旦 remote description 设置完成，ICE agent 立即开始验证所有候选
  - 因此不需要手动缓存候选，浏览器内核自动处理
```

### 6.4 ICE 连通性检测

```
ICE agent 的连通性检测（connectivity check）：

  1. 收集所有候选对 (local candidate × remote candidate)
  2. 按优先级排序（host×host > host×srflx > srflx×srflx > relay）
  3. 逐对发送 STUN Binding Request
  4. 收到 Binding Response → 该路径可用
  5. 选择最优可用路径作为 nominated pair

  iceConnectionState: checking → connected ✓

  如果所有路径都不通：
  iceConnectionState: checking → failed ✗
  触发 attemptReconnect()
```

---

## 7. 第六步：ontrack — 视频流到达

### 7.1 流到达时

```typescript
connection.ontrack = (event) => {
    if (event.streams[0]) {
        remoteStream.value = event.streams[0]
        _hasReceivedTrack = true
    }
}
```

`remoteStream` 是 `shallowRef<MediaStream | null>`，赋值后 Vue 3 响应式系统触发模板更新。

### 7.2 VideoPlayer 模板中的绑定

```html
<video
    ref="videoRef"
    autoplay
    playsinline
    :srcObject="mode === 'live' ? remoteStream : null"
    @loadedmetadata="onVideoReady"
/>
```

- `:srcObject` 是 Vue 3 新增的绑定，直接设置 `video.srcObject = mediaStream`
- `autoplay` + `playsinline`：自动播放，iOS Safari 上不强制全屏
- `loadedmetadata` 事件在视频元数据加载完成后触发

### 7.3 延时估算

```typescript
function onVideoReady(): void {
    const video = videoRef.value
    if (!video) return

    if (props.mode === 'live') {
        latencyStart = Date.now()

        // 用 rAF 持续估算延时
        const trackLatency = (): void => {
            if (!video || video.paused || video.ended) return

            const playTime = video.currentTime * 1000      // 视频已播放的毫秒数
            const wallTime = Date.now() - latencyStart      // 从开始到现在的实际毫秒数
            latestLatency.value = Math.max(0, Math.round(wallTime - playTime))
            //                        ↑
            //                        差值就是端到端延时的近似值

            requestAnimationFrame(trackLatency)
        }
        trackLatency()

        emit('connected', props.cameraId)
    }
}
```

**为什么用 rAF 而不是 setInterval？**
- rAF 与屏幕刷新率同步（通常 60fps），不会在页面不可见时执行
- setInterval 即使页面隐藏也会持续执行，浪费资源

---

## 8. 第七步：停止播放与资源清理

### 8.1 stop() — 正常停止

```typescript
function stop(): void {
    // ① 告诉服务端：我不看了
    sendSignaling({ type: 'unsubscribe', cameraId, timestamp: Date.now() })

    // ② 关闭 PeerConnection
    closePeerConnection()

    // ③ 取消全局消息监听
    if (_unsubSignaling) {
        _unsubSignaling()   // 调用返回的取消函数
        _unsubSignaling = null
    }

    // ④ 清除状态
    remoteStream.value = null
    _waitingForProducer = false
    stopTalk()  // 如果正在对讲，也停止
}
```

### 8.2 destroy() — 彻底销毁

```typescript
function destroy(): void {
    destroyed.value = true  // ★ 先置标志位
    stop()
}
```

**destroyed 标志位的作用：**

`destroy()` 被调用后，所有异步回调（信令消息、ontrack、重连定时器）检查 `destroyed.value`，如果为 true 则直接 return，不执行任何操作。这防止了在组件卸载后操作已关闭的 PeerConnection 或已销毁的 HLS 实例。

### 8.3 closePeerConnection() — 内部清理

```typescript
function closePeerConnection(): void {
    if (pc.value) {
        // 清除事件回调（防止内存泄漏）
        pc.value.onicecandidate = null
        pc.value.ontrack = null

        // 关闭连接（释放 UDP 端口、ICE 候选等系统资源）
        pc.value.close()
        pc.value = null
    }

    // 重置所有状态
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
```

**为什么要把事件回调设为 null？**
- `PeerConnection.close()` 关闭 UDP 通道但不会自动移除 JS 事件监听器
- 如果监听器持有外部变量的引用，会导致闭包内存泄漏
- 手动设为 null 切断引用链

### 8.4 组件卸载时的完整清理链

```
WebRTCView.vue onUnmounted()
  → activeCameras.clear()
  → cameraStore.$reset()
  → wsManager.removeConnection('signaling')
      → conn.destroy()
          → destroyed = true
          → disconnect()
          → messageQueue = []
          → onMessageCb = null

VideoPlayer.vue onUnmounted()
  → 如果 currentMode === 'live':
      destroyWebRTC()
        → destroyed.value = true
        → stop()
          → sendSignaling('unsubscribe')
          → closePeerConnection()
          → _unsubSignaling() 取消监听
          → remoteStream = null

  → 如果 currentMode === 'vod':
      destroyVod()
        → hls.destroy()
        → video.src = ''
```

---

## 9. 进阶：对讲功能

对讲功能在拉流端是 **"可选的音频发送"**。

### 9.1 startTalk — 开始对讲

```typescript
async function startTalk(): Promise<boolean> {
    if (!pc.value || talking.value) return false

    try {
        // ① 请求麦克风权限，获取本地音频流
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        localAudioStream.value = stream

        // ② 获取音频轨道
        const audioTrack = stream.getAudioTracks()[0]
        if (!audioTrack) {
            stream.getTracks().forEach((t) => t.stop())
            return false
        }

        // ③ 将音频轨道添加到已有的 PeerConnection
        //    此时 PeerConnection 上原本只有 recvonly 的 video transceiver
        //    addTrack 会新增一个音频 sender
        pc.value.addTrack(audioTrack, stream)
        talking.value = true

        // ④ 重新协商 SDP
        //    因为添加了新的 media track，需要重新 createOffer
        const offer = await pc.value.createOffer()
        await pc.value.setLocalDescription(offer)
        sendSignaling({ type: 'offer', cameraId, sdp: offer.sdp })

        // ⑤ 监听轨道结束事件
        audioTrack.onended = () => {
            stopTalk()  // 用户从浏览器关闭麦克风时自动停止
        }

        return true
    } catch (e) {
        state.value.error = `麦克风采集失败: ${(e as Error).message}`
        return false
    }
}
```

### 9.2 stopTalk — 停止对讲

```typescript
function stopTalk(): void {
    // ① 停止采集：释放麦克风
    if (localAudioStream.value) {
        localAudioStream.value.getTracks().forEach((t) => t.stop())
        localAudioStream.value = null
    }

    // ② 从 PeerConnection 移除音频 sender
    if (pc.value) {
        const senders = pc.value.getSenders()
        for (const sender of senders) {
            if (sender.track?.kind === 'audio') {
                pc.value.removeTrack(sender)
            }
        }
    }

    talking.value = false
}
```

---

## 10. 进阶：自动重连

### 10.1 触发条件

WebRTC 断线有两种检测方式：

**方式 1：ICE 层面检测**
```typescript
connection.oniceconnectionstatechange = () => {
    if (connection.iceConnectionState === 'failed') {
        attemptReconnect()
    }
}
```
ICE failed 意味着所有候选路径都不可达（UDP 打洞失败、网络切换等）。

**方式 2：整体连接层面检测**
```typescript
connection.onconnectionstatechange = () => {
    switch (connection.connectionState) {
        case 'connected':
            reconnectAttempts.value = 0  // 恢复 → 重置计数
            break
        case 'failed':
        case 'disconnected':
            attemptReconnect()
            break
    }
}
```
disconnected 是暂时断开（可能恢复），failed 是确认失败。

### 10.2 指数退避算法

```typescript
function attemptReconnect(): void {
    // 防护：已销毁 或 超过最大重连次数
    if (destroyed.value || reconnectAttempts.value >= maxReconnect) return

    reconnectAttempts.value++

    // 指数退避：1s → 2s → 4s → 8s → 10s (cap)
    const delay = Math.min(1000 * 2 ** reconnectAttempts.value, 10_000)

    setTimeout(() => {
        if (destroyed.value) return
        start()  // 重新开始整个连接流程
    }, delay)
}
```

**为什么用指数退避？**
- 立即重连（0ms 延迟）→ 如果服务端正在重启，所有客户端同时连接可能造成 "thundering herd" 问题
- 固定延迟（如 3s）→ 重连次数多了会频繁尝试，浪费资源
- **指数退避** → 越失败等得越久，给网络和服务端恢复留出时间，上限 10s 保证最终恢复时间可控

---

## 11. 代码架构：分层设计

```
视图层
  WebRTCView.vue        页面编排：WS 初始化、摄像头列表、并发控制
  VideoPlayer.vue        播放器 UI：遮罩、信息栏、模式切换、全屏

状态层 (Pinia Store)
  cameraStore.ts         摄像头管理：列表、在线状态、并发上限、注册/注销

逻辑层 (Composable)
  useWebRTC.ts           RTCPeerConnection 完整生命周期
  useVodPlayer.ts        HLS.js 播放控制
  useCameraPermission.ts 浏览器权限查询

服务层
  wsManager.ts           WebSocket 连接池、心跳、重连、消息分发
  VideoSyncManager.ts    NTP 式视频-数据时间戳同步

类型层
  dashboard.ts           CameraInfo、SignalingMessage、WebRTCState...
```

**分层的好处：**
- 每层职责单一，改动互不影响
- Composable 可被多个组件复用
- Store 集中管理跨组件状态
- 服务层与 UI 完全解耦，可独立测试

---

## 12. 面试自测清单

面试时如果被问到"你是怎么实现实时监控的"，可以按这个顺序讲：

### 建立 WebSocket 连接

- [ ] WebSocket 用于信令交换，不是传输媒体流（媒体流走 WebRTC P2P）
- [ ] WebSocketManager 是单例模式，管理多个连接
- [ ] WsConnection 封装：状态机 (idle → connecting → connected → error)
- [ ] 心跳保活：每 15s 发 ping，防止 NAT/防火墙超时断开
- [ ] 连接超时保护：5s 超时判定失败
- [ ] 指数退避重连：delay = baseDelay × 2^attempts，上限 30s
- [ ] 离线消息队列：未连接时缓存，恢复后批量发送
- [ ] onerror 不处理重连，onclose 统一处理（防止重复重连）
- [ ] 页面可见性优化：隐藏时 pause，恢复时快速重连
- [ ] 全局消息监听器：多个订阅者通过 addGlobalMessageListener 接收消息

### 信令协议

- [ ] 所有信令消息都是 JSON，通过 `type` 字段区分
- [ ] `subscribe` → `subscribe-ack` (告知 producer 是否在线)
- [ ] `producer-online` → 如果之前 _waitingForProducer，现在发起协商
- [ ] `offer` / `answer` → SDP 交换
- [ ] `ice-candidate` → NAT 穿透候选地址交换
- [ ] `unsubscribe` → 通知服务端停止转发
- [ ] 拉流端发 Offer，推流端等 Offer（接收方主动发起，标准做法）

### RTCPeerConnection

- [ ] 构造函数中配置 ICE 服务器 (STUN)
- [ ] addTransceiver('video', { direction: 'recvonly' }) — 只接收不发送
- [ ] Transceiver 是 Unified Plan 概念，比旧版 addStream 更灵活
- [ ] createOffer() 生成 SDP，描述本地媒体能力
- [ ] setLocalDescription() + setRemoteDescription() 完成 SDP 协商
- [ ] Trickle ICE：候选逐个发现逐个发送，不等全部收集完
- [ ] ontrack 事件获取远端 MediaStream → video.srcObject
- [ ] ICE 候选到达顺序不保证，但浏览器内核自动缓存处理

### 状态与性能

- [ ] shallowRef 存储 MediaStream（避免深层 Proxy 开销）
- [ ] readonly 包装暴露给外部的状态（防止外部误修改）
- [ ] destroyed 标志位防止组件卸载后异步回调操作已关闭的资源
- [ ] closePeerConnection 中手动清除 onicecandidate/ontrack 防止内存泄漏

### 停止与清理

- [ ] stop() 发送 unsubscribe + 关闭 PC + 取消监听 + 清除状态
- [ ] destroy() 设置 destroyed 标志 + 调用 stop()
- [ ] onUnmounted 中完整清理

### 对讲

- [ ] getUserMedia({ audio: true }) 获取麦克风
- [ ] addTrack 将本地音频轨添加到已有 PC
- [ ] renegotiation：新增轨道后重新 createOffer
- [ ] audioTrack.onended 自动 stopTalk

### 重连

- [ ] ICE failed 或 connectionState failed/disconnected 触发重连
- [ ] 指数退避：1s → 2s → 4s → 8s → 10s (cap)
- [ ] 连接成功后 reconnectAttempts 归零
