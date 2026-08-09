<template>
  <ChartBox
    title="实时告警"
    :subtitle="`${store.unacknowledgedCount} 条未确认`"
  >
    <div class="alarm-list">
      <div class="alarm-list__scroll" ref="scrollRef" @scroll="onScroll">
        <div
          v-for="alarm in visibleAlarms"
          :key="alarm.id"
          class="alarm-list__item"
          :class="`alarm-list__item--${alarm.level}`"
          @click="store.acknowledge(alarm.id)"
        >
          <span class="alarm-list__time">{{ formatTime(alarm.timestamp) }}</span>
          <span class="alarm-list__device">{{ alarm.deviceName }}</span>
          <span class="alarm-list__message">{{ alarm.message }}</span>
        </div>
      </div>
    </div>
  </ChartBox>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAlarmStore } from '@/stores/alarmStore'
import { formatTime } from '@/utils/dashboard'
import { useScreenScale } from '@/utils/useScreenScale'
import ChartBox from '@/components/ChartBox.vue'

const store = useAlarmStore()
const scrollRef = ref<HTMLElement | null>(null)
const { scale } = useScreenScale()

const visibleStart = ref(0)
const visibleCount = ref(30)
const BASE_ITEM_HEIGHT = 36
const ITEM_HEIGHT = computed(() => BASE_ITEM_HEIGHT * scale.value)

const visibleAlarms = computed(() => {
  return store.filteredAlarms.slice(
    visibleStart.value,
    visibleStart.value + visibleCount.value,
  )
})

function onScroll(): void {
  if (!scrollRef.value) return
  const scrollTop = scrollRef.value.scrollTop
  visibleStart.value = Math.floor(scrollTop / ITEM_HEIGHT.value)
  visibleCount.value = Math.ceil(scrollRef.value.clientHeight / ITEM_HEIGHT.value) + 2
}
</script>

<style scoped lang="less">
@import '@/styles/dashboard.less';
</style>
