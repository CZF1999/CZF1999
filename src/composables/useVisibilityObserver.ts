import { ref, onMounted, onUnmounted, type Ref } from 'vue';

/**
 * 视口可见性监听配置接口
 */
interface VisibilityObserverOptions {
  /**
   * 根元素的外边距，用于扩展或收缩交叉区域
   * 格式与 CSS margin 相同：'0px' | '10px 20px' | '10px 20px 30px 40px'
   * @default '0px'
   */
  rootMargin?: string;

  /**
   * 触发可见性回调的阈值（0-1之间）
   * 0 表示元素刚进入视口时触发
   * 1 表示元素完全进入视口时触发
   * @default 0
   */
  threshold?: number;
}

/**
 * 视口可见性监听组合式函数
 *
 * 用于监听目标元素是否进入视口，适用于懒加载、无限滚动等场景
 *
 * @param targetRef - 目标元素的模板引用
 * @param options - 可选配置项
 * @returns isVisible - 响应式的可见性状态
 *
 * @example
 * ```ts
 * import { ref } from 'vue';
 * import { useVisibilityObserver } from '@/composables/useVisibilityObserver';
 *
 * const targetRef = ref<HTMLElement | null>(null);
 * const { isVisible } = useVisibilityObserver(targetRef, {
 *   rootMargin: '200px',
 *   threshold: 0
 * });
 * ```
 */
export function useVisibilityObserver(
  targetRef: Ref<HTMLElement | null>,
  options: VisibilityObserverOptions = {}
): { isVisible: Ref<boolean> } {
  const { rootMargin = '0px', threshold = 0 } = options;

  // 可见性状态
  const isVisible = ref<boolean>(false);

  // IntersectionObserver 实例
  let observer: IntersectionObserver | null = null;

  /**
   * 检查浏览器是否支持 IntersectionObserver
   */
  const isSupported = typeof window !== 'undefined' && 'IntersectionObserver' in window;

  /**
   * 创建并启动观察者
   */
  const startObserving = () => {
    // 降级处理：如果浏览器不支持 IntersectionObserver，直接设置为可见
    if (!isSupported) {
      isVisible.value = true;
      return;
    }

    // 如果已经有观察者实例，先断开
    if (observer) {
      observer.disconnect();
    }

    // 创建新的观察者实例
    observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        entries.forEach((entry: IntersectionObserverEntry) => {
          if (entry.isIntersecting) {
            // 元素进入视口，设置为可见
            isVisible.value = true;

            // 停止观察该元素（只触发一次）
            if (observer && targetRef.value) {
              observer.unobserve(targetRef.value);
            }
          }
        });
      },
      {
        root: null, // 使用视口作为根元素
        rootMargin,
        threshold,
      }
    );

    // 开始观察目标元素
    if (targetRef.value) {
      observer.observe(targetRef.value);
    }
  };

  /**
   * 停止观察
   */
  const stopObserving = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  // 组件挂载时开始观察
  onMounted(() => {
    startObserving();
  });

  // 组件卸载时清理观察者
  onUnmounted(() => {
    stopObserving();
  });

  return {
    isVisible,
  };
}
