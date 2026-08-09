import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DashboardTheme } from '@/types/dashboard'

export const useLayoutStore = defineStore('layout', () => {
  const theme = ref<DashboardTheme>('dark')
  const isFullscreen = ref(false)
  const selectedDeviceId = ref<string | null>(null)

  function setTheme(t: DashboardTheme): void {
    theme.value = t
  }

  function toggleFullscreen(): void {
    if (!isFullscreen.value) {
      document.documentElement.requestFullscreen?.()
      isFullscreen.value = true
    } else {
      document.exitFullscreen?.()
      isFullscreen.value = false
    }
  }

  function selectDevice(deviceId: string | null): void {
    selectedDeviceId.value = deviceId
  }

  function $reset(): void {
    theme.value = 'dark'
    isFullscreen.value = false
    selectedDeviceId.value = null
  }

  return {
    theme,
    isFullscreen,
    selectedDeviceId,
    setTheme,
    toggleFullscreen,
    selectDevice,
    $reset,
  }
})
