# WebRTC 实时监控系统 — 技术方案

## 一、系统架构

```
┌──────────────────┐      信令 (WebSocket)       ┌──────────────────┐
│   推流端 (Producer)  │ ◄──────────────────────► │   Node.js 服务端    │
│  浏览器 getUserMedia  │   offer/answer/ICE        │  Express + ws     │
│  camera-pusher.html  │                           │  port 3001        │
└──────────────────┘                               └────────┬─────────┘
                                                            │
                                                   信令 (WebSocket)
                                                    offer/answer/ICE
                                                            │
                                                  ┌─────────┴─────────┐
                                                  │   拉流端 (Consumer)  │
                                                  │   Vue 3 前端大屏     │
                                                  │   WebRTCView.vue    │
                                                  │   useWebRTC compos. │
                                                  └────────────────────┘
                                                            │
                                                    WebRTC P2P 媒体流
                                                    (VP8/H.264 + Opus)
```

| 角色 | 技术栈 | 职责 |
|------|--------|------|
| 推流端 | 原生 WebRTC API + getUserMedia | 采集摄像头/麦克风，发布 SDP |
| 服务端 | Node.js + Express + ws | 信令中继，Publisher/Consumer 配对 |
| 拉流端 | Vue 3 + TypeScript + Pinia | 展示摄像头列表，播放视频流 |

## 二、信令协议设计

### 消息格式

所有信令消息通过单一 WebSocket 端点 `/ws/signaling` 传输，JSON 格式，通过 `type` 字段分发。

```
推流端 → 服务端:
  { type: 'publish', cameraId }                   // 注册为摄像头源
  { type: 'answer', sdp, consumerId }              // 回复拉流端的 SDP Answer
  { type: 'ice-candidate', candidate, consumerId } // ICE 候选

拉流端 → 服务端:
  { type: 'get-cameras' }                          // 查询可用摄像头列表
  { type: 'subscribe', cameraId }                  // 订阅指定摄像头
  { type: 'offer', cameraId, sdp }                 // 发起 WebRTC 协商
  { type: 'ice-candidate', candidate }             // ICE 候选
  { type: 'unsubscribe', cameraId }                // 取消订阅

服务端 → 拉流端:
  { type: 'camera-list', cameras: [...] }          // 摄像头列表
  { type: 'subscribe-ack', cameraId, producerOnline } // 订阅确认
  { type: 'producer-online', cameraId }            // 推流端上线通知
  { type: 'producer-offline', cameraId }           // 推流端离线通知
  { type: 'answer', cameraId, sdp }                // 推流端 SDP Answer
  { type: 'ice-candidate', candidate }             // ICE 候选
```

### 连接建立时序

```
推流端                        服务端                        拉流端
  │                             │                             │
  │── publish(cameraId) ──────>│                             │
  │<── published ──────────────│                             │
  │                             │<── get-cameras ─────────── │
  │                             │── camera-list ────────────>│
  │                             │<── subscribe(cameraId) ─── │
  │                             │── subscribe-ack ──────────>│
  │                             │    (producerOnline: true)   │
  │                             │<── offer(SDP) ──────────── │
  │<── offer(SDP+consumerId) ──│                             │
  │                             │                             │
  │  RTCPeerConnection          │                             │  RTCPeerConnection
  │  addTrack(localStream)      │                             │  addTransceiver(recvonly)
  │  createAnswer()             │                             │  createOffer()
  │                             │                             │
  │── answer(SDP+consumerId) ─>│                             │
  │                             │── answer(SDP) ────────────>│
  │                             │                             │
  │<── ice-candidate ──────────│── ice-candidate ───────────>│
  │         ...                 │         ...                 │
  │                                                           │
  │═══════════════════ WebRTC P2P Media ════════════════════>│
  │                   (VP8/H.264 + Opus)                      │
```

### 关键设计决策

**推流端等 offer，拉流端发 offer**
- 标准 WebRTC 中由接收方（Consumer）发起 offer
- 推流端（Producer）注册后处于等待状态，收到 offer 后创建 answer
- 推流端通过 `consumerId` 区分不同拉流端，每个拉流端独立的 PeerConnection

**心跳保活**
- 推流端每 15 秒发送 `{ type: 'ping' }`，防止 30 秒超时断开
- 拉流端连接配置 `heartbeatMessage: '{"type":"ping"}'`

**ICE 缓存**
- ICE candidate 可能在 answer 之前到达
- 拉流端缓存早到的 ICE，等 `setRemoteDescription` 完成后批量处理

## 三、服务端核心实现

### 数据结构

```javascript
// 摄像头注册表：cameraId → Producer 连接 + Consumer 集合
const cameras = {
  'notebook-cam': {
    producer: WebSocket,          // 推流端 ws 对象
    consumers: Set<WebSocket>,    // 所有拉流端 ws
  }
};
```

### 消息路由

```javascript
wss.on('connection', (ws) => {
  const connId = genConnId();

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.type) {
      case 'publish':     // 推流端注册 → 通知已有拉流端
      case 'subscribe':   // 拉流端订阅 → 返回推流端状态
      case 'get-cameras': // 查询摄像头列表
      case 'offer':       // 拉流端 → 推流端（含 consumerId）
      case 'answer':      // 推流端 → 指定拉流端（按 consumerId 精确路由）
      case 'ice-candidate': // 双向中继（producer→broadcast, consumer→unicast）
      case 'unsubscribe': // 取消订阅
      case 'stop-publish': // 停止推流 → 通知所有拉流端
    }
  });

  ws.on('close', () => {
    // 清理：推流端断开通知拉流端，拉流端断开移除订阅
  });
});
```

