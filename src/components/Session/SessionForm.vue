<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑会话' : '新建会话'"
    width="600px"
  >
    <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
      <!-- 会话类型选择 -->
      <el-form-item label="会话类型" prop="type">
        <el-radio-group v-model="form.type" @change="handleTypeChange">
          <el-radio value="ssh">
            <el-icon><Monitor /></el-icon> SSH
          </el-radio>
          <el-radio value="rdp">
            <el-icon><DesktopOutlined /></el-icon> RDP
          </el-radio>
          <el-radio value="vnc">
            <el-icon><DesktopOutlined /></el-icon> VNC
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" placeholder="我的服务器" />
      </el-form-item>

      <el-form-item label="主机" prop="host">
        <el-input v-model="form.host" placeholder="192.168.1.100 或 example.com" />
      </el-form-item>

      <el-form-item label="端口" prop="port">
        <el-input-number v-model="form.port" :min="1" :max="65535" />
      </el-form-item>

      <el-form-item label="用户名" prop="username">
        <el-input v-model="form.username" :placeholder="form.type === 'rdp' ? 'Administrator' : 'root'" />
      </el-form-item>

      <!-- SSH 认证方式 -->
      <template v-if="form.type === 'ssh'">
        <el-form-item label="认证方式" prop="authType">
          <el-radio-group v-model="form.authType">
            <el-radio value="password">密码</el-radio>
            <el-radio value="privateKey">私钥</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="form.authType === 'password'" label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="输入密码"
            show-password
          />
        </el-form-item>

        <el-form-item
          v-if="form.authType === 'privateKey'"
          label="SSH密钥"
          prop="privateKeyId"
        >
          <el-select 
            v-model="form.privateKeyId" 
            placeholder="选择SSH密钥" 
            filterable
            style="width: 100%"
            @focus="loadSSHKeys"
            @change="handleSSHKeyChange"
          >
            <el-option
              v-for="key in sshKeys"
              :key="key.id"
              :label="`${key.name} (${key.type.toUpperCase()})`"
              :value="key.id"
            >
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>{{ key.name }}</span>
                <el-tag size="small" :type="getKeyTypeColor(key.type)">{{ key.type.toUpperCase() }}</el-tag>
              </div>
            </el-option>
          </el-select>
          <div style="margin-top: 8px; font-size: var(--text-sm); color: var(--text-secondary);">
            或 <el-button type="primary" link size="small" @click="handleSelectLocalKeyFile">选择本地文件</el-button>
          </div>
        </el-form-item>

        <el-form-item
          v-if="form.authType === 'privateKey' && form.privateKeyPath"
          label="本地私钥"
        >
          <el-input v-model="form.privateKeyPath" readonly>
            <template #append>
              <el-button @click="form.privateKeyPath = ''; form.privateKeyId = ''">清除</el-button>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item
          v-if="form.authType === 'privateKey'"
          label="密钥密码"
          prop="passphrase"
        >
          <el-input
            v-model="form.passphrase"
            type="password"
            placeholder="密钥密码（可选）"
            show-password
          />
        </el-form-item>
      </template>

      <!-- RDP 密码 -->
      <template v-if="form.type === 'rdp'">
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="输入密码（可选，连接时输入）"
            show-password
          />
        </el-form-item>

        <el-form-item label="域" prop="domain">
          <el-input v-model="form.domain" placeholder="域名（可选）" />
        </el-form-item>
      </template>

      <!-- VNC 密码 -->
      <template v-if="form.type === 'vnc'">
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="VNC 密码（如果服务器需要）"
            show-password
          />
        </el-form-item>
      </template>

      <el-form-item label="分组" prop="groupId">
        <el-select v-model="form.groupId" placeholder="选择分组" clearable>
          <el-option
            v-for="group in appStore.groups"
            :key="group.id"
            :label="group.name"
            :value="group.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="描述">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          placeholder="可选描述"
        />
      </el-form-item>

      <!-- RDP 选项 -->
      <template v-if="form.type === 'rdp'">
        <el-divider content-position="left">
          <span style="font-size: var(--text-base); color: var(--text-secondary)">RDP 选项</span>
        </el-divider>

        <el-form-item label="显示模式">
          <el-radio-group v-model="form.rdpDisplayMode">
            <el-radio value="window">窗口模式</el-radio>
            <el-radio value="fullscreen">全屏（单显示器）</el-radio>
            <el-radio value="multimon">全屏（多显示器）</el-radio>
          </el-radio-group>
          <div style="font-size: var(--text-sm); color: var(--text-tertiary); margin-top: 4px;">
            <template v-if="form.rdpDisplayMode === 'window'">使用指定分辨率在窗口中显示</template>
            <template v-else-if="form.rdpDisplayMode === 'fullscreen'">占满本地一个显示器</template>
            <template v-else>跨越本地所有显示器</template>
          </div>
        </el-form-item>

        <el-form-item v-if="form.rdpDisplayMode === 'window'" label="分辨率">
          <div style="display: flex; gap: 8px; align-items: center;">
            <el-select v-model="form.rdpResolution" placeholder="选择分辨率" style="width: 180px" @change="handleResolutionChange">
              <el-option label="自动（匹配本地）" value="auto" />
              <el-option label="1920 × 1080 (Full HD)" value="1920x1080" />
              <el-option label="1680 × 1050" value="1680x1050" />
              <el-option label="1600 × 900" value="1600x900" />
              <el-option label="1440 × 900" value="1440x900" />
              <el-option label="1366 × 768" value="1366x768" />
              <el-option label="1280 × 720 (HD)" value="1280x720" />
              <el-option label="1024 × 768" value="1024x768" />
              <el-option label="自定义..." value="custom" />
            </el-select>
            <template v-if="form.rdpResolution === 'custom'">
              <el-input-number v-model="form.rdpCustomWidth" :min="640" :max="7680" :step="10" placeholder="宽" style="width: 100px" />
              <span>×</span>
              <el-input-number v-model="form.rdpCustomHeight" :min="480" :max="4320" :step="10" placeholder="高" style="width: 100px" />
            </template>
          </div>
        </el-form-item>

        <el-form-item label="连接模式">
          <el-checkbox v-model="form.rdpAdmin">管理员模式 (/admin)</el-checkbox>
          <div style="font-size: var(--text-sm); color: var(--text-tertiary); margin-top: 2px;">
            直接连接到控制台会话，绕过其他用户会话
          </div>
        </el-form-item>

        <el-form-item label="资源重定向">
          <el-checkbox v-model="form.rdpDrives">驱动器</el-checkbox>
          <el-checkbox v-model="form.rdpPrinters" style="margin-left: 16px">打印机</el-checkbox>
          <el-checkbox v-model="form.rdpClipboard" style="margin-left: 16px">剪贴板</el-checkbox>
        </el-form-item>

        <el-form-item label="音频">
          <el-radio-group v-model="form.rdpAudio">
            <el-radio value="local">本地播放</el-radio>
            <el-radio value="remote">远程播放</el-radio>
            <el-radio value="none">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </template>

      <!-- VNC 选项 -->
      <template v-if="form.type === 'vnc'">
        <el-divider content-position="left">
          <span style="font-size: var(--text-base); color: var(--text-secondary)">VNC 选项</span>
        </el-divider>

        <el-form-item label="连接模式">
          <el-checkbox v-model="form.vncViewOnly">只读模式</el-checkbox>
          <div style="font-size: var(--text-sm); color: var(--text-tertiary); margin-top: 2px;">
            只能查看，不能操作远程桌面
          </div>
        </el-form-item>

        <el-form-item label="共享连接">
          <el-checkbox v-model="form.vncShared">允许多用户同时连接</el-checkbox>
        </el-form-item>

        <el-form-item label="本地光标">
          <el-checkbox v-model="form.vncLocalCursor">显示本地光标</el-checkbox>
        </el-form-item>

        <el-form-item label="图像质量">
          <el-slider 
            v-model="form.vncQuality" 
            :min="0" 
            :max="9" 
            :step="1"
            :marks="{ 0: '低', 5: '中', 9: '高' }"
            style="width: 200px; margin-left: 10px;"
          />
        </el-form-item>

        <el-form-item label="压缩级别">
          <el-slider 
            v-model="form.vncCompression" 
            :min="0" 
            :max="9" 
            :step="1"
            :marks="{ 0: '无', 5: '中', 9: '高' }"
            style="width: 200px; margin-left: 10px;"
          />
        </el-form-item>
      </template>

      <!-- 服务器管理信息（可折叠） -->
      <el-divider content-position="left">
        <span style="font-size: var(--text-base); color: var(--text-secondary)">服务器管理信息（可选）</span>
      </el-divider>

      <el-form-item label="提供商">
        <el-input v-model="form.provider" placeholder="如：阿里云、腾讯云、AWS" />
      </el-form-item>

      <el-form-item label="所属地区">
        <el-select 
          v-model="form.region" 
          placeholder="请选择国家/地区" 
          filterable 
          allow-create 
          default-first-option
          style="width: 100%"
        >
          <el-option
            v-for="item in countryOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          >
            <span style="float: left">{{ item.label }}</span>
            <span style="float: right; color: var(--el-text-color-secondary); font-size: var(--text-sm)">
              {{ item.value }}
            </span>
          </el-option>
        </el-select>
      </el-form-item>

      <el-form-item label="到期时间">
        <el-date-picker
          v-model="form.expiryDate"
          type="datetime"
          placeholder="选择到期时间"
          style="width: 100%"
          format="YYYY-MM-DD HH:mm:ss"
          value-format="YYYY-MM-DD HH:mm:ss"
        />
      </el-form-item>

      <el-form-item label="计费周期">
        <el-select v-model="form.billingCycle" placeholder="选择计费周期" clearable>
          <el-option label="月付" value="monthly" />
          <el-option label="季付" value="quarterly" />
          <el-option label="半年付" value="semi-annually" />
          <el-option label="年付" value="annually" />
          <el-option label="两年付" value="biennially" />
          <el-option label="三年付" value="triennially" />
          <el-option label="自定义" value="custom" />
        </el-select>
      </el-form-item>

      <el-form-item label="计费费用">
        <el-input v-model.number="form.billingAmount" placeholder="费用金额" type="number">
          <template #append>
            <el-select v-model="form.billingCurrency" style="width: 80px">
              <el-option label="CNY" value="CNY" />
              <el-option label="USD" value="USD" />
              <el-option label="EUR" value="EUR" />
            </el-select>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="form.notes"
          type="textarea"
          :rows="2"
          placeholder="其他备注信息"
        />
      </el-form-item>

      <!-- 跳板机配置（仅 SSH） -->
      <template v-if="form.type === 'ssh'">
        <el-divider content-position="left">
          <span style="font-size: var(--text-base); color: var(--text-secondary)">高级连接选项（可选）</span>
        </el-divider>

        <ProxyJumpConfig
          :config="form.proxyJump"
          @update="handleProxyJumpUpdate"
        />

        <!-- 代理配置 -->
        <ProxyConfig
          :config="form.proxy"
          @update="handleProxyUpdate"
        />
      </template>
    </el-form>

    <template #footer>
      <el-button @click="handleCancel">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { Monitor } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import type { SessionConfig, ProxyJumpConfig as ProxyJumpConfigType, ProxyConfig as ProxyConfigType, SessionType } from '@/types/session'
