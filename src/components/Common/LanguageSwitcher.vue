<template>
  <div class="language-switcher">
    <el-select v-model="currentLocale" @change="changeLocale" class="locale-select">
      <el-option value="zh-CN" label="简体中文">
        <span>🇨🇳 简体中文</span>
      </el-option>
      <el-option value="en-US" label="English">
        <span>🇺🇸 English</span>
      </el-option>
    </el-select>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

const { locale } = useI18n()
const currentLocale = ref(locale.value)

const changeLocale = () => {
  locale.value = currentLocale.value
  localStorage.setItem('locale', currentLocale.value)
  
  // 显示切换成功消息
  const message = currentLocale.value === 'zh-CN' 
    ? '语言已切换为简体中文' 
    : 'Language switched to English'
  ElMessage.success(message)
}

// Watch for external locale changes
watch(locale, (newLocale) => {
  currentLocale.value = newLocale
})
</script>

<style scoped>
.language-switcher {
  display: inline-block;
  width: 100%;
}

.locale-select {
  width: 100%;
}
</style>
