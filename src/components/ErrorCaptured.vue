<template>
  <div class="error-captured">
    <!-- 正常状态：渲染子组件 -->
    <template v-if="!hasError">
      <slot />
    </template>

    <!-- 错误状态：显示降级 UI -->
    <div v-else class="error-captured__fallback">
      <div class="error-captured__fallback-icon">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p class="error-captured__fallback-title">
        {{ title }}
      </p>
      <p v-if="showDetail && errorMessage" class="error-captured__fallback-detail">
        {{ errorMessage }}
      </p>
      <div class="error-captured__fallback-actions">
        <el-button v-if="retryable" type="primary" size="small" @click="handleRetry">
          重试
        </el-button>
        <el-button
          v-if="showDetail"
          size="small"
          @click="detailVisible = !detailVisible"
        >
          {{ detailVisible ? '收起' : '查看详情' }}
        </el-button>
      </div>
      <div v-if="detailVisible" class="error-captured__fallback-stack">
        <pre>{{ errorStack }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'

// ── Props ──────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    /** 错误时展示的标题 */
    title?: string
    /** 是否允许用户点击重试 */
    retryable?: boolean
    /** 是否展示错误详情（生产环境可关闭） */
    showDetail?: boolean
  }>(),
  {
    title: '组件加载异常',
    retryable: true,
    showDetail: true,
  },
)

const emit = defineEmits<{
  (e: 'error', payload: { error: unknown; instance: unknown; info: string }): void
  (e: 'retry'): void
}>()

// ── State ──────────────────────────────────────────────
const hasError = ref(false)
const errorMessage = ref('')
const errorStack = ref('')
const detailVisible = ref(false)

// ── 重置错误状态（用于重试） ──────────────────────────
function reset(): void {
  hasError.value = false
  errorMessage.value = ''
  errorStack.value = ''
  detailVisible.value = false
}

function handleRetry(): void {
  reset()
  emit('retry')
}

// ── 核心：捕获子组件树中的错误 ─────────────────────────
// 返回 false 阻止错误继续向上传播，避免页面级崩溃
onErrorCaptured((err: unknown, instance: unknown, info: string): false => {
  hasError.value = true

  // 提取错误信息
  if (err instanceof Error) {
    errorMessage.value = err.message
    errorStack.value = err.stack ?? ''
  } else if (typeof err === 'string') {
    errorMessage.value = err
    errorStack.value = ''
  } else {
    try {
      errorMessage.value = JSON.stringify(err)
    } catch {
      errorMessage.value = '未知错误'
    }
    errorStack.value = ''
  }

  // 开发环境打印完整错误，便于定位
  console.error('[ErrorCaptured] 捕获到子组件错误:', err)
  console.error('[ErrorCaptured] 错误来源:', info)

  emit('error', { error: err, instance, info })

  // 返回 false → 阻止错误继续向上冒泡，保护上层页面
  return false
})

// 暴露 reset 方法给父组件，以便外部也能触发重试
defineExpose({ reset, hasError })
</script>

<style scoped lang="less">
.error-captured {
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;

  &__fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 120px;
    padding: 24px;
    box-sizing: border-box;
    background: #fafafa;
    border: 1px dashed #dcdfe6;
    border-radius: 6px;

    &-icon {
      color: #c0c4cc;
      margin-bottom: 12px;
    }

    &-title {
      margin: 0 0 8px;
      font-size: 14px;
      color: #606266;
      font-weight: 500;
    }

    &-detail {
      margin: 0 0 16px;
      font-size: 12px;
      color: #909399;
      max-width: 400px;
      text-align: center;
      word-break: break-all;
    }

    &-actions {
      display: flex;
      gap: 8px;
    }

    &-stack {
      margin-top: 16px;
      width: 100%;
      max-width: 600px;
      max-height: 200px;
      overflow: auto;

      pre {
        margin: 0;
        padding: 12px;
        font-size: 11px;
        line-height: 1.5;
        color: #f56c6c;
        background: #fef0f0;
        border-radius: 4px;
        white-space: pre-wrap;
        word-break: break-all;
      }
    }
  }
}
</style>