import ProxyJumpConfig from './ProxyJumpConfig.vue'
import ProxyConfig from './ProxyConfig.vue'

// 自定义桌面图标（Element Plus 没有 Desktop 图标）
const DesktopOutlined = {
  template: `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M928 160H96c-17.7 0-32 14.3-32 32v576c0 17.7 14.3 32 32 32h380v112H304c-8.8 0-16 7.2-16 16v48h448v-48c0-8.8-7.2-16-16-16H548V800h380c17.7 0 32-14.3 32-32V192c0-17.7-14.3-32-32-32zm-40 576H136V232h752v504z"/></svg>`
}

interface Props {
  modelValue: boolean
  session?: SessionConfig | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [session: Partial<SessionConfig>]
}>()

// 使用 store 获取 groups
const appStore = useAppStore()

const visible = ref(props.modelValue)
const formRef = ref<FormInstance>()
const isEdit = ref(false)

const countryOptions = [
  // 亚洲
  { label: '中国 (China)', value: 'CN' },
  { label: '中国香港 (Hong Kong)', value: 'HK' },
  { label: '中国澳门 (Macau)', value: 'MO' },
  { label: '中国台湾 (Taiwan)', value: 'TW' },
  { label: '日本 (Japan)', value: 'JP' },
  { label: '韩国 (Korea)', value: 'KR' },
  { label: '新加坡 (Singapore)', value: 'SG' },
  { label: '马来西亚 (Malaysia)', value: 'MY' },
  { label: '泰国 (Thailand)', value: 'TH' },
  { label: '越南 (Vietnam)', value: 'VN' },
  { label: '印度尼西亚 (Indonesia)', value: 'ID' },
  { label: '菲律宾 (Philippines)', value: 'PH' },
  { label: '印度 (India)', value: 'IN' },
  { label: '巴基斯坦 (Pakistan)', value: 'PK' },
  { label: '孟加拉国 (Bangladesh)', value: 'BD' },
  { label: '以色列 (Israel)', value: 'IL' },
  { label: '土耳其 (Turkey)', value: 'TR' },
  { label: '阿联酋 (UAE)', value: 'AE' },
  { label: '沙特阿拉伯 (Saudi Arabia)', value: 'SA' },

  // 欧洲
  { label: '英国 (UK)', value: 'GB' },
  { label: '德国 (Germany)', value: 'DE' },
  { label: '法国 (France)', value: 'FR' },
  { label: '荷兰 (Netherlands)', value: 'NL' },
  { label: '瑞士 (Switzerland)', value: 'CH' },
  { label: '瑞典 (Sweden)', value: 'SE' },
  { label: '挪威 (Norway)', value: 'NO' },
  { label: '芬兰 (Finland)', value: 'FI' },
  { label: '丹麦 (Denmark)', value: 'DK' },
  { label: '意大利 (Italy)', value: 'IT' },
  { label: '西班牙 (Spain)', value: 'ES' },
  { label: '葡萄牙 (Portugal)', value: 'PT' },
  { label: '波兰 (Poland)', value: 'PL' },
  { label: '俄罗斯 (Russia)', value: 'RU' },
  { label: '乌克兰 (Ukraine)', value: 'UA' },
  { label: '爱尔兰 (Ireland)', value: 'IE' },
  { label: '比利时 (Belgium)', value: 'BE' },
  { label: '奥地利 (Austria)', value: 'AT' },

  // 北美洲
  { label: '美国 (USA)', value: 'US' },
  { label: '加拿大 (Canada)', value: 'CA' },
  { label: '墨西哥 (Mexico)', value: 'MX' },

  // 南美洲
  { label: '巴西 (Brazil)', value: 'BR' },
  { label: '阿根廷 (Argentina)', value: 'AR' },
  { label: '智利 (Chile)', value: 'CL' },
  { label: '哥伦比亚 (Colombia)', value: 'CO' },

  // 大洋洲
  { label: '澳大利亚 (Australia)', value: 'AU' },
  { label: '新西兰 (New Zealand)', value: 'NZ' },

  // 非洲
  { label: '南非 (South Africa)', value: 'ZA' },
  { label: '埃及 (Egypt)', value: 'EG' },
  { label: '尼日利亚 (Nigeria)', value: 'NG' }
]

