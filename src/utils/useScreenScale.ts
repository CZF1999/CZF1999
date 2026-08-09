import { ref } from 'vue'

/** 设计稿基准尺寸 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

/** 基准 font-size：1rem = 16px @1920×1080 */
const BASE_FONT_SIZE = 16

/** 模块级单例 —— 所有组件共享同一个 scale ref，resize 监听器只注册一次 */
const scale = ref(1)
let initialized = false

function updateScale() {
  const wRatio = window.innerWidth / DESIGN_WIDTH
  const hRatio = window.innerHeight / DESIGN_HEIGHT
  // 取宽高缩放比的较小者，确保内容始终完整可见（不溢出）
  scale.value = Math.min(wRatio, hRatio)
  // scale.value = 1
  document.documentElement.style.fontSize = `${BASE_FONT_SIZE * scale.value}px`
}

export function useScreenScale() {
  if (!initialized) {
    initialized = true
    updateScale()
    window.addEventListener('resize', updateScale)
  }
  return { scale }
}
