<template>
  <div class="i18n-demo">
    <el-card class="demo-card">
      <template #header>
        <div class="card-header">
          <span>{{ t('common.language') }} / Language Demo</span>
          <LanguageSwitcher />
        </div>
      </template>
      
      <div class="demo-section">
        <h3>{{ t('common.common') }}</h3>
        <el-space wrap>
          <el-tag>{{ t('common.confirm') }}</el-tag>
          <el-tag>{{ t('common.cancel') }}</el-tag>
          <el-tag>{{ t('common.save') }}</el-tag>
          <el-tag>{{ t('common.delete') }}</el-tag>
          <el-tag>{{ t('common.edit') }}</el-tag>
        </el-space>
      </div>
      
      <el-divider />
      
      <div class="demo-section">
        <h3>{{ t('settings.language') }}</h3>
        <p>{{ t('common.currentLocale') }}: {{ currentLocale }}</p>
        <p>{{ isZhCN ? '当前语言：中文' : 'Current Language: English' }}</p>
      </div>
      
      <el-divider />
      
      <div class="demo-section">
        <h3>格式化演示 / Formatting Demo</h3>
        
        <div class="format-item">
          <strong>日期格式化 / Date:</strong>
          <span>{{ formatDate(new Date()) }}</span>
        </div>
        
        <div class="format-item">
          <strong>时间格式化 / Time:</strong>
          <span>{{ formatTime(new Date()) }}</span>
        </div>
        
        <div class="format-item">
          <strong>日期时间 / DateTime:</strong>
          <span>{{ formatDateTime(new Date()) }}</span>
        </div>
        
        <div class="format-item">
          <strong>数字格式化 / Number:</strong>
          <span>{{ formatNumber(1234567.89) }}</span>
        </div>
        
        <div class="format-item">
          <strong>字节格式化 / Bytes:</strong>
          <span>{{ formatBytes(1024 * 1024 * 500) }}</span>
        </div>
        
        <div class="format-item">
          <strong>时长格式化 / Duration:</strong>
          <span>{{ formatDuration(3665) }}</span>
        </div>
        
        <div class="format-item">
          <strong>相对时间 / Relative Time:</strong>
          <span>{{ formatRelativeTime(new Date(Date.now() - 3600000)) }}</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/composables/useLocale'
import LanguageSwitcher from './LanguageSwitcher.vue'

const {
  t,
  currentLocale,
  isZhCN,
  formatDate,
  formatTime,
  formatDateTime,
  formatNumber,
  formatBytes,
  formatDuration,
  formatRelativeTime
} = useLocale()
</script>

<style scoped>
.i18n-demo {
  padding: 20px;
}

.demo-card {
  max-width: 800px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.demo-section {
  margin: 20px 0;
}

.demo-section h3 {
  margin-bottom: 12px;
  color: var(--text-primary);
}

.format-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}

.format-item:last-child {
  border-bottom: none;
}

.format-item strong {
  color: var(--text-secondary);
}

.format-item span {
  color: var(--primary-color);
  font-weight: 500;
}
</style>