// 获取默认表单值的函数（每次调用返回新对象，避免引用问题）
const getDefaultForm = () => ({
  type: 'ssh' as SessionType,
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password' as 'password' | 'privateKey',
  password: '',
  privateKeyId: '',
  privateKeyPath: '',
  passphrase: '',
  groupId: '',
  description: '',
  domain: '', // RDP 域
  // RDP 选项
  rdpDisplayMode: 'window' as 'window' | 'fullscreen' | 'multimon',
  rdpResolution: 'auto',
  rdpCustomWidth: 1920,
  rdpCustomHeight: 1080,
  rdpAdmin: false,
  rdpDrives: false,
  rdpPrinters: false,
  rdpClipboard: true,
  rdpAudio: 'local' as 'local' | 'remote' | 'none',
  // VNC 选项
  vncViewOnly: false,
  vncShared: true,
  vncLocalCursor: true,
  vncQuality: 6,
  vncCompression: 2,
  // 服务器管理字段
  provider: '',
  region: '',
  expiryDate: null as string | null,
  billingCycle: '' as '' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'biennially' | 'triennially' | 'custom',
  billingAmount: undefined as number | undefined,
  billingCurrency: 'CNY',
  notes: '',
  // 跳板机配置
  proxyJump: undefined as ProxyJumpConfigType | undefined,
  // 代理配置
  proxy: undefined as ProxyConfigType | undefined
})

