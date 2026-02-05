<template>
  <el-dialog v-model="visible" title="快速连接" width="500px">
    <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
      <el-form-item label="主机" prop="host">
        <el-input
          v-model="form.host"
          placeholder="user@host:port"
          @keyup.enter="handleConnect"
        />
        <template #extra>
          <span style="font-size: var(--text-sm); color: #999">
            格式: 用户名@主机:端口 (端口可选，默认 22)
          </span>
        </template>
      </el-form-item>

      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          placeholder="输入密码"
          show-password
          @keyup.enter="handleConnect"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleConnect">连接</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

interface Props {
  modelValue: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  connect: [config: { host: string; port: number; username: string; password: string }]
}>()

const visible = ref(props.modelValue)
const formRef = ref<FormInstance>()

const form = reactive({
  host: '',
  password: ''
})

const rules: FormRules = {
  host: [{ required: true, message: '请输入主机地址', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

watch(
  () => props.modelValue,
  (newValue) => {
    visible.value = newValue
    if (newValue) {
      form.host = ''
      form.password = ''
    }
  }
)

watch(visible, (newValue) => {
  emit('update:modelValue', newValue)
})

const parseHostString = (hostStr: string) => {
  // Parse format: user@host:port or user@host
  const match = hostStr.match(/^([^@]+)@([^:]+)(?::(\d+))?$/)
  
  if (!match) {
    throw new Error('Invalid format. Use: username@hostname:port')
  }

  return {
    username: match[1],
    host: match[2],
    port: match[3] ? parseInt(match[3]) : 22
  }
}

const handleConnect = async () => {
  if (!formRef.value) return

  await formRef.value.validate((valid) => {
    if (valid) {
      try {
        const parsed = parseHostString(form.host)
        emit('connect', {
          ...parsed,
          password: form.password
        })
        visible.value = false
      } catch (error: any) {
        ElMessage.error(error.message)
      }
    }
  })
}
</script>
