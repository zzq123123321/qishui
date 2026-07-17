import { createApp } from 'vue';
import App from './App.vue';
import './styles/mineradio.scss';
import { applyMineradioPreloadModeClass } from './composables/usePreloadModeClass.js';

applyMineradioPreloadModeClass();

createApp(App).mount('#app');
