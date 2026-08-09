# 设备监控大屏 — 视频播放系统技术总结

## 目录

1. [系统概览](#1-系统概览)
2. [端到端流程推演（面试叙述版）](#2-端到端流程推演面试叙述版)
3. [实时监控 — WebRTC 拉流](#3-实时监控--webrtc-拉流)
4. [历史回放 — HLS 点播](#4-历史回放--hls-点播)
5. [统一播放器组件 VideoPlayer](#5-统一播放器组件-videoplayer)
6. [WebSocket 信令与连接管理](#6-websocket-信令与连接管理)
7. [边界问题与容错设计](#7-边界问题与容错设计)
8. [性能优化](#8-性能优化)
9. [面试重点](#9-面试重点)

---

## 1. 系统概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Vue 3 前端大屏                             │
│                                                                  │
│  WebRTCView.vue (摄像头监控页)                                    │
│  ├─ VideoPlayer (实时监控)  ← useWebRTC → RTCPeerConnection       │
│  │                         ← WebSocket → 信令服务 (port 3001)      │
│  │                                                               │
│  └─ VideoPlayer (历史回放)  ← useVodPlayer → hls.js              │
│                            ← fetch API → VOD 服务 (port 3001)     │
│                                                                  │
│  公共基础设施:                                                     │
│  ├─ WebSocketManager (单例连接池)                                  │
│  ├─ cameraStore (Pinia, 摄像头状态 & 并发控制)                     │
│  ├─ VideoSyncManager (NTP 式视频-数据时间戳同步)                    │
│  └─ useCameraPermission (浏览器权限管理)                           │
└─────────────────────────────────────────────────────────────────┘
```

| 播放模式 | 协议 | 延迟 | 核心技术 | 适用场景 |
|---------|------|------|---------|---------|
| 实时监控 (live) | WebRTC | < 1s | RTCPeerConnection + 信令 WS | 实时画面监控、对讲 |
| 历史回放 (vod) | HLS | 3~10s | hls.js + HTTP fetch API | 录像回放、事故追溯 |

---

## 2. 端到端流程推演（面试叙述版）

> 以下按照"用户打开页面 → 看到实时画面 → 切换到历史回放"的完整时间线，逐步推演每一步发生了什么。面试时可以沿着这个叙事线讲。

---

### 第一步：页面加载，建立 WebSocket 连接

**用户打开浏览器，访问 `/webrtc` 路由。**

```
浏览器                                        服务端 (port 3001)
  │                                               │
  │  WebRTCView.vue onMounted()                   │
  │    ↓                                          │
  │  wsManager.createConnection({                 │
  │    id: 'signaling',                           │
  │    url: 'ws://10.122.147.40:3001/ws/signaling'│
  │    heartbeatInterval: 15000,                  │
  │    timeout: 5000,                             │
  │    reconnectMaxAttempts: 10,                  │
  │    reconnectBaseDelay: 1000,                  │
  │  })                                           │
  │    ↓                                          │
  │  new WebSocket('ws://...') ───────────────────>│ TCP 握手 + HTTP Upgrade
  │                                               │
  │  WebSocket onopen                              │
  │    ↓                                          │
  │  state = 'connected'                          │
  │  启动心跳 setInterval(15000)                   │
  │  发送缓存的消息队列 (此时为空)                    │
  │    ↓                                          │
  │  发送: {"type":"get-cameras"} ────────────────>│ 服务端收到第一条消息
  │                                               │
  │<────────── {"type":"camera-list",             │ 服务端返回摄像头列表
  │             "cameras":[{                       │
  │               cameraId:"notebook-cam",         │
  │               name:"笔记本摄像头",              │
  │               status:"online",                 │
  │               resolution:{w:1920,h:1080},      │
  │               fps:30                           │
  │             }]}                                │
  │    ↓                                          │
  │  handleMsg() → switch(msg.type)               │
  │    case 'camera-list':                         │
  │      cameraStore.setCameras(cameras)           │
  │        ↓                                      │
  │      cameras.value = Map {                     │
  │        'notebook-cam' → {...}                  │
  │      }                                        │
  │                                               │
  │  ★ 此刻页面渲染出摄像头卡片网格                   │
  │    每个卡片显示名称、在线状态、分辨率              │
  │    卡片中央是大大的 📷 占位图 + "双击播放"         │
```

**关键代码位置：**

| 步骤 | 文件 | 行/函数 |
|------|------|---------|
| 创建 WS 连接 | `WebRTCView.vue` | `onMounted()` → `wsManager.createConnection()` |
| WS 连接建立 | `wsManager.ts` | `WsConnection.connect()` → `ws.onopen` |
| 发送 get-cameras | `WebRTCView.vue` | `conn.onStateChange` 回调中 `conn.send(...)` |
| 解析 camera-list | `WebRTCView.vue` | `handleMsg()` → `cameraStore.setCameras()` |
| 渲染卡片列表 | `WebRTCView.vue` | `<article v-for="cam in cameraStore.cameraList">` |

---

### 第二步：推流端上线，服务端广播通知

**与此同时（或稍后），某台摄像头设备打开浏览器，开始推流。**

```
摄像头设备 (Producer)                           服务端 (port 3001)
  │                                               │
  │  new WebSocket('ws://...') ──────────────────>│
  │  {"type":"publish",                           │
  │   "cameraId":"notebook-cam"} ────────────────>│
  │                                               │
  │                                    服务端处理 publish:              │
  │                                      cameras['notebook-cam'] = {   │
  │                                        producer: ws_producer,      │
  │                                        consumers: Set []           │
  │                                      }                             │
  │                                               │
  │<────────── {"type":"published"} ──────────────│ 确认注册成功
  │                                               │
  │                         服务端广播给所有消费者:   │
  │                                               │
  │<────────── {"type":"producer-online",         │
  │             "cameraId":"notebook-cam"} ───────│ 大屏收到通知
  │                                               │
  │  handleMsg() →                                │
  │    case 'producer-online':                    │
  │      cameraStore.handleCameraStatus({         │
  │        cameraId,                              │
  │        status: 'online'                       │
  │      })                                       │
  │        ↓                                      │
  │      更新 cameras Map 中对应摄像头的 status     │
  │      ★ 卡片上的状态灯由灰变绿                   │
```

**注意：** 推流端此时处于**等待状态**——它注册了身份，但还没有收到任何拉流端的 offer，所以 `RTCPeerConnection` 尚未创建。这是 WebRTC 的典型模式：**推流端等 offer，拉流端发 offer**。

---

### 第三步：用户双击卡片，开始实时监控

**用户双击 "笔记本摄像头" 卡片。**

```
用户双击卡片
  │
  │  @dblclick="toggleCamera('notebook-cam')"
  │    ↓
  │  activeCameras.has('notebook-cam')?  // false，当前未播放
  │    ↓
  │  activeCameras.set('notebook-cam', {
  │    mode: 'live',
  │    vodStart: '2026-05-30T...',  // 默认值，暂不用
  │    vodEnd: '2026-05-30T...',
  │    vodPlaylistUrl: '',
  │    vodLoading: false,
  │    vodError: null,
  │  })
  │    ↓
  │  ★ 模板重新渲染：
  │    activeCameras.has('notebook-cam') === true
  │      → card-thumb 隐藏，VideoPlayer 渲染
  │      → VideoPlayer props: { mode: 'live', cameraId: 'notebook-cam', ... }
```

**VideoPlayer 组件 mount，启动 WebRTC：**

```
VideoPlayer.vue onMounted()
  │
  │  props.mode === 'live'
  │    ↓
  │  switchToLive()
  │    ↓
  │  currentMode = 'live'
  │    ↓
  │  useWebRTC({cameraId:'notebook-cam'}).start()
  │    ↓
  │  ┌─────────────────────────────────────────┐
  │  │         useWebRTC.start() 内部           │
  │  │                                         │
  │  │  1. state.connectionState = 'connecting' │
  │  │     ★ VideoPlayer 模板显示旋转 spinner    │
  │  │     ★ 遮罩文字："连接中..."               │
  │  │                                         │
  │  │  2. listenSignaling()                   │
  │  │     → wsManager.addGlobalMessageListener│
  │  │     → 过滤 signalingConnectionId        │
  │  │     → 过滤 msg.cameraId === cameraId    │
  │  │     → 分发到 handleSignaling()          │
  │  │                                         │
  │  │  3. sendSignaling({                     │
  │  │       type: 'subscribe',                │
  │  │       cameraId: 'notebook-cam'          │
  │  │     })                                  │
  │  └─────────────────────────────────────────┘
  │    ↓
  │  WebSocket send ────────────────────────────> 服务端
```

**服务端处理 subscribe：**

```
服务端收到 subscribe
  │
  │  cameras['notebook-cam'].consumers.add(ws_consumer)
  │
  │  检查 producer 是否在线:
  │    cameras['notebook-cam'].producer !== null  → 在线!
  │
  │  回复:
  │    {"type":"subscribe-ack",
  │     "cameraId":"notebook-cam",
  │     "producerOnline": true}
  │
  │<────────────────────────────────────── 前端收到 subscribe-ack
  │
  │  handleSignaling():
  │    case 'subscribe-ack':
  │      msg.producerOnline === true
  │        ↓
  │      startNegotiation()  ← 开始 WebRTC 协商
```

**WebRTC 协商正式开始：**

```
startNegotiation() 内部

  1. closePeerConnection()  // 确保旧 PC 已关闭（首次为 null，跳过）

  2. new RTCPeerConnection({
       iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
     })
     │
     │  → pc 对象创建，浏览器内核开始：
     │    - 分配本地端口
     │    - 向 STUN 服务器发送 Binding Request
     │    - 收集本地地址 (host) 和 NAT 映射地址 (srflx)
     │    - 启动 ICE agent
     │
     │  pc.iceConnectionState: 'new' → 'checking'
     │  pc.connectionState: 'new' → 'connecting'

  3. pc.addTransceiver('video', { direction: 'recvonly' })
     │
     │  → 声明：这个连接只接收视频，不发送视频
     │  → 浏览器内核据此做两件事：
     │    a) 跳过本地视频编码器初始化（省 CPU）
     │    b) offer SDP 中 video m= section 标记为 recvonly

  4. const offer = await pc.createOffer()
     │
     │  → 浏览器内核生成 SDP (Session Description Protocol) 文本
     │  → 内容包括：
     │    - 支持的编解码器: VP8, H.264 (视频), Opus (音频，但标记 recvonly)
     │    - ICE 凭据: ufrag (用户名) + pwd (密码)
     │    - DTLS 指纹: 用于加密媒体流的证书指纹
     │    - 候选地址: host → STUN → TURN (按优先级排列)
     │
     │  示例 SDP (简化):
     │  v=0
     │  o=- 123456 2 IN IP4 127.0.0.1
     │  s=-
     │  t=0 0
     │  a=group:BUNDLE video
     │  a=ice-ufrag:Ab12
     │  a=ice-pwd:XyZ9...
     │  a=fingerprint:sha-256 AB:CD:...
     │  m=video 9 UDP/TLS/RTP/SAVPF 96 97
     │  c=IN IP4 0.0.0.0
     │  a=rtpmap:96 VP8/90000
     │  a=rtpmap:97 H264/90000
     │  a=recvonly              ← 关键：我只接收
     │  a=ice-candidate:...
     │
     │  await pc.setLocalDescription(offer)
     │  → 浏览器内核确认本地 SDP，开始正式 ICE gathering
     │  → ICE candidate 逐个发现，触发 pc.onicecandidate 回调
     │  → 每个 candidate 通过 WebSocket 发送给服务端

  5. sendSignaling({                          ───> 服务端
       type: 'offer',
       cameraId: 'notebook-cam',
       sdp: offer.sdp     ← 完整的 SDP 文本
     })
```

**服务端转发 offer 给推流端：**

```
服务端收到 offer
  │
  │  查找 cameras['notebook-cam'].producer
  │  附加 consumerId (标识此 offer 来自哪个拉流端)
  │
  │  {"type":"offer",
  │   "cameraId":"notebook-cam",
  │   "consumerId":"consumer_abc123",
  │   "sdp":"v=0\r\no=- 123456...\r\n..."}
  │
  │──────────────────────────────────────> 推流端收到 offer
  │
  │  推流端处理:
  │  1. new RTCPeerConnection(...)
  │  2. addTrack(localVideoStream)    ← 添加本地摄像头采集的视频轨
  │  3. setRemoteDescription(offer)   ← 设置远端 SDP
  │  4. const answer = await createAnswer()
  │  5. setLocalDescription(answer)   ← 设置本地 SDP
  │  6. 发送 answer:
  │     {"type":"answer",
  │      "consumerId":"consumer_abc123",
  │      "sdp":"v=0\r\no=- 789012...\r\n..."}
  │
  │<────────────────────────────────────── 服务端收到
  │
  │  服务端按 consumerId 精确路由 answer
  │
  │<────────────────────────────────────── 前端收到 answer
  │
  │  handleAnswer():
  │    await pc.setRemoteDescription(
  │      new RTCSessionDescription({
  │        type: 'answer',
  │        sdp: msg.sdp
  │      })
  │    )
  │    ★ SDP 协商完成！两端编码参数、传输参数已对齐
```

**ICE 候选并行交换（trickle ICE）：**

```
ICE candidate 的到达顺序不保证。它们可能比 answer 先到或后到。

场景 A：ICE 先到，answer 还没到
  → handleIceCandidate():
      检查 pc.remoteDescription 是否存在
      → 不存在 → 暂不处理，由 handleAnswer() 中批量处理

场景 B：answer 先到，ICE 后到
  → handleIceCandidate():
      pc.remoteDescription 已存在
      → pc.addIceCandidate(new RTCIceCandidate(candidate))
      → ICE agent 尝试验证该候选路径

ICE 连接过程：
  1. 收集 local candidates (host 地址)
  2. 通过 STUN 发现 server reflexive candidates (NAT 映射地址)
  3. 建立连通性检查 (connectivity check)
  4. 选定最优路径 (nominated pair)

  pc.iceConnectionState 变化:
    'checking' → 正在尝试 UDP 连通
    'connected' → 找到可用的候选对，UDP 打洞成功
    (如果打洞失败 → 'failed' → 触发重连)

  pc.connectionState 变化:
    'connecting' → 'connected'
```

**ontrack：远端视频流到达！**

```
pc.ontrack = (event) => {
  if (event.streams[0]) {
    remoteStream.value = event.streams[0]
    //   ↑
    //   shallowRef 赋值，触发 VideoPlayer 模板更新
    //   video :srcObject="remoteStream" → 绑定视频流
  }
}

此时发生的事情：
  1. MediaStream 对象被传递给 <video> 元素
  2. 浏览器解码器启动 (H.264/VP8 硬件或软件解码)
  3. onVideoReady() 回调触发：
     - 记录分辨率 (videoWidth x videoHeight)
     - 启动延时估算 (performance.now() 与 video.currentTime 对比)
     - emit('connected', cameraId)
     - ★ spinner 消失，画面出现！
     - ★ 状态灯变绿 (dot-online)
     - ★ 信息栏显示 "笔记本摄像头  |  150ms  ●"

  cameraStore.updateCameraStatus(cameraId, 'online')
    → 卡片 footer 状态标签: 在线 (绿色)

★ 实时监控开始！延迟通常 < 500ms
```

**总结此时的数据流：**

```
摄像头 ──getUserMedia()──> videoTrack ──addTrack()──> RTCPeerConnection (Producer)
                                                          │
                                                    P2P 加密通道
                                                    (SRTP + DTLS)
                                                          │
浏览器 <video> <── srcObject <── remoteStream <── ontrack <── RTCPeerConnection (Consumer)
                     │
                     │  video.currentTime 持续递增
                     │  rAF 循环每帧更新 latestLatency
                     │
                     ▼
              用户看到实时画面
```

---

### 第四步：用户切换到历史回放

**用户点击 VideoPlayer 顶部的 "历史回放" 按钮（或卡片 info bar 的 "📼 回放" 按钮）。**

```
用户点击 "历史回放"
  │
  │  toggleMode() → emit('mode-change', 'vod')
  │    ↓
  │  WebRTCView.vue 收到事件:
  │    @mode-change="(mode) => onModeChange(cam.cameraId, mode)"
  │      ↓
  │    state.mode = 'vod'              ← 更新 Map 中的状态
  │      ↓
  │    fetchVodUrl(cameraId)            ← 调用 API 获取播放地址
```

**VideoPlayer 内部模式切换：**

```
VideoPlayer.vue
  │
  │  watch(() => props.mode) 检测到变化: 'live' → 'vod'
  │    ↓
  │  switchToVod():
  │
  │    1. stop() WebRTC
  │       ├── sendSignaling({type:'unsubscribe', cameraId})
  │       ├── closePeerConnection()
  │       │   ├── pc.ontrack = null      ← 清除事件回调
  │       │   ├── pc.onicecandidate = null
  │       │   └── pc.close()             ← 关闭 P2P 连接
  │       └── remoteStream.value = null  ← 清空视频流
  │
  │    2. currentMode = 'vod'
  │
  │    3. 传入的 vodPlaylistUrl 尚为空 (等待 API 返回)
  │       → vodState.value = { status: 'error',
  │           error: '未提供 VOD 播放地址' }
  │       → VideoPlayer 显示遮罩等待
```

**同时，API 请求在 WebRTCView 中执行：**

```
fetchVodUrl('notebook-cam')
  │
  │  state.vodLoading = true
  │  ★ VOD 配置面板显示 "获取播放地址..."
  │
  │  const apiUrl =
  │    'http://10.122.147.40:3001/api/vod/notebook-cam' +
  │    '?start=2026-05-30T08:00:00Z' +
  │    '&end=2026-05-30T12:00:00Z'
  │
  │  fetch(apiUrl) ──────────────────────────────────> 服务端 (port 3001)
  │                                                     │
  │                                                     │ 查询该摄像头
  │                                                     │ 该时段的录像
  │                                                     │ 生成 HLS 索引
  │                                                     │
  │<──── { "url": "/recordings/notebook-cam/           │
  │         "2026-05-30/index.m3u8",                   │
  │        "cameraId": "notebook-cam",                 │
  │        "date": "2026-05-30" }                      │
  │
  │  state.vodPlaylistUrl =
  │    'http://10.122.147.40:3001/recordings/' +
  │    'notebook-cam/2026-05-30/index.m3u8'
  │
  │  state.vodLoading = false
  │  ★ "获取播放地址..." 消失
```

**API 返回后，VideoPlayer 收到新的 vodPlaylistUrl prop：**

```
VideoPlayer.vue
  │
  │  watch(() => props.vodPlaylistUrl) 检测到：
  │    空 → 'http://...index.m3u8'
  │    ↓
  │  vodLoad(url) → useVodPlayer.load(url)
  │    ↓
  │  ┌──────────────────────────────────────────┐
  │  │         useVodPlayer.load() 内部          │
  │  │                                          │
  │  │  1. destroy() 清除旧 HLS 实例 (首次为 null) │
  │  │                                          │
  │  │  2. new Hls({                            │
  │  │       enableWorker: true,                │
  │  │       lowLatencyMode: false,             │
  │  │     })                                   │
  │  │                                          │
  │  │  3. hls.loadSource(url)                  │
  │  │     → GET /recordings/.../index.m3u8     │
  │  │     → 解析 m3u8 内容:                     │
  │  │       #EXTM3U                            │
  │  │       #EXT-X-TARGETDURATION:6            │
  │  │       #EXT-X-MEDIA-SEQUENCE:0            │
  │  │       #EXTINF:6.000,                     │
  │  │       seg-0.ts                           │
  │  │       #EXTINF:6.000,                     │
  │  │       seg-1.ts                           │
  │  │       ...                                │
  │  │       #EXT-X-ENDLIST      ← 有这行！      │
  │  │                                          │
  │  │  4. hls.attachMedia(video)               │
  │  │     → 接管 <video> 元素的 src 管理         │
  │  │     → 自动下载 seg-0.ts, seg-1.ts ...     │
  │  │     → 按序送入 MediaSource buffer         │
  │  │                                          │
  │  │  5. MANIFEST_PARSED 事件触发:              │
  │  │     duration = ...  (总时长)              │
  │  │     status = 'paused'                    │
  │  │     autoplay → play()                    │
  │  │       → video.play()                     │
  │  │       → status = 'playing'               │
  │  │       → isPlaying = true                 │
  │  │       → trackTime() rAF 循环启动          │
  │  │       ★ 画面出现！                         │
  │  │       ★ 进度条开始移动                      │
  │  │       ★ 控制栏显示 00:00 / 04:00           │
  │  │                                          │
  │  │  6. LEVEL_LOADED 事件触发:                 │
  │  │     data.details.live === false           │
  │  │     → 检测到 #EXT-X-ENDLIST               │
  │  │     → vodComplete = true                 │
  │  │     → stopLoad() + startLoad(pos)         │
  │  │     → 此后再也不轮询 .m3u8 文件            │
  │  │     → 只按需下载 .ts 分片                  │
  │  └──────────────────────────────────────────┘
  │
  │  ★ 用户看到：视频开始播放，自定义控制栏激活
  │    可以拖拽进度条、切换倍速、调整音量
  │    信息栏显示: "笔记本摄像头  |  01:23 / 04:00  ●"
```

---

### 第五步：用户在 VOD 模式下调整时间范围

**用户修改回放时间，比如把 start 从 08:00 改到 09:00。**

```
用户修改 datetime-local 输入框
  │
  │  @input → s.vodStart = '2026-05-30T09:00'
  │        → scheduleFetchVodUrl(cameraId)
  │          │
  │          │  // 防抖 500ms
  │          │  setTimeout(() => {
  │          │    fetchVodUrl(cameraId)     ← 再次调用 API
  │          │  }, 500)
  │          │
  │          │  500ms 后...
  │          │
  │          │  GET /api/vod/notebook-cam
  │          │    ?start=2026-05-30T09:00:00Z  ← 新的 start
  │          │    &end=2026-05-30T12:00:00Z
  │          │
  │          │  → 新的 url: "/recordings/.../2026-05-30/index.m3u8"
  │          │  → state.vodPlaylistUrl = 新的完整 URL
  │          │
  │          │  ★ VideoPlayer watch(vodPlaylistUrl) 检测到变化
  │          │    → useVodPlayer.load(新URL)
  │          │    → destroy 旧 HLS 实例
  │          │    → new Hls → loadSource → attachMedia → 重新播放
  │          │
  │          │  ★ 用户看到画面跳到新时间段的开始位置
```

---

### 第六步：切换回实时监控

**用户点击 "实时监控" 按钮。**

```
用户点击 "实时监控"
  │
  │  emit('mode-change', 'live')
  │    ↓
  │  state.mode = 'live'
  │    ↓
  │  VideoPlayer watch(mode): 'vod' → 'live'
  │    ↓
  │  switchToLive():
  │    1. destroyVod()
  │       ├── hls.destroy()        ← 销毁 HLS 实例
  │       ├── video.src = ''       ← 清空 src
  │       └── video.load()         ← 重置 video 元素
  │    2. currentMode = 'live'
  │    3. start() WebRTC           ← 重新执行第三步的 WebRTC 流程
  │       ├── subscribe
  │       ├── subscribe-ack
  │       ├── startNegotiation
  │       ├── offer → answer
  │       ├── ICE exchange
  │       └── ontrack → 实时画面恢复
```

---

### 完整时序图（从零到播放）

```
时间线 (不按比例)

T=0ms    用户打开页面
           │
T=200ms   WebSocket 连接建立，发送 get-cameras
           │
T=300ms   收到 camera-list，渲染卡片网格
           │
T=500ms   收到 producer-online，状态灯变绿
           │
T=2s      用户双击卡片
           │
T=2.1s    VideoPlayer mount，发送 subscribe
           │
T=2.2s    收到 subscribe-ack (producerOnline=true)
           │
T=2.3s    创建 RTCPeerConnection，发送 offer
           │
T=2.5s    收到 answer，setRemoteDescription
           │
T=2.6s    ICE candidate 交换
           │
T=2.8s    ICE connected，ontrack 触发
           │
T=2.9s    画面出现！实时播放开始  ← 从双击到画面 ~0.9 秒
           │
           │  ... 用户观看实时画面 ...
           │
T=30s     用户点击 "历史回放"
           │
T=30.0s   WebRTC stop (unsubscribe + close PC)
           │
T=30.1s   fetch /api/vod/notebook-cam?start=...&end=...
           │
T=30.3s   API 返回 { url: "/recordings/.../index.m3u8" }
           │
T=30.4s   HLS.js loadSource + attachMedia
           │
T=30.5s   MANIFEST_PARSED, autoplay
           │
T=30.6s   画面出现！回放开始  ← 从点击到回放画面 ~0.6 秒
           │
T=31.0s   LEVEL_LOADED 检测到 ENDLIST，停止 playlist 轮询
           │
           │  ... 用户拖进度条、改倍速、调时间范围 ...
           │
T=60s     用户点击 "实时监控"
           │
T=60.0s   HLS destroy
           │
T=60.1s   WebRTC start (subscribe → negotiate → connect)
           │
T=60.9s   实时画面恢复
```

---

## 3. 实时监控 — WebRTC 拉流

### 3.1 核心原理

WebRTC (Web Real-Time Communication) 是浏览器原生的 P2P 实时通信协议栈。

```
推流端 (摄像头设备)                  拉流端 (浏览器)
┌──────────────────┐               ┌──────────────────┐
│ getUserMedia()    │               │ RTCPeerConnection │
│   ↓               │               │   ↓               │
│ RTCPeerConnection │               │ addTransceiver   │
│   ↓               │               │   (recvonly)      │
│ addTrack(video)   │               │   ↓               │
│   ↓               │               │ createOffer()    │
│ createAnswer()    │               │   ↓               │
│   ↓               │               │ setLocalDesc()   │
│ setLocalDesc()    │               │   ↓               │
│   ↓               │               │ ontrack → stream │
│ 媒体数据 →→→→→→→→→│───────────────│→ video.srcObject │
│                   │  (P2P直连)    │                  │
└──────────────────┘               └──────────────────┘
          ↕                                  ↕
     信令 WebSocket ◄──────────────────► 信令 WebSocket
    (SDP offer/answer, ICE candidates)
```

### 3.2 信令协议

所有控制面消息通过 **单一 WebSocket 连接** (`/ws/signaling`) 传输，JSON 格式，`type` 字段路由。

**完整消息类型：**

```
推流端 → 服务端:
  publish(cameraId)          注册为摄像头源
  answer(sdp, consumerId)    回复拉流端 SDP
  ice-candidate(candidate)   ICE 候选
  stop-publish              停止推流

拉流端 → 服务端:
  get-cameras               查询摄像头列表
  subscribe(cameraId)       订阅摄像头
  offer(cameraId, sdp)      发起 WebRTC 协商
  ice-candidate(cameraId, candidate)
  unsubscribe(cameraId)     取消订阅

服务端 → 拉流端:
  camera-list(cameras[])            摄像头列表
  subscribe-ack(producerOnline)     订阅确认（含推流端在线状态）
  producer-online(cameraId)        推流端上线通知
  producer-offline(cameraId)       推流端离线通知
  answer(cameraId, sdp)            推流端 Answer
```

**连接建立时序（完整流程）：**

```
Client                         Server                        Producer
  │                               │                              │
  │── WebSocket connect ────────>│                              │
  │<── connected ────────────────│                              │
  │── get-cameras ──────────────>│                              │
  │<── camera-list ──────────────│                              │
  │                               │<── publish(cameraId) ────────│
  │<── producer-online ──────────│                              │
  │                               │                              │
  │── subscribe(cameraId) ──────>│                              │
  │<── subscribe-ack ────────────│                              │
  │   (producerOnline: true)      │                              │
  │                               │                              │
  │  === 开始 WebRTC 协商 ===     │                              │
  │  new RTCPeerConnection()     │                              │
  │  addTransceiver(video,       │                              │
  │    {direction:'recvonly'})   │                              │
  │  createOffer() → setLocal    │                              │
  │                               │                              │
  │── offer(SDP) ───────────────>│── offer(SDP+consumerId) ────>│
  │                               │                              │
  │                               │    Producer:                  │
  │                               │    setRemoteDescription      │
  │                               │    createAnswer()            │
  │                               │    setLocalDescription       │
  │                               │                              │
  │<── answer(SDP+camId) ────────│<── answer(SDP+consumerId) ── │
  │                               │                              │
  │  setRemoteDescription(answer)│                              │
  │                               │                              │
  │  === ICE 候选交换（trickle）===│                              │
  │<── ice-candidate ────────────│<── ice-candidate ──────────── │
  │── ice-candidate ────────────>│── ice-candidate ────────────>│
  │           ...                 │           ...                │
  │                               │                              │
  │═══════════ P2P 媒体流 ═════════════════════════════════════>│
  │           (VP8/H.264)        │                              │
```

### 3.3 useWebRTC Composable

**职责：** 封装单个 `RTCPeerConnection` 的完整生命周期。

**输入：**
```typescript
{
  cameraId: string                        // 摄像头 ID
  signalingConnectionId: string           // 信令 WS 连接 ID，默认 'signaling'
  iceServers: RTCIceServer[]              // ICE 服务器，默认 Google STUN
  maxReconnect: number                    // 最大重连次数，默认 3
}
```

**输出状态（均为 readonly）：**
```typescript
{
  state: WebRTCState          // connectionState, iceConnectionState, signalingState, error
  remoteStream: MediaStream   // 远端视频流（shallowRef 优化大对象响应式开销）
  localAudioStream: MediaStream  // 本地麦克风流（对讲用）
  talking: boolean            // 是否正在对讲
  reconnectAttempts: number   // 当前重连次数
}
```

**核心方法：**

| 方法 | 说明 |
|------|------|
| `start()` | 发送 subscribe → 等待 producer-online → 发起 offer 协商 |
| `stop()` | 发送 unsubscribe → 关闭 PeerConnection → 清除 remoteStream |
| `destroy()` | 置 destroyed 标志 + 调用 stop()，防止重入 |
| `startTalk()` | 获取麦克风 → addTrack(recvonly audio) → renegotiation |
| `stopTalk()` | 停止音频 track → removeTrack → 清理 localAudioStream |

**设计细节：**

1. **Consumer 主动发 Offer**（而非 Producer）：WebRTC 标准推荐接收方发起 offer，可提前声明 `recvonly` transceiver，避免不必要的编码协商。

2. **destroyed 标志防止竞态**：`destroy()` 后所有异步回调（信令消息、ontrack、重连定时器）都检查 `destroyed` 标志，防止在组件卸载后操作已关闭的 PeerConnection。

3. **ICE 重连指数退避**：`delay = min(1000 × 2^attempt, 10_000)` ms，最多 3 次。

4. **shallowRef 优化**：`remoteStream` 使用 `shallowRef` 而非 `ref`，因为 `MediaStream` 是浏览器原生大对象，深层次响应式追踪无意义且开销大。

---

## 4. 历史回放 — HLS 点播

### 4.1 核心原理

HLS (HTTP Live Streaming) 将视频切分为连续的 `.ts` 分片，通过 `.m3u8` 播放列表文件索引。

```
服务端                                     前端
┌──────────────┐                          ┌──────────────┐
│ 录像文件      │                          │ VideoPlayer  │
│   ↓          │                          │   ↓          │
│ 转封装为 HLS  │   ① GET /api/vod/{id}     │ useVodPlayer │
│   ↓          │◄───────────────────────→│   ↓          │
│ .m3u8 + .ts  │   ② GET {url}/index.m3u8  │ hls.js      │
│              │◄────────────────────────→│   ↓          │
│              │   ③ GET {url}/seg-*.ts   │ <video>      │
│              │◄────────────────────────→│              │
└──────────────┘                          └──────────────┘
```

### 4.2 API 调用流程（两步）

**第一步：获取播放地址**

```
GET /api/vod/{cameraId}?start=2026-05-30T08:00:00Z&end=2026-05-30T12:00:00Z

Response:
{
  "url": "/recordings/notebook-cam/2026-05-30/index.m3u8",
  "cameraId": "notebook-cam",
  "date": "2026-05-30"
}
```

**第二步：HLS.js 加载播放**

hls.js 拿到完整 URL 后自动完成 manifest 解析、分片下载、buffer 管理和解码播放。

### 4.3 useVodPlayer Composable

**职责：** 封装 hls.js 生命周期，提供标准视频控制 API。

**设计要点：**

1. **HLS.js + Safari 原生双通道：**
   ```typescript
   if (Hls.isSupported()) {
     new Hls({ enableWorker: true, lowLatencyMode: false })
   } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
     video.src = url  // Safari 原生 HLS
   }
   ```

2. **rAF 时间追踪替代 timeupdate 事件：**
   `timeupdate` 事件在浏览器中约 250ms 触发一次，用 `requestAnimationFrame` 驱动时间更新可使进度条帧率对齐屏幕刷新率（60fps），拖动进度条时体验更丝滑。

3. **#EXT-X-ENDLIST 检测优化：**
   监听 `Hls.Events.LEVEL_LOADED`，当 `details.live === false`（检测到 ENDLIST 标记）时，说明回放已完结，调用 `stopLoad()` + `startLoad(currentTime)` 取消 playlist 轮询计时器，避免不必要的 HTTP 请求。

   | 场景 | ENDLIST | 行为 |
   |------|:--:|------|
   | 已完结录像 | 有 | 加载一次 playlist 后停止轮询 |
   | 录制中（end 接近当前时间） | 无 | 持续轮询以获取新分片 |

4. **fatal error 分级处理：**
   - `networkError`：网络错误，无法加载视频流
   - `mediaError`：媒体解码错误
   - 其他：`HLS 播放错误: {details}`
   - 均自动 destroy 并展示重试按钮

---

## 5. 统一播放器组件 VideoPlayer

### 5.1 设计思路

```
mode='live'  ───→  useWebRTC composable  ───→  video.srcObject = MediaStream
mode='vod'   ───→  useVodPlayer composable  ───→  video (hls.js 接管 src)
```

单一 `<video>` 元素，两种数据通道，通过 `mode` prop 在二者之间切换。

### 5.2 Props 设计

```typescript
{
  cameraId: string             // 摄像头标识
  mode: 'live' | 'vod'         // 播放模式
  vodPlaylistUrl?: string      // HLS 播放列表地址（vod 模式必传）
  vodStart?: string            // 回放开始时间（显示用）
  vodEnd?: string              // 回放结束时间（显示用）
  showControls?: boolean       // 显示控制栏（vod 默认 true）
  muted?: boolean              // 静音
  showModeSwitch?: boolean     // 显示内置模式切换栏
  cameraName?: string          // 设备名称
  iceServers?: RTCIceServer[]  // WebRTC ICE 配置
  autoplay?: boolean           // 自动播放
}
```

### 5.3 模式切换流程

```
switchToVod():
  1. stop() WebRTC          → 发送 unsubscribe + 关闭 PeerConnection
  2. currentMode = 'vod'
  3. vodLoad(playlistUrl)   → 启动 HLS.js

switchToLive():
  1. destroyVod()           → 销毁 HLS 实例 + 清空 video.src
  2. currentMode = 'live'
  3. start() WebRTC         → 发送 subscribe → 等待 producer → 协商
```

关键：切换前**必须先清理旧模式资源**，避免 `<video>` 元素同时被 MediaStream 和 hls.js 争抢。

### 5.4 VOD 控制栏功能

| 控件 | 实现 |
|------|------|
| 播放/暂停 | `video.play()` / `video.pause()` |
| 进度条拖拽 | `mousedown` + document `mousemove` 实时 seek，含 buffer 指示器 |
| 倍速 | `video.playbackRate`，0.5x / 1.0x / 1.5x / 2.0x 循环切换 |
| 音量 | `<input type="range">` + 静音切换 |
| 全屏 | Fullscreen API（`element.requestFullscreen()`） |

---

## 6. WebSocket 信令与连接管理

### 6.1 WebSocketManager 架构

```
WebSocketManager (单例)
  │
  ├── connections: Map<id, WsConnection>
  │     ├── 'signaling'    → 信令连接 (WebRTC SDP/ICE + 摄像头列表)
  │     ├── 'high-freq'    → 高频数据 (设备实时指标, ~100ms)
  │     └── 'low-freq'     → 低频数据 (告警, 状态变更)
  │
  ├── globalMessageListeners: Set<Function>
  │     每个 WsConnection 的消息都派发到所有 global listeners
  │     各 Store/Composable 通过 addGlobalMessageListener 订阅
  │
  └── visibilityHandler
        页面隐藏 → send('pause') + 暂停重连
        页面恢复 → 立即重连断开的连接
```

### 6.2 WsConnection 状态机

```
        connect()
  idle ──────→ connecting ──────→ connected
    ↑              │    ↑              │
    │              ↓    │              │
    │            error ─┘              │
    │              │                   │
    └──────────────┴───────────────────┘
         (destroyed 标志阻止重连)
```

### 6.3 可靠性设计

**心跳保活：**
- 连接建立后，通过 `setInterval` 每 15 秒发送心跳消息 `{"type":"ping"}`
- 检测到 TCP 层面的半开连接（浏览器没有显式 onclose 但实际已断开）

**指数退避重连：**
```
delay = min(baseDelay × 2^attempt, 30_000) ms
attempt=1 →  1s
attempt=2 →  2s
attempt=3 →  4s
...
attempt=10 → 30s (cap)
```

**离线消息队列：**
- 未连接时，`send()` 将消息缓存到 `messageQueue`（默认最大 1000 条）
- 连接恢复后 `flushQueue()` 批量发送

**连接超时：**
- 构造时设置 `timeout`（如 5s），超时未连接则判定失败，触发重连

**全局消息派发：**
- 多个 Store 通过 `addGlobalMessageListener` 订阅同一连接的消息
- try/catch 包裹每个 listener，一个崩溃不影响其他
- `connectionId` 字段区分消息来源

### 6.4 页面可见性处理

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 页面切后台：发送 pause，依赖 TCP 保活
    connections.forEach(c => c.send('pause'))
  } else {
    // 页面恢复：快速重连断开的连接
    connections.forEach(c => {
      if (c.state !== 'connected' && c.state !== 'connecting') c.connect()
    })
  }
})
```

---

## 7. 边界问题与容错设计

### 7.1 网络异常

| 场景 | 处理 |
|------|------|
| WebSocket 断连 | 指数退避重连（最多 10 次），离线消息队列 |
| ICE 连接失败 | `iceConnectionState === 'failed'` 触发 WebRTC 重连（最多 3 次） |
| HLS 网络错误 | fatal → 展示错误信息 + 重试按钮 |
| 信令消息解析失败 | try/catch 忽略非 JSON 消息，不 crash |
| 连接超时 | 5s 超时判定 → 触发重连 |

### 7.2 权限与兼容性

| 场景 | 处理 |
|------|------|
| 浏览器不支持 HLS | 检测 `Hls.isSupported()` → 降级 Safari 原生 → 兜底错误提示 |
| 摄像头权限拒绝 | `useCameraPermission` 捕获 `DOMException` 并映射中文提示 |
| 麦克风权限拒绝 | `startTalk()` 返回 false，不 crash |
| autoplay 被阻止 | 浏览器策略下 `video.play()` 返回 rejected Promise → 设置 paused 状态 |

### 7.3 并发与资源

| 场景 | 处理 |
|------|------|
| 超过最大并发路数 | `cameraStore.registerPlayer()` 返回 false → 拒绝播放 + 提示 |
| 最大并发已满新增播放 | 自动关闭最早播放的摄像头（LRU 淘汰） |
| 组件卸载 | `onUnmounted` 中 destroy WebRTC / destroy HLS + unregister store |
| 摄像头 ID 变化 | `watch(cameraId)` → 先清理旧连接，再建立新连接 |
| 重复 destroy | `destroyed` 标志位防重入 |

### 7.4 模式切换

| 场景 | 处理 |
|------|------|
| live → vod | stop WebRTC (close PC + unsub) → 清 video srcObject → vodLoad(url) |
| vod → live | destroy HLS (destroy hls.js + 清 video.src) → start WebRTC |
| 模式切换时 VOD URL 为空 | 展示 "未提供 VOD 播放地址" 错误 |
| 快速连续切换 | `currentMode` 变量记录当前模式，避免同模式重复初始化 |
| VOD URL 变化 | watch(playlistUrl) 自动 reload HLS 流 |

### 7.5 视频播放

| 场景 | 处理 |
|------|------|
| 视频 ended | VOD：设置 `status: 'ended'`，展示 "回放已结束" 遮罩 |
| 直播视频卡顿 | ICE failed → 自动重连 |
| Seek 超范围 | `seek()` 中 `Math.max(0, Math.min(time, duration))` 钳位 |
| 进度条快速拖拽 | mousedown 绑定 document mousemove/mouseup，松手才最终定位 |
| 直播静音 | 默认 muted=true 避免啸叫（回声消除在浏览器层处理） |
| VOD 时间变化 | 防抖 500ms 调用 API 获取新的播放地址 |

### 7.6 视频-数据时间戳同步

`VideoSyncManager` 使用简化的 NTP 算法：

```
1. 校准阶段：发送请求 → 记录 sendTime
2. 收到服务器时间 serverTime → 记录 recvTime
3. RTT = recvTime - sendTime
4. 估算 offset = serverTime - (sendTime + RTT/2)
5. 采集 20 个样本，取中位数作为稳定偏移量
6. 播放阶段：absoluteTime = playStartServerTime + video.currentTime × 1000
7. rAF 循环持续输出同步点
```

校准点缓冲：最近 300 帧的 `<videoTimestamp, serverTimestamp, deviceMetrics>` 三元组，可按任意设备时间戳查找最近一帧视频画面。

---

## 8. 性能优化

| 维度 | 方案 |
|------|------|
| MediaStream 响应式 | `shallowRef` 避免深层 Proxy 追踪 |
| VOD 时间更新 | `rAF` 替代 `timeupdate` 事件（60fps vs ~4fps） |
| ICE 重连 | 指数退避，避免洪水重连 |
| 并发控制 | 最多 4 路，超出自动淘汰最早一路 |
| 内存泄漏防护 | onUnmounted 完整清理：PC.close() + stream.getTracks().stop() + hls.destroy() + ws listener unsub |
| HLS Worker | `enableWorker: true` 将转封装放入 Web Worker |
| VOD playlist 轮询优化 | 检测 ENDLIST 后停止 playlist 刷新，只保留分片加载 |
| 多连接管理 | 单一 WebSocketManager 单例，连接复用 |

---

## 9. 面试重点

### 9.1 WebRTC 相关

**Q: 为什么拉流端发起 Offer 而不是推流端？**

WebRTC 标准推荐**接收方**发起 offer。拉流端通过 `addTransceiver('video', { direction: 'recvonly' })` 提前声明"我只接收不发送"，服务端据此跳过不必要的编码协商。如果推流端发 offer，它不知道自己是否需要发送视频（可能在多拉流端场景下其中一个只需要音频）。

**Q: ICE candidate 和 SDP answer 的到达顺序为什么不保证？**

ICE (Interactive Connectivity Establishment) 的 candidate gathering 与 SDP 协商是**异步并行**的。Trickle ICE 模式下，candidate 一旦发现就立即发送，而 SDP answer 需要推流端完成 `createAnswer()` + `setLocalDescription()` 的完整流程。因此 ICE candidate 完全可能在 answer 之前到达。前端实现中必须缓存早到的 candidate，等 `setRemoteDescription` 完成后批量 `addIceCandidate`。

**Q: 多路播放时并发控制怎么做？**

通过 Pinia `cameraStore` 维护 `activePlayers: Set<cameraId>` 和 `maxConcurrent` 上限（默认 4 路）。每次播放前调用 `registerPlayer(id)` 检查是否超限，超限则拒绝并提示。当新播放请求到来而池已满时，按 FIFO 淘汰最早加入的摄像头。核心考量：浏览器对并发 PeerConnection 有限制（~256 个），但 4 路是考虑到 CPU 解码能力和网络带宽的保守值。

### 9.2 HLS 相关

**Q: hls.js 和 video.js 选型依据？**

video.js 是播放器框架（自带 UI），hls.js 是 HLS 协议实现（纯 JS 库）。

- 如果需要一个完整的播放器 UI（皮肤、控制栏、广告插件），选 video.js
- 如果需要自定义控制栏样式、自定义交互逻辑，选 hls.js + 手写 UI

本项目选择了 hls.js + 自定义控制栏，因为：控制栏 UI 需要与项目暗色主题统一，功能只需基础的播放/暂停/进度/倍速/音量，hls.js 体积更小且 API 更简洁。

**Q: HLS 延迟为什么比 WebRTC 高？**

HLS 延迟来自三个因素：
1. **分片延迟**：服务端需要累积一段视频才能生成一个 .ts 分片（通常 2~6 秒）
2. **播放列表延迟**：客户端通过轮询 .m3u8 发现新分片（通常 1 个分片时长）
3. **缓冲区延迟**：客户端维护 3 个分片的播放缓冲区以平滑播放

三项加总通常 10~30 秒。WebRTC 是实时 P2P 传输无分片机制，延迟 < 1 秒。

**Q: #EXT-X-ENDLIST 是什么？为什么要检测它？**

`#EXT-X-ENDLIST` 是 HLS playlist 中的一个标记，表示"此播放列表之后不会再添加新分片"——即直播/录制已结束。

在已完结的 VOD 场景下，playlist 内容不会再变化，继续轮询 .m3u8 文件是无意义的 HTTP 开销。前端在 `LEVEL_LOADED` 事件中检查 `details.live` 字段（hls.js 解析 ENDLIST 后设置为 false），检测到后通过 `stopLoad()` + `startLoad(currentTime)` 取消轮询计时器，同时保持分片加载能力以支持 seek。

对于录制仍在进行中的回放（end 时间接近当前时间），playlist 不含 ENDLIST，此时必须持续轮询以发现新生成的分片。

### 9.3 WebSocket 相关

**Q: 为什么所有信令走一个 WebSocket 连接，而不是每个摄像头一个连接？**

1. **减少连接数**：N 个摄像头就需要 N 个 WebSocket 连接，浏览器对同一域名的并发连接有限制（~6 个）
2. **统一心跳**：一个连接一个心跳定时器 vs N 个，CPU 和网络开销差异明显
3. **消息路由简单**：JSON 中 `cameraId` 字段即可区分消息归属，无需连接级别的隔离
4. **重连逻辑统一**：断线重连只需处理一个连接，避免 N 个连接各自退避导致"重连风暴"

**Q: 离线消息队列有什么用？**

WebSocket 断开期间可能有消息需要发送（如取消订阅）。队列将这些消息缓存，连接恢复后自动批量发送。设置上限（1000 条）防止内存无限增长。

**Q: 为什么不在 `onerror` 里处理重连？**

`onerror` 和 `onclose` 几乎总是成对出现（error 后紧随 close）。如果在 `onerror` 中触发重连，`onclose` 又会触发一次，造成**重复重连**。正确的做法是只在 `onclose` 中处理，`onerror` 仅做日志记录。

### 9.4 架构相关

**Q: useWebRTC 为什么用 shallowRef 存 MediaStream？**

`MediaStream` 是浏览器原生对象，包含大量内部属性和方法。如果用 `ref()`，Vue 3 的响应式系统会递归地将它转换为 Proxy，这是无意义且昂贵的操作——我们只需要知道 stream 对象是否被替换（`.value = newStream`），不关心它内部属性的变化。`shallowRef` 只追踪 `.value` 的替换，恰好满足需求。

**Q: 模式切换时为什么要先清理旧模式再启动新模式？**

`<video>` 元素同时只能有一种数据源。如果不清除 `video.srcObject`（MediaStream）就直接用 hls.js 接管，hls.js 设置的 `src` 可能被 `srcObject` 覆盖，导致播放异常。反之亦然。

**Q: destroyed 标志的作用？**

WebRTC 和 HLS 都有大量异步操作（信令回调、ontrack 事件、重连定时器、ICE candidate 缓存处理）。组件卸载时调用 `destroy()`，如果后续异步回调触发，`destroyed` 标志阻止它们操作已关闭的 PeerConnection 或已销毁的 HLS 实例，避免 `InvalidStateError`。
