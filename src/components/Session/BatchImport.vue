<template>
  <el-dialog v-model="visible" title="批量导入会话" width="750px" :close-on-click-modal="false">
    <div class="batch-import-content">
      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        <template #title>
          <div>支持智能解析多种格式（每行一个会话）：</div>
          <ul style="margin: 8px 0 0 20px; padding: 0;">
            <li><code>user@host:port -p password -name 名称 -group 分组</code></li>
            <li><code>ssh user@host -p 22</code> (SSH命令格式)</li>
            <li><code>ssh://user:password@host:port</code> (URL格式)</li>
            <li><code>host,port,user,password,name,group</code> (CSV格式)</li>
            <li><code>{"host":"x","user":"y","password":"z"}</code> (JSON格式)</li>
          </ul>
        </template>
      </el-alert>

      <el-form label-position="top">
        <el-form-item label="导入内容">
          <el-input
            v-model="importText"
            type="textarea"
            :rows="12"
            placeholder="支持多种格式混合输入，每行一个会话：

root@192.168.1.1:22 -p mypassword -name 生产服务器 -group 生产环境
ssh admin@10.0.0.1 -p 2222
ssh://ubuntu:pass123@example.com:22
192.168.1.100,22,root,password,测试服务器,测试环境
{&quot;host&quot;:&quot;10.0.0.5&quot;,&quot;username&quot;:&quot;admin&quot;,&quot;password&quot;:&quot;123456&quot;}"
          />
        </el-form-item>
        
        <el-form-item label="默认分组（未指定分组时使用）">
          <el-select v-model="defaultGroup" placeholder="选择分组（可选）" clearable style="width: 100%">
            <el-option
              v-for="group in groups"
              :key="group.id"
              :label="group.name"
              :value="group.id"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <!-- 预览解析结果 -->
      <div v-if="parsedSessions.length > 0" class="preview-section">
        <div class="preview-header">
          <span>解析预览 ({{ parsedSessions.length }} 个会话，{{ validCount }} 个有效)</span>
          <el-button size="small" link @click="parsedSessions = []">清除</el-button>
        </div>
        <el-table :data="parsedSessions" max-height="250" size="small">
          <el-table-column prop="name" label="名称" min-width="120" show-overflow-tooltip />
          <el-table-column prop="username" label="用户名" width="90" />
          <el-table-column prop="host" label="主机" min-width="120" show-overflow-tooltip />
          <el-table-column prop="port" label="端口" width="55" />
          <el-table-column label="密码" width="45">
            <template #default="{ row }">
              <el-icon v-if="row.password" color="var(--success-color)"><Check /></el-icon>
              <el-icon v-else color="var(--text-tertiary)"><Close /></el-icon>
            </template>
          </el-table-column>
          <el-table-column label="分组" min-width="90">
            <template #default="{ row }">
              {{ getGroupName(row.groupId) || row.groupName || '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="format" label="格式" width="70">
            <template #default="{ row }">
              <el-tag size="small" type="info">{{ row.format }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="65">
            <template #default="{ row }">
              <el-tag v-if="row.error" type="danger" size="small">错误</el-tag>
              <el-tag v-else type="success" size="small">有效</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 错误信息 -->
      <div v-if="parseErrors.length > 0" class="error-section">
        <el-alert type="error" :closable="false">
          <template #title>
            解析错误 ({{ parseErrors.length }} 条)
          </template>
          <div v-for="(err, idx) in parseErrors" :key="idx" style="font-size: var(--text-sm);">
            第 {{ err.line }} 行: {{ err.message }}
          </div>
        </el-alert>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button @click="handlePreview" :disabled="!importText.trim()">预览</el-button>
      <el-button type="primary" @click="handleImport" :loading="importing" :disabled="validCount === 0">
        导入 ({{ validCount }})
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Close } from '@element-plus/icons-vue'

interface ParsedSession {
  name: string
  username: string
  host: string
  port: number
  password: string
  groupId?: string
  groupName?: string
  format?: string
  error?: string
}

interface ParseError {
  line: number
  message: string
}

interface Props {
  modelValue: boolean
  groups: { id: string; name: string }[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  imported: [count: number]
}>()

const visible = ref(props.modelValue)
const importText = ref('')
const defaultGroup = ref('')
const parsedSessions = ref<ParsedSession[]>([])
const parseErrors = ref<ParseError[]>([])
const importing = ref(false)

const validCount = computed(() => parsedSessions.value.filter(s => !s.error).length)

watch(() => props.modelValue, (newValue) => {
  visible.value = newValue
  if (newValue) {
    importText.value = ''
    parsedSessions.value = []
    parseErrors.value = []
    defaultGroup.value = ''
  }
})

watch(visible, (newValue) => {
  emit('update:modelValue', newValue)
})

// 根据分组名称查找分组ID
const findGroupByName = (name: string): string | undefined => {
  console.log('[BatchImport] Finding group by name:', name)
  console.log('[BatchImport] Available groups:', props.groups)
  const group = props.groups.find(g => g.name === name || g.name.toLowerCase() === name.toLowerCase())
  console.log('[BatchImport] Found group:', group)
  return group?.id
}

// 根据分组ID获取分组名称
const getGroupName = (groupId?: string): string => {
  if (!groupId) return ''
  const group = props.groups.find(g => g.id === groupId)
  return group?.name || ''
}

// 解析 MShell 自定义格式: user@host:port -p password -name xxx -group xxx
const parseMShellFormat = (line: string): ParsedSession | null => {
  const baseMatch = line.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?/)
  if (!baseMatch) return null

  const username = baseMatch[1]
  const host = baseMatch[2]
  const port = baseMatch[3] ? parseInt(baseMatch[3]) : 22

  let password = ''
  let name = `${username}@${host}`
  let groupName: string | undefined

  // 解析 -p password
  const pwdMatch = line.match(/-p\s+(\S+)/)
  if (pwdMatch) password = pwdMatch[1]

  // 解析 -name 名称
  const nameMatch = line.match(/-name\s+(\S+)/)
  if (nameMatch) name = nameMatch[1]

  // 解析 -group 分组名
  const groupMatch = line.match(/-group\s+(\S+)/)
  if (groupMatch) {
    groupName = groupMatch[1]
    console.log('[BatchImport] Parsed group name:', groupName)
  }

  return { name, username, host, port, password, groupName, format: 'MShell' }
}

// 解析 SSH 命令格式: ssh user@host -p 22 或 ssh -p 22 user@host
const parseSSHCommand = (line: string): ParsedSession | null => {
  if (!line.toLowerCase().startsWith('ssh ')) return null

  // 提取端口 -p 参数
  const portMatch = line.match(/-p\s+(\d+)/)
  const port = portMatch ? parseInt(portMatch[1]) : 22

  // 提取 user@host
  const userHostMatch = line.match(/([^@\s]+)@([^\s:]+)/)
  if (!userHostMatch) return null

  const username = userHostMatch[1]
  const host = userHostMatch[2]
  const name = `${username}@${host}`

  return { name, username, host, port, password: '', format: 'SSH' }
}

// 解析 URL 格式: ssh://user:password@host:port
const parseURLFormat = (line: string): ParsedSession | null => {
  const match = line.match(/^ssh:\/\/([^:@]+)(?::([^@]*))?@([^:\/]+)(?::(\d+))?/)
  if (!match) return null

  const username = match[1]
  const password = match[2] || ''
  const host = match[3]
  const port = match[4] ? parseInt(match[4]) : 22
  const name = `${username}@${host}`

  return { name, username, host, port, password, format: 'URL' }
}

// 解析 CSV 格式: host,port,user,password,name,group
const parseCSVFormat = (line: string): ParsedSession | null => {
  // 检测是否是 CSV 格式（包含逗号且不是其他格式）
  if (!line.includes(',') || line.includes('@') || line.startsWith('ssh') || line.startsWith('{')) {
    return null
  }

  const parts = line.split(',').map(p => p.trim())
  if (parts.length < 3) return null

  const host = parts[0]
  const port = parts[1] ? parseInt(parts[1]) || 22 : 22
  const username = parts[2]
  const password = parts[3] || ''
  const name = parts[4] || `${username}@${host}`
  const groupName = parts[5] || undefined

  // 验证 host 格式
  if (!host || !username) return null

  return { name, username, host, port, password, groupName, format: 'CSV' }
}

// 解析 JSON 格式
const parseJSONFormat = (line: string): ParsedSession | null => {
  if (!line.trim().startsWith('{')) return null

  try {
    const obj = JSON.parse(line)
    const host = obj.host || obj.hostname || obj.ip || obj.server
    const username = obj.username || obj.user || obj.login
    const password = obj.password || obj.pass || obj.pwd || ''
    const port = obj.port || 22
    const name = obj.name || obj.title || obj.label || `${username}@${host}`
    const groupName = obj.group || obj.folder || obj.category

    if (!host || !username) return null

    return { name, username, host, port, password, groupName, format: 'JSON' }
  } catch {
    return null
  }
}

// 解析简单格式: host:port user password 或 user@host password
const parseSimpleFormat = (line: string): ParsedSession | null => {
  // user@host password
  const match1 = line.match(/^([^@\s]+)@([^\s:]+)(?::(\d+))?\s+(\S+)$/)
  if (match1) {
    return {
      name: `${match1[1]}@${match1[2]}`,
      username: match1[1],
      host: match1[2],
      port: match1[3] ? parseInt(match1[3]) : 22,
      password: match1[4],
      format: '简单'
    }
  }

  // host port user password
  const match2 = line.match(/^([^\s]+)\s+(\d+)\s+([^\s]+)\s+(\S+)$/)
  if (match2) {
    return {
      name: `${match2[3]}@${match2[1]}`,
      username: match2[3],
      host: match2[1],
      port: parseInt(match2[2]),
      password: match2[4],
      format: '简单'
    }
  }

  return null
}

// 智能解析单行
const parseLine = (line: string, lineNum: number): ParsedSession | null => {
  line = line.trim()
  if (!line || line.startsWith('#') || line.startsWith('//')) return null

  // 按优先级尝试各种格式
  let result = parseJSONFormat(line)
    || parseURLFormat(line)
    || parseSSHCommand(line)
    || parseCSVFormat(line)
    || parseMShellFormat(line)
    || parseSimpleFormat(line)

  if (!result) {
    return {
      name: '',
      username: '',
      host: '',
      port: 22,
      password: '',
      format: '未知',
      error: '无法识别的格式'
    }
  }

  // 验证必要字段
  if (!result.host || !result.username) {
    result.error = '缺少主机或用户名'
  }

  return result
}

const handlePreview = () => {
  const lines = importText.value.split('\n')
  parsedSessions.value = []
  parseErrors.value = []

  lines.forEach((line, idx) => {
    const result = parseLine(line, idx + 1)
    if (result) {
      // 处理分组
      if (result.groupName) {
        result.groupId = findGroupByName(result.groupName)
      }
      if (!result.groupId && defaultGroup.value) {
        result.groupId = defaultGroup.value
      }

      if (result.error) {
        parseErrors.value.push({ line: idx + 1, message: result.error })
      }
      parsedSessions.value.push(result)
    }
  })

  if (parsedSessions.value.length === 0) {
    ElMessage.warning('没有解析到有效的会话配置')
  } else {
    ElMessage.success(`解析完成：${validCount.value} 个有效，${parseErrors.value.length} 个错误`)
  }
}

const handleImport = async () => {
  const validSessions = parsedSessions.value.filter(s => !s.error)
  if (validSessions.length === 0) {
    ElMessage.warning('没有有效的会话可导入')
    return
  }

  importing.value = true
  let successCount = 0
  let failCount = 0

  // 收集需要创建的新分组
  const newGroupNames = new Set<string>()
  for (const session of validSessions) {
    if (session.groupName && !session.groupId) {
      newGroupNames.add(session.groupName)
    }
  }

  // 创建新分组并建立名称到ID的映射
  const newGroupMap = new Map<string, string>()
  for (const groupName of newGroupNames) {
    try {
      const newGroup = await window.electronAPI.session.createGroup(groupName)
      newGroupMap.set(groupName, newGroup.id)
      console.log('[BatchImport] Created new group:', groupName, '->', newGroup.id)
    } catch (error) {
      console.error('[BatchImport] Failed to create group:', groupName, error)
    }
  }

  try {
    for (const session of validSessions) {
      try {
        // 如果没有 groupId 但有 groupName，尝试从新创建的分组中获取
        let groupId = session.groupId
        if (!groupId && session.groupName) {
          groupId = newGroupMap.get(session.groupName)
        }

        console.log('[BatchImport] Creating session:', {
          name: session.name,
          host: session.host,
          groupId: groupId,
          groupName: session.groupName
        })
        await window.electronAPI.session.create({
          name: session.name,
          host: session.host,
          port: session.port,
          username: session.username,
          password: session.password,
          authType: session.password ? 'password' : 'none',
          group: groupId  // SessionConfig 使用 group 字段存储 groupId
        })
        successCount++
      } catch (error) {
        failCount++
        console.error('Failed to create session:', error)
      }
    }

    if (failCount === 0) {
      ElMessage.success(`成功导入 ${successCount} 个会话`)
    } else {
      ElMessage.warning(`导入完成：成功 ${successCount} 个，失败 ${failCount} 个`)
    }

    emit('imported', successCount)
    visible.value = false
  } catch (error: any) {
    ElMessage.error('导入失败: ' + error.message)
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.batch-import-content {
  max-height: 65vh;
  overflow-y: auto;
}

.preview-section {
  margin-top: 16px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--text-md);
  font-weight: 500;
}

.error-section {
  margin-top: 16px;
}

code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: var(--text-sm);
}
</style>