const form = reactive(getDefaultForm())

// 处理会话类型变化
const handleTypeChange = (type: SessionType) => {
  // 切换类型时更新默认端口
  if (type === 'ssh') {
    form.port = 22
    form.authType = 'password'
  } else if (type === 'rdp') {
    form.port = 3389
    form.authType = 'password'
  } else if (type === 'vnc') {
    form.port = 5900
    form.authType = 'password'
  }
}

// 处理分辨率选择变化
const handleResolutionChange = (value: string) => {
  if (value !== 'custom' && value !== 'auto') {
    const [w, h] = value.split('x').map(Number)
    form.rdpCustomWidth = w
    form.rdpCustomHeight = h
  }
}

// 重置表单到默认值
const resetForm = () => {
  const defaults = getDefaultForm()
  Object.keys(defaults).forEach(key => {
    (form as any)[key] = (defaults as any)[key]
  })
}
const sshKeys = ref<any[]>([])

const rules: FormRules = {
  name: [{ required: true, message: '请输入会话名称', trigger: 'blur' }],
  host: [{ required: true, message: '请输入主机地址', trigger: 'blur' }],
  port: [
    { required: true, message: '请输入端口', trigger: 'blur' },
    { type: 'number', min: 1, max: 65535, message: '端口必须在 1-65535 之间', trigger: 'blur' }
  ],
  username: [
    {
      validator: (_rule, value, callback) => {
        // RDP 用户名可选（连接时输入），SSH 必填
        if (form.type === 'ssh' && !value) {
          callback(new Error('请输入用户名'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  password: [
    {
      validator: (_rule, value, callback) => {
        // SSH 密码认证时必填，RDP 密码可选
        if (form.type === 'ssh' && form.authType === 'password' && !value) {
          callback(new Error('请输入密码'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  privateKeyId: [
    {
      validator: (_rule, value, callback) => {
        if (form.type === 'ssh' && form.authType === 'privateKey' && !value && !form.privateKeyPath) {
          callback(new Error('请选择SSH密钥或本地私钥文件'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

// 加载SSH密钥列表
const loadSSHKeys = async () => {
  try {
    const result = await window.electronAPI.sshKey?.getAll?.()
    if (result?.success) {
      sshKeys.value = result.data || []
    }
  } catch (error) {
    console.error('Failed to load SSH keys:', error)
  }
}

// 获取密钥类型颜色
const getKeyTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    rsa: 'primary',
    ed25519: 'success',
    ecdsa: 'warning'
  }
  return colors[type] || 'info'
}

watch(
  () => props.modelValue,
  (newValue) => {
    visible.value = newValue
    if (newValue) {
      // 加载SSH密钥列表
      loadSSHKeys()
      
      if (props.session) {
        isEdit.value = true
        // 手动赋值以正确处理日期格式
        form.type = props.session.type || 'ssh'
        form.name = props.session.name || ''
        form.host = props.session.host || ''
        form.port = props.session.port || (form.type === 'rdp' ? 3389 : 22)
        form.username = props.session.username || ''
        form.authType = props.session.authType || 'password'
        form.password = props.session.password || ''
        form.privateKeyId = props.session.privateKeyId || ''
        form.privateKeyPath = props.session.privateKeyPath || ''
        form.passphrase = props.session.passphrase || ''
        form.groupId = props.session.group || ''
        form.description = (props.session as any).description || ''
        // RDP 选项
        const rdpOpts = props.session.rdpOptions || {}
        form.domain = (rdpOpts as any).domain || ''
        // 显示模式
        if (rdpOpts.multimon) {
          form.rdpDisplayMode = 'multimon'
        } else if (rdpOpts.fullscreen) {
          form.rdpDisplayMode = 'fullscreen'
        } else {
          form.rdpDisplayMode = 'window'
        }
        // 分辨率
        if (rdpOpts.width && rdpOpts.height) {
          const res = `${rdpOpts.width}x${rdpOpts.height}`
          const presets = ['1920x1080', '1680x1050', '1600x900', '1440x900', '1366x768', '1280x720', '1024x768']
          if (presets.includes(res)) {
            form.rdpResolution = res
          } else {
            form.rdpResolution = 'custom'
          }
          form.rdpCustomWidth = rdpOpts.width
          form.rdpCustomHeight = rdpOpts.height
        } else {
          form.rdpResolution = 'auto'
        }
        form.rdpAdmin = rdpOpts.admin || false
        form.rdpDrives = rdpOpts.drives === true
        form.rdpPrinters = rdpOpts.printers || false
        form.rdpClipboard = rdpOpts.clipboard !== false
        form.rdpAudio = rdpOpts.audio || 'local'
        // VNC 选项
        const vncOpts = props.session.vncOptions || {}
        form.vncViewOnly = vncOpts.viewOnly || false
        form.vncShared = vncOpts.sharedConnection !== false
        form.vncLocalCursor = vncOpts.localCursor !== false
        form.vncQuality = vncOpts.quality ?? 6
        form.vncCompression = vncOpts.compression ?? 2
        // 服务器管理字段
        form.provider = props.session.provider || ''
        form.region = props.session.region || ''
        // 将 Date 对象转换为字符串格式
        form.expiryDate = props.session.expiryDate 
          ? (props.session.expiryDate instanceof Date 
            ? props.session.expiryDate.toISOString().slice(0, 19).replace('T', ' ')
            : props.session.expiryDate)
          : null
        form.billingCycle = props.session.billingCycle || ''
        form.billingAmount = props.session.billingAmount
        form.billingCurrency = props.session.billingCurrency || 'CNY'
        form.notes = props.session.notes || ''
        // 跳板机配置
        form.proxyJump = props.session.proxyJump
        // 代理配置
        form.proxy = props.session.proxy
      } else {
        // 新建会话时，重置表单到默认值
        isEdit.value = false
        resetForm()
      }
    }
  }
)

watch(visible, (newValue) => {
  emit('update:modelValue', newValue)
  // 对话框关闭时重置表单
  if (!newValue) {
    // 延迟重置，等待动画完成
    setTimeout(() => {
      resetForm()
      formRef.value?.clearValidate()
      isEdit.value = false
    }, 300)
  }
})

const handleSelectLocalKeyFile = async () => {
  try {
    const filePath = await window.electronAPI.dialog.openFile({
      title: '选择私钥文件',
      filters: [
        { name: 'SSH 密钥', extensions: ['pem', 'key', 'ppk', 'pub'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    
    if (filePath) {
      form.privateKeyPath = filePath
      form.privateKeyId = '' // 清除密钥ID选择
    }
  } catch (error) {
    console.error('Failed to select key file:', error)
  }
}

// 当选择 SSH 密钥时，清除本地文件路径
const handleSSHKeyChange = (keyId: string) => {
  if (keyId) {
    form.privateKeyPath = '' // 清除本地文件路径
  }
}

// 处理跳板机配置更新
const handleProxyJumpUpdate = (config: ProxyJumpConfigType) => {
  form.proxyJump = config.enabled ? config : undefined
}

// 处理代理配置更新
const handleProxyUpdate = (config: ProxyConfigType) => {
  form.proxy = config.enabled ? config : undefined
}

const handleSave = async () => {
  if (!formRef.value) return

  await formRef.value.validate((valid) => {
    if (valid) {
      const sessionData: Partial<SessionConfig> = {
        type: form.type,
        name: form.name,
        host: form.host,
        port: form.port,
        username: form.username,
        authType: form.authType,
        group: form.groupId || undefined,
        description: form.description,
        // 服务器管理字段
        provider: form.provider || undefined,
        region: form.region || undefined,
        expiryDate: form.expiryDate ? new Date(form.expiryDate) : undefined,
        billingCycle: form.billingCycle || undefined,
        billingAmount: form.billingAmount,
        billingCurrency: form.billingCurrency || 'CNY',
        notes: form.notes || undefined
      }

      if (form.type === 'ssh') {
        // SSH 特有配置
        if (form.authType === 'password') {
          sessionData.password = form.password
        } else {
          // 优先使用SSH密钥ID，其次使用本地文件路径
          if (form.privateKeyId) {
            sessionData.privateKeyId = form.privateKeyId
          } else if (form.privateKeyPath) {
            sessionData.privateKeyPath = form.privateKeyPath
          }
          sessionData.passphrase = form.passphrase || undefined
        }
        // 跳板机配置
        sessionData.proxyJump = form.proxyJump
        // 代理配置
        sessionData.proxy = form.proxy
      } else if (form.type === 'rdp') {
        // RDP 特有配置
        sessionData.password = form.password || undefined
        
        // 解析分辨率
        let width: number | undefined
        let height: number | undefined
        if (form.rdpDisplayMode === 'window') {
          if (form.rdpResolution === 'custom') {
            width = form.rdpCustomWidth
            height = form.rdpCustomHeight
          } else if (form.rdpResolution !== 'auto') {
            const [w, h] = form.rdpResolution.split('x').map(Number)
            width = w
            height = h
          }
        }
        
        sessionData.rdpOptions = {
          width,
          height,
          fullscreen: form.rdpDisplayMode === 'fullscreen',
          multimon: form.rdpDisplayMode === 'multimon',
          admin: form.rdpAdmin,
          drives: form.rdpDrives,
          printers: form.rdpPrinters,
          clipboard: form.rdpClipboard,
          audio: form.rdpAudio
        }
      } else if (form.type === 'vnc') {
        // VNC 特有配置
        sessionData.password = form.password || undefined
        sessionData.vncOptions = {
          viewOnly: form.vncViewOnly,
          sharedConnection: form.vncShared,
          localCursor: form.vncLocalCursor,
          quality: form.vncQuality,
          compression: form.vncCompression
        }
      }

      if (isEdit.value && props.session) {
        sessionData.id = props.session.id
      }

      emit('save', sessionData)
      visible.value = false
    }
  })
}

const handleCancel = () => {
  visible.value = false
}
</script>