### 连接管理

```
publish:
  → cameras[id].producer = ws
  → ws.isProducer = true, ws.cameraId = id
  → 通知已有 consumers: { type: 'producer-online' }

subscribe:
  → cameras[id].consumers.add(ws)
  → ws.isConsumer = true, ws.cameraId = id
  → 回复 { type: 'subscribe-ack', producerOnline: !!producer }

offer (consumer → producer):
  → ws.cameraId 查找 cameras[id].producer
  → 转发 offer + consumerId

answer (producer → consumer):
  → 按 msg.consumerId 精确匹配目标 consumer
  → 单播 answer 给该 consumer

ICE:
  → producer → 广播所有 consumers
  → consumer → 单播 producer（附 consumerId）
```

## 四、前端架构（Vue 3）

### 分层设计

```
视图层 (View)
  WebRTCView.vue          ← 摄像头列表、播放管理
    └─ WebRTCPlayer.vue   ← 单路视频播放器（遮罩、对讲、全屏）

数据层 (Store)
  cameraStore.ts           ← 摄像头列表、播放状态、并发控制

逻辑层 (Composable)
  useWebRTC.ts             ← RTCPeerConnection 生命周期管理
    ├─ createOffer/Answer  ← SDP 协商
    ├─ ICE 候选交换         ← NAT 穿透
    ├─ 自动重连             ← 指数退避 (1s→2s→4s→...→10s, 最多 3 次)
    └─ 对讲 (sendonly audio) ← 本地麦克风采集 + renegotiation

服务层 (Service)
  WebSocketManager.ts      ← 单例连接池，多端点管理
    ├─ 心跳保活
    ├─ 指数退避重连 (最多 10 次)
    └─ 多监听器派发

类型层 (Type)
  dashboard.ts             ← CameraInfo, SignalingMessage, WebRTCState
```

### useWebRTC 核心逻辑

```typescript
// 1. 订阅 → 等待推流端
async function start() {
  sendSignaling({ type: 'subscribe', cameraId });
  // 等待 subscribe-ack 或 producer-online
}

// 2. 推流端在线 → 发起 WebRTC 协商
async function startNegotiation() {
  const pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (e) => remoteStream.value = e.streams[0];

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignaling({ type: 'offer', cameraId, sdp: offer.sdp });
}

// 3. 接收 Answer
async function handleAnswer(msg) {
  await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
}

// 4. ICE 交换（缓存早到的 candidate）
function handleIceCandidate(msg) {
  if (pc.remoteDescription) {
    pc.addIceCandidate(msg.candidate);
  } else {
    iceQueue.push(msg.candidate); // 等 answer 后批量处理
  }
}
```

### 状态管理

```typescript
// cameraStore.ts
{
  cameras: Map<cameraId, CameraInfo>  // 所有摄像头
  activePlayers: Set<cameraId>        // 正在播放的摄像头
  maxConcurrent: 4                    // 最大并发路数

  setCameras(list)                    // 更新摄像头列表
  registerPlayer(id) → boolean        // 注册播放（检查并发上限）
  unregisterPlayer(id)                // 注销播放
  updateCameraStatus(id, status)      // 实时更新在线状态
}
```

## 五、性能与可靠性

| 维度 | 方案 |
|------|------|
| P2P 连接 | WebRTC 直连，STUN 穿透 NAT（Google STUN） |
| 弱网重连 | ICE 失败自动重连，指数退避 1s→10s，最多 3 次 |
| 信令重连 | WebSocket 断线指数退避重连，最多 10 次 |
| 心跳保活 | 15s 间隔 ping，30s 超时断开 |
| 多路播放 | 并发限制 4 路，超出自动关闭最早一路 |
| 内存管理 | onUnmounted 清理 PC + Stream + Listener，防止泄漏 |
| 连接安全 | 信令消息 try/catch 隔离，单 listener 崩溃不影响其他 |

## 六、开发环境模拟方案

### 笔记本推流（camera-pusher.html）

```
1. 笔记本打开 camera-pusher.html（需 localhost 以获取摄像头权限）
2. 输入摄像头 ID → 点击"开始推流"
3. getUserMedia → 建立信令 WS → 注册为 Producer
4. 等待拉流端 offer → 创建 answer → 推送媒体流
```

### 多路模拟

- 笔记本打开多个标签页，使用不同 cameraId
- 或使用 camera-simulator.html（支持动态输入 cameraId）
- 服务端每个 cameraId 独立管理 Producer/Consumers

## 七、关键技术点（面试可展开）

1. **为什么推流端等 offer 而不是主动创建？** — WebRTC 标准：接收方创建 offer，可提前声明 recvonly transceiver，避免不必要的编码协商

2. **为什么 answer 按 consumerId 精确路由而不是广播？** — 每个 consumer 有独立 PeerConnection，SDP 包含 ICE 凭据和编解码参数，不能跨连接使用

3. **ICE candidate 为什么可能比 answer 先到？** — ICE gathering 与 SDP 协商是并行的，trickle ICE 模式下 candidate 可能先于 remote description 到达

4. **为什么信令用单一 WebSocket 连接而不是每个摄像头一个连接？** — 减少连接数开销，统一心跳管理，消息通过 cameraId 字段区分

5. **对讲功能如何实现？** — Consumer 端 `getUserMedia(audio)` → `pc.addTrack(audioTrack)` → renegotiation（重新 createOffer/setLocalDescription） → Producer 端接收音频轨道
