import type { App } from 'vue';

export { useTheme } from './composables/useTheme';

export { default as CzfButton } from './components/czf-Button.vue';
export { default as CzfDialog } from './components/czf-Dialog.vue';
export { default as CzfIcon } from './components/czf-Icon.vue';
export { default as CzfInput } from './components/czf-Input.vue';
export { default as CzfListOperate } from './components/czf-ListOperate.vue';
export { default as CzfTable } from './components/czf-Table.vue';

import CzfButton from './components/czf-Button.vue';
import CzfDialog from './components/czf-Dialog.vue';
import CzfIcon from './components/czf-Icon.vue';
import CzfInput from './components/czf-Input.vue';
import CzfListOperate from './components/czf-ListOperate.vue';
import CzfTable from './components/czf-Table.vue';

const components = [CzfButton, CzfDialog, CzfIcon, CzfInput, CzfListOperate, CzfTable];

const ElementPlusWrapper = {
  install(app: App) {
    components.forEach((comp) => {
      const name = comp.name || '';
      if (name) {
        app.component(name, comp);
      }
    });
  },
};

export default ElementPlusWrapper;
