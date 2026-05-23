<template>
  <div>
    <czf-button :isConfirm="true" @confirmed="toggleTheme('orange-dark')" type="primary">Button</czf-button>
    <czf-dialog>Dialog</czf-dialog>
    <czf-input>Input</czf-input>
    <czf-icon iconName="icon-icon-more">Icon</czf-icon>
    <czf-button :isConfirm="true" @confirmed="toggleTheme('green')">Button</czf-button>
  </div>
</template>
<script setup lang="ts">
import { CzfButton } from '@caf/element-plus-wrapper';
import { CzfDialog } from '@caf/element-plus-wrapper';
import { CzfIcon } from '@caf/element-plus-wrapper';
import { CzfInput } from '@caf/element-plus-wrapper';
import { useTheme } from '@caf/element-plus-wrapper';
const { currentTheme, setTheme } = useTheme();
import { ref } from 'vue';
const inputValue = ref('');
const toggleTheme = (theme: string) => {
  console.log(12313);

  setTheme(theme);
  setTimeout(() => {
    console.log(currentTheme.value);
  }, 1000);
};
</script>
