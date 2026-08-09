import { ref, readonly } from 'vue'
import type { PermissionState } from '@/types/dashboard'

/**
 * 摄像头 / 麦克风权限管理 composable
 *
 * 职责：
 * - 查询当前浏览器权限状态（camera / microphone）
 * - 按需触发 getUserMedia 以请求权限
 * - 提供权限未授予时的提示信息与重试入口
 */
export function useCameraPermission() {
  const permission = ref<PermissionState>({ camera: null, microphone: null })
  const requesting = ref(false)
  const error = ref<string | null>(null)

  // ---------- 查询权限 ----------
  async function queryPermission(name: 'camera' | 'microphone'): Promise<PermissionStatus | null> {
    // 部分浏览器不支持 navigator.permissions.query({ name: 'camera' })
    if (!navigator.permissions?.query) return null
    try {
      return await navigator.permissions.query({ name: name as PermissionName })
    } catch {
      return null
    }
  }

  async function checkPermissions(): Promise<void> {
    const [camera, microphone] = await Promise.all([
      queryPermission('camera'),
      queryPermission('microphone'),
    ])
    permission.value = { camera, microphone }
  }

  // ---------- 请求权限 ----------
  async function requestCamera(): Promise<MediaStream | null> {
    requesting.value = true
    error.value = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      // 立即停止，仅用于获取权限状态
      stream.getTracks().forEach((t) => t.stop())
      await checkPermissions()
      return stream
    } catch (e) {
      const msg = e instanceof DOMException ? mapDOMError(e) : '未知错误'
      error.value = msg
      return null
    } finally {
      requesting.value = false
    }
  }

  async function requestMicrophone(): Promise<MediaStream | null> {
    requesting.value = true
    error.value = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      await checkPermissions()
      return stream
    } catch (e) {
      const msg = e instanceof DOMException ? mapDOMError(e) : '未知错误'
      error.value = msg
      return null
    } finally {
      requesting.value = false
    }
  }

  /** 请求麦克风权限并保持流处于活跃状态（对讲场景） */
  async function acquireMicrophoneStream(): Promise<MediaStream | null> {
    requesting.value = true
    error.value = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      await checkPermissions()
      return stream
    } catch (e) {
      const msg = e instanceof DOMException ? mapDOMError(e) : '未知错误'
      error.value = msg
      return null
    } finally {
      requesting.value = false
    }
  }

  function clearError(): void {
    error.value = null
  }

  // ---------- 初始化 ----------
  if (typeof navigator !== 'undefined') {
    checkPermissions()
  }

  return {
    permission: readonly(permission),
    requesting: readonly(requesting),
    error: readonly(error),
    checkPermissions,
    requestCamera,
    requestMicrophone,
    acquireMicrophoneStream,
    clearError,
  }
}

/** 将 getUserMedia 的 DOMException 映射为用户可读的中文提示 */
function mapDOMError(e: DOMException): string {
  switch (e.name) {
    case 'NotAllowedError':
      return '权限被拒绝，请在浏览器设置中允许摄像头/麦克风访问'
    case 'NotFoundError':
      return '未检测到摄像头或麦克风设备'
    case 'NotReadableError':
      return '设备被其他应用占用，请关闭其他使用摄像头的程序'
    case 'OverconstrainedError':
      return '不满足指定的采集参数'
    case 'SecurityError':
      return '非安全上下文（需要 HTTPS 或 localhost）'
    default:
      return `采集失败: ${e.message}`
  }
}
