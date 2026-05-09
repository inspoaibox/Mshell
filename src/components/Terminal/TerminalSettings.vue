<template>
  <el-dialog v-model="visible" title="Terminal Settings" width="600px">
    <el-form :model="settings" label-width="140px">
      <el-form-item label="Theme">
        <el-select v-model="settings.theme" placeholder="Select theme">
          <el-option
            v-for="themeName in themeNames"
            :key="themeName"
            :label="themes[themeName].name"
            :value="themeName"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="Font Size">
        <el-slider v-model="settings.fontSize" :min="8" :max="32" :step="1" show-input />
      </el-form-item>

      <el-form-item label="Font Family">
        <el-select v-model="settings.fontFamily" placeholder="Select font">
          <el-option label="Consolas" value="Consolas, monospace" />
          <el-option label="Courier New" value="'Courier New', monospace" />
          <el-option label="Monaco" value="Monaco, monospace" />
          <el-option label="Menlo" value="Menlo, monospace" />
          <el-option label="Fira Code" value="'Fira Code', monospace" />
          <el-option label="Source Code Pro" value="'Source Code Pro', monospace" />
        </el-select>
      </el-form-item>

      <el-form-item label="Cursor Style">
        <el-radio-group v-model="settings.cursorStyle">
          <el-radio value="block">Block</el-radio>
          <el-radio value="underline">Underline</el-radio>
          <el-radio value="bar">Bar</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="Cursor Blink">
        <el-switch v-model="settings.cursorBlink" />
      </el-form-item>

      <el-form-item label="Scrollback Lines">
        <el-input-number v-model="settings.scrollback" :min="100" :max="50000" :step="1000" />
      </el-form-item>

      <el-form-item label="Renderer">
        <el-radio-group v-model="settings.rendererType">
          <el-radio value="auto">Auto</el-radio>
          <el-radio value="webgl">WebGL (Fastest)</el-radio>
          <el-radio value="canvas">Canvas</el-radio>
          <el-radio value="dom">DOM</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="Copy on Select">
        <el-switch v-model="settings.copyOnSelect" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleCancel">Cancel</el-button>
      <el-button type="primary" @click="handleSave">Save</el-button>
      <el-button @click="handleReset">Reset to Defaults</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { themes, getThemeNames } from '@/utils/terminal-themes'

interface TerminalSettings {
  theme: string
  fontSize: number
  fontFamily: string
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
  rendererType: 'auto' | 'dom' | 'canvas' | 'webgl'
  copyOnSelect: boolean
}

interface Props {
  modelValue: boolean
  currentSettings: TerminalSettings
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [settings: TerminalSettings]
}>()

const visible = ref(props.modelValue)
const themeNames = getThemeNames()

const defaultSettings: TerminalSettings = {
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Consolas, monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  rendererType: 'auto',
  copyOnSelect: false
}

const settings = reactive<TerminalSettings>({ ...props.currentSettings })

watch(
  () => props.modelValue,
  (newValue) => {
    visible.value = newValue
    if (newValue) {
      Object.assign(settings, props.currentSettings)
    }
  }
)

watch(visible, (newValue) => {
  emit('update:modelValue', newValue)
})

const handleSave = () => {
  emit('save', { ...settings })
  visible.value = false
}

const handleCancel = () => {
  // Restore original settings
  Object.assign(settings, props.currentSettings)
  visible.value = false
}

const handleReset = () => {
  Object.assign(settings, defaultSettings)
}
</script>

<style scoped>
.custom-dialog :deep(.el-dialog__body) {
  padding: 24px;
}

.settings-form {
  padding: 0 12px;
}

:deep(.el-form-item__label) {
  color: var(--text-secondary);
  font-weight: 500;
}

:deep(.el-slider__runway) {
  background-color: var(--bg-tertiary);
}

:deep(.el-slider__bar) {
  background-color: var(--primary-color);
}

:deep(.el-slider__button) {
  border-color: var(--primary-color);
}

:deep(.el-radio-button__inner) {
  background-color: var(--bg-tertiary);
  border-color: var(--border-color);
  color: var(--text-secondary);
  box-shadow: none !important;
}

:deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background-color: var(--primary-color);
  border-color: var(--primary-color);
  color: white;
}

:deep(.el-switch__core) {
  background-color: var(--bg-tertiary);
  border-color: var(--border-color);
}

:deep(.el-switch.is-checked .el-switch__core) {
  background-color: var(--primary-color);
  border-color: var(--primary-color);
}
</style>
