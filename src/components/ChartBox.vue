<template>
  <div class="chart-box">
    <div class="chart-box__header">
      <span class="chart-box__header-title">{{ title }}</span>
      <span class="chart-box__header-extra">
        <slot name="header-extra" />
        {{ subtitle }}
      </span>
    </div>
    <div class="chart-box__body">
      <div v-if="keepAspectRatio" class="chart-box__aspect-ratio">
        <div class="chart-box__aspect-inner">
          <slot />
        </div>
      </div>
      <slot v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  subtitle?: string
  keepAspectRatio?: boolean
}>(), {
  subtitle: undefined,
  keepAspectRatio: false,
})
</script>

<style scoped lang="less">
@import '@/styles/dashboard.less';

.chart-box {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border: @border-width solid @panel-border;
  border-radius: @border-radius;
  background: @panel-bg;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: @gap-sm @gap-md;
    background: @panel-header-bg;
    border-bottom: 1px solid rgba(30, 144, 255, 0.15);
    flex-shrink: 0;

    &-title {
      color: @text-accent;
      font-size: @font-md;
      font-weight: 600;
      letter-spacing: 1px;
      white-space: nowrap;
    }

    &-extra {
      color: @text-secondary;
      font-size: @font-xs;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-left: @gap-sm;
    }
  }

  &__body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    position: relative;
  }

  &__aspect-ratio {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__aspect-inner {
    aspect-ratio: 16 / 9;
    max-width: 100%;
    max-height: 100%;
    position: relative;
  }
}
</style>
