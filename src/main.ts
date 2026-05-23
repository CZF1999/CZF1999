import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import 'element-plus/dist/index.css'
// czf 组件样式 + 自定义主题
import '@caf/element-plus-wrapper/dist/style.css'
import './assets/themes.css'
const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
