import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import 'element-plus/dist/index.css'
// czf 组件样式 + 自定义主题
import '@caf/element-plus-wrapper/dist/style.css'
import './assets/themes.css'
import { useTheme } from '@caf/element-plus-wrapper';

useTheme([
  { name: 'green', className: 'theme-green', label: '绿色' },
  { name: 'orange-dark', className: 'theme-orange-dark', label: '橙深色' },
]);
const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
