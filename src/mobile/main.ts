import { createApp } from 'vue'
import MobileApp from './MobileApp.vue'
import './styles.css'
import i18n from '../i18n'
import { translateLegacy } from '../i18n/legacy'
import { installDomTranslator } from '../i18n/dom-translator'

const app = createApp(MobileApp)
app.use(i18n)
app.config.globalProperties.$legacyT = translateLegacy
app.mount('#app')
document.documentElement.lang = i18n.global.locale.value
installDomTranslator(document.body)
