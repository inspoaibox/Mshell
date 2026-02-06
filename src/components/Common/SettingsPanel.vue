<template>
  <div class="settings-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h2>设置</h2>
      <div class="header-actions">
        <el-button type="primary" @click="saveSettings">保存设置</el-button>
      </div>
    </div>

    <!-- 设置内容 -->
    <div class="settings-content">
      <el-tabs v-model="activeTab" class="settings-tabs">
        <!-- 通用设置 -->
        <el-tab-pane label="通用" name="general">
          <div class="settings-section">
            <h3>应用设置</h3>
            <el-form label-position="left">
              <el-form-item label="启动时打开">
                <el-switch v-model="settings.general.startWithSystem" />
              </el-form-item>
              <el-form-item label="最小化到托盘">
                <el-switch v-model="settings.general.minimizeToTray" />
              </el-form-item>
              <el-form-item label="关闭时最小化">
                <el-switch v-model="settings.general.closeToTray" />
              </el-form-item>
              <el-form-item label="主题">
                <el-select v-model="settings.general.theme" style="width: 200px">
                  <el-option label="自动" value="auto" />
                  <el-option label="深色" value="dark" />
                  <el-option label="浅色" value="light" />
                </el-select>
              </el-form-item>
              <!-- 语言切换暂时禁用，当前代码大部分为中文硬编码 -->
              <!--
              <el-form-item label="语言">
                <LanguageSwitcher />
              </el-form-item>
              -->
            </el-form>
          </div>
        </el-tab-pane>

        <!-- SFTP设置 -->
        <el-tab-pane label="SFTP" name="sftp">
          <div class="settings-section">
            <h3>传输设置</h3>
            <el-form label-position="left">
              <el-form-item label="默认本地路径">
                <div style="display: flex; gap: 8px; flex: 1;">
                  <el-input v-model="settings.sftp.defaultLocalPath" placeholder="默认下载目录" readonly />
                  <el-button @click="selectDownloadDir">选择</el-button>
                </div>
              </el-form-item>
              <el-form-item label="最大并发数">
                <el-input-number v-model="settings.sftp.maxConcurrentTransfers" :min="1" :max="10" />
              </el-form-item>
              <el-form-item label="显示隐藏文件">
                <el-switch v-model="settings.sftp.showHiddenFiles" />
              </el-form-item>
              <el-form-item label="删除确认">
                <el-switch v-model="settings.sftp.confirmBeforeDelete" />
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 安全设置 -->
        <el-tab-pane label="安全" name="security">
          <div class="settings-section">
            <h3>安全选项</h3>
            <el-form label-position="left">
              <el-form-item label="保存密码">
                <el-switch v-model="settings.security.savePasswords" />
                <span class="form-hint">记住SSH连接密码</span>
              </el-form-item>
              <el-form-item label="验证主机密钥">
                <el-switch v-model="settings.security.verifyHostKey" />
                <span class="form-hint">Strict Host Key Checking</span>
              </el-form-item>
              <el-form-item label="会话超时">
                <el-input-number v-model="settings.security.sessionTimeout" :min="0" :step="5" />
                <span class="form-hint">分钟 (0 表示不超时)</span>
              </el-form-item>
            </el-form>
          </div>

          <!-- 会话锁定 -->
          <div class="settings-section">
            <h3>会话锁定</h3>
            
            <!-- 锁定状态 -->
            <div class="lock-status-inline">
              <div class="status-indicator" :class="{ locked: lockStatus.isLocked }">
                <el-icon :size="24">
                  <Lock v-if="lockStatus.isLocked" />
                  <Unlock v-else />
                </el-icon>
                <span class="status-text">{{ lockStatus.isLocked ? '已锁定' : '未锁定' }}</span>
              </div>
              <el-button 
                v-if="lockConfig.hasPassword && !lockStatus.isLocked" 
                type="primary" 
                size="small"
                @click="lockNow"
              >
                立即锁定
              </el-button>
            </div>

            <el-alert 
              v-if="lockConfig.hasPassword"
              type="info" 
              :closable="false"
              show-icon
              style="margin-bottom: 16px"
            >
              <template #title>
                快捷键 Ctrl+Alt+L 快速锁定会话
              </template>
            </el-alert>

            <el-form label-position="left" style="margin-top: 16px">
              <el-form-item label="启用密码保护">
                <el-switch v-model="lockConfig.hasPassword" @change="handlePasswordToggle" />
              </el-form-item>
              <el-form-item label="自动锁定" v-if="lockConfig.hasPassword">
                <el-switch v-model="lockConfig.autoLockEnabled" @change="saveLockConfig" />
              </el-form-item>
              <el-form-item label="锁定超时" v-if="lockConfig.hasPassword && lockConfig.autoLockEnabled">
                <el-input-number v-model="lockConfig.autoLockTimeout" :min="1" :max="120" @change="saveLockConfig" />
                <span class="form-hint">分钟</span>
              </el-form-item>
              <el-form-item label="关闭到托盘时锁定" v-if="lockConfig.hasPassword">
                <el-switch v-model="lockConfig.lockOnMinimize" @change="saveLockConfig" />
                <span class="form-hint">点击关闭按钮隐藏到托盘时自动锁定</span>
              </el-form-item>
              <el-form-item label="休眠时锁定" v-if="lockConfig.hasPassword">
                <el-switch v-model="lockConfig.lockOnSuspend" @change="saveLockConfig" />
              </el-form-item>
            </el-form>

            <!-- 密码管理 -->
            <div v-if="lockConfig.hasPassword" style="margin-top: 16px">
              <el-button @click="showChangePasswordDialog = true" size="small">修改密码</el-button>
              <el-button type="danger" @click="removePassword" size="small">移除密码</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- 终端设置 -->
        <el-tab-pane label="终端" name="terminal">
          <div class="settings-section">
            <h3>终端外观</h3>
            <el-form label-position="left">
              <el-form-item label="字体大小">
                <el-slider 
                  v-model="settings.terminal.fontSize" 
                  :min="10" 
                  :max="24"
                  :step="1"
                  show-input
                  style="width: 300px"
                />
              </el-form-item>
              <el-form-item label="字体">
                <el-select v-model="settings.terminal.fontFamily" style="width: 300px">
                  <el-option label="JetBrains Mono" value="'JetBrains Mono', monospace" />
                  <el-option label="Fira Code" value="'Fira Code', monospace" />
                  <el-option label="Cascadia Code" value="'Cascadia Code', monospace" />
                  <el-option label="Source Code Pro" value="'Source Code Pro', monospace" />
                  <el-option label="Consolas" value="Consolas, monospace" />
                  <el-option label="Courier New" value="'Courier New', monospace" />
                  <el-option label="Lucida Console" value="'Lucida Console', monospace" />
                  <el-option label="Monaco" value="Monaco, monospace" />
                </el-select>
              </el-form-item>
              <el-form-item label="配色方案">
                <el-select v-model="settings.terminal.theme" style="width: 300px">
                  <el-option 
                    v-for="(theme, key) in themes" 
                    :key="key" 
                    :label="theme.name" 
                    :value="key" 
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="光标样式">
                <el-radio-group v-model="settings.terminal.cursorStyle">
                  <el-radio value="block">方块</el-radio>
                  <el-radio value="underline">下划线</el-radio>
                  <el-radio value="bar">竖线</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="光标闪烁">
                <el-switch v-model="settings.terminal.cursorBlink" />
              </el-form-item>
              <el-form-item label="渲染类型">
                <el-select v-model="settings.terminal.rendererType" style="width: 200px">
                  <el-option label="自动" value="auto" />
                  <el-option label="WebGL (推荐)" value="webgl" />
                  <el-option label="Canvas" value="canvas" />
                  <el-option label="DOM (慢 兼容性好)" value="dom" />
                </el-select>
              </el-form-item>
              <el-form-item label="滚动行数">
                <el-input-number 
                  v-model="settings.terminal.scrollback"  
                  :min="1000" 
                  :max="50000"
                  :step="1000"
                />
              </el-form-item>
              <el-form-item label="选中自动复制">
                <el-switch v-model="settings.terminal.copyOnSelect" />
                <span class="form-hint">选中终端文本时自动复制到剪贴板</span>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- SSH设置 -->
        <el-tab-pane label="SSH" name="ssh">
          <div class="settings-section">
            <h3>连接设置</h3>
            <el-form label-position="left">
              <el-form-item label="连接超时">
                <el-input-number 
                  v-model="settings.ssh.timeout" 
                  :min="5" 
                  :max="120"
                  :step="5"
                />
                <span class="form-hint">秒</span>
              </el-form-item>
              <el-form-item label="保持连接">
                <el-switch v-model="settings.ssh.keepalive" />
              </el-form-item>
              <el-form-item label="保持间隔">
                <el-input-number 
                  v-model="settings.ssh.keepaliveInterval" 
                  :min="10" 
                  :max="300"
                  :step="10"
                  :disabled="!settings.ssh.keepalive"
                />
                <span class="form-hint">秒</span>
              </el-form-item>
            </el-form>
          </div>
          
          <div class="settings-section">
            <h3>断线重连</h3>
            <el-form label-position="left">
              <el-form-item label="自动重连">
                <el-switch v-model="settings.ssh.autoReconnect" />
                <span class="form-hint">连接断开时自动尝试重连</span>
              </el-form-item>
              <el-form-item label="最大重连次数">
                <el-input-number 
                  v-model="settings.ssh.maxReconnectAttempts" 
                  :min="1" 
                  :max="10"
                  :disabled="!settings.ssh.autoReconnect"
                />
                <span class="form-hint">次</span>
              </el-form-item>
              <el-form-item label="重连间隔">
                <el-input-number 
                  v-model="settings.ssh.reconnectInterval" 
                  :min="1" 
                  :max="60"
                  :disabled="!settings.ssh.autoReconnect"
                />
                <span class="form-hint">秒</span>
              </el-form-item>
            </el-form>
          </div>
          
          <div class="settings-section">
            <h3>命令智能</h3>
            <el-form label-position="left">
              <el-form-item label="命令补全">
                <el-switch v-model="settings.ssh.commandAutocomplete" />
                <span class="form-hint">快捷命令和历史命令自动补全</span>
              </el-form-item>
              <el-form-item label="AI 命令建议">
                <el-switch v-model="settings.ssh.aiCommandSuggest" />
                <span class="form-hint">输入 # 后使用 AI 生成命令建议</span>
              </el-form-item>
              <el-form-item label="命令解释">
                <el-switch v-model="settings.ssh.commandExplain" />
                <span class="form-hint">输入 ?命令 或 命令? 查看命令解释</span>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 主题设置 -->
        <el-tab-pane label="主题" name="themes">
          <div class="settings-section">
            <h3>主题管理</h3>
            <div class="theme-list">
              <div
                v-for="(theme, key) in availableThemes"
                :key="key"
                :class="['theme-item', { active: currentTheme === key }]"
                @click="applyTheme(key)"
              >
                <div class="theme-preview" :style="getThemePreviewStyle(theme)">
                  <div class="preview-header"></div>
                  <div class="preview-content"></div>
                </div>
                <div class="theme-info">
                  <div class="theme-name">{{ theme.name }}</div>
                  <div class="theme-type">{{ key.includes('light') ? '浅色' : '深色' }}</div>
                </div>
                <div v-if="currentTheme === key" class="theme-check">✓</div>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 备份与恢复 -->
        <el-tab-pane label="备份" name="backup">
          <div class="settings-section">
            <h3>自动备份</h3>
            <el-form label-position="left">
              <el-form-item label="启用自动备份">
                <el-switch v-model="backupConfig.enabled" @change="saveBackupConfig" />
              </el-form-item>
              <el-form-item label="自动备份密码">
                <el-input 
                  v-model="backupConfig.autoBackupPassword" 
                  type="password"
                  placeholder="设置自动备份的加密密码"
                  show-password
                  :disabled="!backupConfig.enabled"
                  @change="saveBackupConfig"
                  style="max-width: 300px"
                />
                <span class="form-hint" style="margin-left: 8px;">恢复自动备份时需要此密码</span>
              </el-form-item>
              <el-form-item label="备份目录">
                <div style="display: flex; gap: 8px; flex: 1;">
                  <el-input 
                    v-model="backupConfig.backupDir" 
                    placeholder="默认：应用数据目录/backups"
                    readonly
                  />
                  <el-button @click="selectBackupDir">选择</el-button>
                </div>
              </el-form-item>
              <el-form-item label="备份间隔">
                <el-select 
                  v-model="backupConfig.interval" 
                  style="width: 200px"
                  :disabled="!backupConfig.enabled"
                  @change="saveBackupConfig"
                >
                  <el-option label="每6小时" :value="6" />
                  <el-option label="每12小时" :value="12" />
                  <el-option label="每24小时" :value="24" />
                  <el-option label="每48小时" :value="48" />
                  <el-option label="每周" :value="168" />
                </el-select>
              </el-form-item>
              <el-form-item label="保留备份数">
                <el-input-number 
                  v-model="backupConfig.maxBackups" 
                  :min="1" 
                  :max="50"
                  :disabled="!backupConfig.enabled"
                  @change="saveBackupConfig"
                />
              </el-form-item>
              <el-form-item label="最后备份">
                <span class="form-hint">{{ formatBackupTime(backupConfig.lastBackup) }}</span>
              </el-form-item>
            </el-form>
          </div>

          <div class="settings-section">
            <h3>手动备份</h3>
            <div class="backup-actions">
              <el-button type="primary" :icon="Download" @click="showCreateBackupDialog = true">
                创建备份
              </el-button>
              <el-button type="success" :icon="Upload" @click="showRestoreBackupDialog = true">
                恢复备份
              </el-button>
            </div>
          </div>

          <div class="settings-section">
            <h3>备份历史</h3>
            <el-table :data="backupList" style="width: 100%" max-height="300">
              <el-table-column prop="name" label="文件名" min-width="200" />
              <el-table-column label="大小" width="100">
                <template #default="{ row }">
                  {{ formatFileSize(row.size) }}
                </template>
              </el-table-column>
              <el-table-column label="日期" width="180">
                <template #default="{ row }">
                  {{ formatDate(row.date) }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button 
                    type="primary" 
                    link 
                    size="small"
                    @click="restoreFromHistory(row)"
                  >
                    恢复
                  </el-button>
                  <el-button 
                    type="danger" 
                    link 
                    size="small"
                    @click="deleteBackup(row)"
                  >
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- 快捷键设置 -->
        <el-tab-pane label="快捷键" name="shortcuts">
          <div class="settings-section">
            <h3>全局快捷键</h3>
            
            <!-- 快捷键状态指示 -->
            <el-alert 
              type="info" 
              :closable="false"
              show-icon
              style="margin-bottom: 16px"
            >
              <template #title>
                快捷键系统状态: <span style="color: var(--success-color); font-weight: 600;">已启用</span>
                <el-button 
                  type="primary" 
                  link 
                  size="small" 
                  @click="testShortcuts"
                  style="margin-left: 12px"
                >
                  测试快捷键
                </el-button>
              </template>
            </el-alert>
            
            <!-- 调试信息 -->
            <div v-if="Object.keys(shortcuts).length === 0" style="padding: 20px; text-align: center; color: #999;">
              <p>正在加载快捷键配置...</p>
              <el-button @click="loadShortcuts" size="small">重新加载</el-button>
            </div>
            <div class="shortcuts-list" v-else>
              <div v-for="(shortcut, id) in shortcuts" :key="id" class="shortcut-item">
                <div class="shortcut-info">
                  <span class="shortcut-name">{{ shortcut.description }}</span>
                  <span class="shortcut-key">{{ formatShortcutKey(shortcut) }}</span>
                </div>
                <div class="shortcut-actions">
                  <el-button size="small" @click="editShortcut(id, shortcut)">
                    修改
                  </el-button>
                  <el-button size="small" @click="resetShortcut(id)">
                    重置
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- 终端快捷键 -->
          <div class="settings-section">
            <h3>终端快捷键</h3>
            <el-alert 
              type="info" 
              :closable="false"
              show-icon
              style="margin-bottom: 16px"
            >
              <template #title>
                以下快捷键仅在终端窗口中生效
              </template>
            </el-alert>
            
            <div class="shortcuts-list">
              <div v-for="(shortcut, id) in terminalShortcuts" :key="id" class="shortcut-item">
                <div class="shortcut-info">
                  <span class="shortcut-name">{{ shortcut.description }}</span>
                  <span class="shortcut-key">{{ formatTerminalShortcutKey(id) }}</span>
                </div>
                <div class="shortcut-actions">
                  <el-button size="small" @click="editTerminalShortcut(id, shortcut)">
                    修改
                  </el-button>
                  <el-button size="small" @click="resetTerminalShortcut(id)">
                    重置
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>快捷键说明</h3>
            <el-alert type="info" :closable="false">
              <template #title>
                <ul class="shortcut-tips">
                  <li>某些快捷键（如 Ctrl+F, Ctrl+W）在输入框中也会生效</li>
                  <li>快捷键修改后立即生效，无需重启应用</li>
                  <li>如果快捷键冲突，可以自定义修改</li>
                </ul>
              </template>
            </el-alert>
          </div>
        </el-tab-pane>

        <!-- 更新设置 -->
        <el-tab-pane label="更新" name="updates">
          <div class="settings-section">
            <h3>版本更新</h3>
            <el-form label-position="left">
              <el-form-item label="当前版本">
                <span class="version-text">{{ appVersion }}</span>
              </el-form-item>
              
              <el-form-item label="启动时自动检查更新">
                <el-switch v-model="settings.updates.autoCheck" @change="saveSettings" />
              </el-form-item>
              
              <el-form-item label="检查更新">
                <el-button 
                  type="primary" 
                  :loading="updateState.checking"
                  @click="checkForUpdates"
                >
                  {{ updateState.checking ? '检查中...' : '检查更新' }}
                </el-button>
              </el-form-item>
              
              <!-- 更新状态显示 -->
              <div v-if="updateState.status" class="update-status">
                <!-- 有新版本 -->
                <template v-if="updateState.status === 'available'">
                  <el-alert 
                    type="success" 
                    :closable="false"
                    show-icon
                  >
                    <template #title>
                      发现新版本 {{ updateState.newVersion }}
                    </template>
                    <template #default>
                      <div v-if="updateState.releaseNotes" class="release-notes">
                        <div v-html="updateState.releaseNotes"></div>
                      </div>
                      <div class="update-actions">
                        <el-button 
                          type="primary" 
                          size="small"
                          :loading="updateState.downloading"
                          @click="downloadUpdate"
                        >
                          {{ updateState.downloading ? '下载中...' : '下载更新' }}
                        </el-button>
                      </div>
                    </template>
                  </el-alert>
                </template>
                
                <!-- 下载进度 -->
                <template v-if="updateState.status === 'downloading'">
                  <el-alert type="info" :closable="false" show-icon>
                    <template #title>正在下载更新...</template>
                    <template #default>
                      <el-progress 
                        :percentage="updateState.progress" 
                        :format="formatProgress"
                      />
                      <div class="download-info">
                        {{ formatBytes(updateState.transferred) }} / {{ formatBytes(updateState.total) }}
                        ({{ formatBytes(updateState.bytesPerSecond) }}/s)
                      </div>
                    </template>
                  </el-alert>
                </template>
                
                <!-- 下载完成 -->
                <template v-if="updateState.status === 'downloaded'">
                  <el-alert type="success" :closable="false" show-icon>
                    <template #title>更新已下载完成</template>
                    <template #default>
                      <p>新版本 {{ updateState.newVersion }} 已准备就绪</p>
                      <el-button type="primary" size="small" @click="installUpdate">
                        立即安装并重启
                      </el-button>
                    </template>
                  </el-alert>
                </template>
                
                <!-- 已是最新版本 -->
                <template v-if="updateState.status === 'up-to-date'">
                  <el-alert type="info" :closable="false" show-icon>
                    <template #title>已是最新版本</template>
                  </el-alert>
                </template>
                
                <!-- 更新错误 -->
                <template v-if="updateState.status === 'error'">
                  <el-alert type="error" :closable="false" show-icon>
                    <template #title>检查更新失败</template>
                    <template #default>
                      {{ updateState.error }}
                    </template>
                  </el-alert>
                </template>
              </div>
              
              <el-form-item label="查看所有版本">
                <el-link 
                  type="primary" 
                  href="https://github.com/inspoaibox/Mshell/releases" 
                  target="_blank"
                >
                  https://github.com/inspoaibox/Mshell/releases
                </el-link>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 云同步 -->
        <el-tab-pane label="同步" name="sync">
          <el-tabs v-model="syncActiveTab" class="sync-tabs">
            <!-- GitHub 同步 -->
            <el-tab-pane label="GitHub" name="github">
              <div class="settings-section">
                <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
                  <template #title>
                    通过 GitHub Gist 同步数据到云端，支持多设备同步
                  </template>
                </el-alert>
                
                <el-form label-position="left">
                  <!-- 未连接状态 -->
                  <template v-if="!syncConfig.github?.token">
                    <el-form-item label="GitHub Token">
                      <div style="display: flex; gap: 8px; flex: 1;">
                        <el-input 
                          v-model="githubTokenInput" 
                          type="password"
                          placeholder="输入 GitHub Personal Access Token"
                          show-password
                          style="flex: 1;"
                        />
                        <el-button 
                          type="primary" 
                          :loading="syncState.verifying"
                          @click="verifyAndConnectGitHub"
                        >
                          连接
                        </el-button>
                      </div>
                    </el-form-item>
                    <el-form-item>
                      <el-link 
                        type="primary" 
                        href="https://github.com/settings/tokens/new?scopes=gist&description=MShell%20Sync" 
                        target="_blank"
                      >
                        创建 Token (需要 gist 权限)
                      </el-link>
                    </el-form-item>
                  </template>
                  
                  <!-- 已连接状态 -->
                  <template v-else>
                    <el-form-item label="连接状态">
                      <el-tag type="success">已连接</el-tag>
                      <span style="margin-left: 8px; color: var(--text-secondary);">
                        {{ syncConfig.github.username || 'GitHub' }}
                      </span>
                    </el-form-item>
                    
                    <el-form-item label="同步加密密码">
                      <el-input 
                        v-model="syncConfig.encryptionPassword" 
                        type="password"
                        placeholder="设置加密密码保护同步数据"
                        show-password
                        @change="saveSyncConfig"
                        style="max-width: 300px;"
                      />
                      <span class="form-hint">必填，用于加密云端数据</span>
                    </el-form-item>
                    
                    <el-form-item label="启用同步">
                      <el-switch 
                        v-model="syncConfig.enabled" 
                        :disabled="!syncConfig.encryptionPassword || syncConfig.provider !== 'github'"
                        @change="onGitHubSyncToggle" 
                      />
                    </el-form-item>
                    
                    <el-form-item label="自动同步" v-if="syncConfig.enabled && syncConfig.provider === 'github'">
                      <el-switch v-model="syncConfig.autoSync" @change="saveSyncConfig" />
                    </el-form-item>
                    
                    <el-form-item label="同步间隔" v-if="syncConfig.enabled && syncConfig.autoSync && syncConfig.provider === 'github'">
                      <el-select v-model="syncConfig.syncInterval" style="width: 150px" @change="saveSyncConfig">
                        <el-option label="15 分钟" :value="15" />
                        <el-option label="30 分钟" :value="30" />
                        <el-option label="1 小时" :value="60" />
                        <el-option label="2 小时" :value="120" />
                      </el-select>
                    </el-form-item>
                    
                    <el-form-item label="上次同步" v-if="syncConfig.provider === 'github'">
                      <span class="form-hint">{{ formatSyncTime(syncConfig.lastSync) }}</span>
                    </el-form-item>
                    
                    <el-form-item label="Gist 地址" v-if="syncConfig.github?.gistUrl">
                      <el-link type="primary" :href="syncConfig.github.gistUrl" target="_blank">
                        {{ syncConfig.github.gistUrl }}
                      </el-link>
                    </el-form-item>
                    
                    <el-form-item label="操作" v-if="syncConfig.provider === 'github'">
                      <div style="display: flex; gap: 8px;">
                        <el-button 
                          type="primary" 
                          :loading="syncState.syncing"
                          :disabled="!syncConfig.encryptionPassword"
                          @click="doSync"
                        >
                          立即同步
                        </el-button>
                        <el-button 
                          :loading="syncState.uploading"
                          :disabled="!syncConfig.encryptionPassword"
                          @click="doUpload"
                        >
                          上传到云端
                        </el-button>
                        <el-button 
                          :loading="syncState.downloading"
                          :disabled="!syncConfig.encryptionPassword || !syncConfig.github?.gistId"
                          @click="doDownload"
                        >
                          从云端下载
                        </el-button>
                      </div>
                    </el-form-item>
                    
                    <el-form-item>
                      <el-button type="danger" text @click="disconnectGitHub">
                        断开 GitHub 连接
                      </el-button>
                    </el-form-item>
                  </template>
                </el-form>
              </div>
            </el-tab-pane>
            
            <!-- GitLab 同步 -->
            <el-tab-pane label="GitLab" name="gitlab">
              <div class="settings-section">
                <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
                  <template #title>
                    通过 GitLab Snippet 同步数据到云端，支持自托管 GitLab
                  </template>
                </el-alert>
                
                <el-form label-position="left">
                  <!-- 未连接状态 -->
                  <template v-if="!syncConfig.gitlab?.token">
                    <el-form-item label="GitLab 地址">
                      <el-input 
                        v-model="gitlabInstanceUrl" 
                        placeholder="https://gitlab.com"
                        style="max-width: 300px;"
                      />
                      <span class="form-hint">自托管 GitLab 请填写完整地址</span>
                    </el-form-item>
                    <el-form-item label="GitLab Token">
                      <div style="display: flex; gap: 8px; flex: 1;">
                        <el-input 
                          v-model="gitlabTokenInput" 
                          type="password"
                          placeholder="输入 GitLab Personal Access Token"
                          show-password
                          style="flex: 1;"
                        />
                        <el-button 
                          type="primary" 
                          :loading="syncState.verifyingGitLab"
                          @click="verifyAndConnectGitLab"
                        >
                          连接
                        </el-button>
                      </div>
                    </el-form-item>
                    <el-form-item>
                      <el-link 
                        type="primary" 
                        :href="(gitlabInstanceUrl || 'https://gitlab.com') + '/-/user_settings/personal_access_tokens?name=MShell%20Sync&scopes=api'"
                        target="_blank"
                      >
                        创建 Token (需要 api 权限)
                      </el-link>
                    </el-form-item>
                  </template>
                  
                  <!-- 已连接状态 -->
                  <template v-else>
                    <el-form-item label="连接状态">
                      <el-tag type="success">已连接</el-tag>
                      <span style="margin-left: 8px; color: var(--text-secondary);">
                        {{ syncConfig.gitlab.username || 'GitLab' }}
                        <span v-if="syncConfig.gitlab.instanceUrl && syncConfig.gitlab.instanceUrl !== 'https://gitlab.com'">
                          ({{ syncConfig.gitlab.instanceUrl }})
                        </span>
                      </span>
                    </el-form-item>
                    
                    <el-form-item label="同步加密密码">
                      <el-input 
                        v-model="syncConfig.encryptionPassword" 
                        type="password"
                        placeholder="设置加密密码保护同步数据"
                        show-password
                        @change="saveSyncConfig"
                        style="max-width: 300px;"
                      />
                      <span class="form-hint">必填，用于加密云端数据</span>
                    </el-form-item>
                    
                    <el-form-item label="启用同步">
                      <el-switch 
                        v-model="syncConfig.enabled" 
                        :disabled="!syncConfig.encryptionPassword || syncConfig.provider !== 'gitlab'"
                        @change="onGitLabSyncToggle" 
                      />
                    </el-form-item>
                    
                    <el-form-item label="自动同步" v-if="syncConfig.enabled && syncConfig.provider === 'gitlab'">
                      <el-switch v-model="syncConfig.autoSync" @change="saveSyncConfig" />
                    </el-form-item>
                    
                    <el-form-item label="同步间隔" v-if="syncConfig.enabled && syncConfig.autoSync && syncConfig.provider === 'gitlab'">
                      <el-select v-model="syncConfig.syncInterval" style="width: 150px" @change="saveSyncConfig">
                        <el-option label="15 分钟" :value="15" />
                        <el-option label="30 分钟" :value="30" />
                        <el-option label="1 小时" :value="60" />
                        <el-option label="2 小时" :value="120" />
                      </el-select>
                    </el-form-item>
                    
                    <el-form-item label="上次同步" v-if="syncConfig.provider === 'gitlab'">
                      <span class="form-hint">{{ formatSyncTime(syncConfig.lastSync) }}</span>
                    </el-form-item>
                    
                    <el-form-item label="Snippet 地址" v-if="syncConfig.gitlab?.snippetUrl">
                      <el-link type="primary" :href="syncConfig.gitlab.snippetUrl" target="_blank">
                        {{ syncConfig.gitlab.snippetUrl }}
                      </el-link>
                    </el-form-item>
                    
                    <el-form-item label="操作" v-if="syncConfig.provider === 'gitlab'">
                      <div style="display: flex; gap: 8px;">
                        <el-button 
                          type="primary" 
                          :loading="syncState.syncing"
                          :disabled="!syncConfig.encryptionPassword"
                          @click="doSync"
                        >
                          立即同步
                        </el-button>
                        <el-button 
                          :loading="syncState.uploadingGitLab"
                          :disabled="!syncConfig.encryptionPassword"
                          @click="doUploadGitLab"
                        >
                          上传到云端
                        </el-button>
                        <el-button 
                          :loading="syncState.downloadingGitLab"
                          :disabled="!syncConfig.encryptionPassword || !syncConfig.gitlab?.snippetId"
                          @click="doDownloadGitLab"
                        >
                          从云端下载
                        </el-button>
                      </div>
                    </el-form-item>
                    
                    <el-form-item>
                      <el-button type="danger" text @click="disconnectGitLab">
                        断开 GitLab 连接
                      </el-button>
                    </el-form-item>
                  </template>
                </el-form>
              </div>
            </el-tab-pane>
          </el-tabs>
          
          <div class="settings-section" style="margin-top: 16px;">
            <h3>同步说明</h3>
            <el-alert type="warning" :closable="false">
              <template #title>
                <ul style="margin: 0; padding-left: 16px;">
                  <li>同步数据会加密后存储在你的私有 Gist/Snippet 中</li>
                  <li>SSH 私钥会加密同步，请确保使用强加密密码</li>
                  <li>请妥善保管加密密码，丢失后无法恢复云端数据</li>
                  <li>建议定期使用本地备份功能作为额外保障</li>
                  <li>同一时间只能启用一个同步平台</li>
                </ul>
              </template>
            </el-alert>
          </div>
        </el-tab-pane>

        <!-- AI 助手 -->
        <el-tab-pane label="AI 助手" name="ai">
          <AISettingsPanel ref="aiSettingsPanelRef" />
        </el-tab-pane>

        <!-- 关于 -->
        <el-tab-pane label="关于" name="about">          <div class="settings-section about-section">
            <div class="app-info">
              <div class="app-logo">
                <img :src="logoImg" alt="MShell Logo" class="logo-image" />
              </div>
              <h2>MShell</h2>
              <p class="version">版本 {{ appVersion }}</p>
              <p class="description">专业的SSH客户端</p>
            </div>
            
            <div class="info-grid">
              <div class="info-item">
                <label>开发者</label>
                <span>MShell Team</span>
              </div>
              <div class="info-item">
                <label>许可证</label>
                <span>MIT License</span>
              </div>
              <div class="info-item">
                <label>GitHub</label>
                <a href="https://github.com/inspoaibox/Mshell" target="_blank">https://github.com/inspoaibox/Mshell</a>
              </div>
              <div class="info-item">
                <label>反馈</label>
                <a href="https://github.com/inspoaibox/Mshell/issues" target="_blank">GitHub Issues</a>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 编辑快捷键对话框 -->
    <el-dialog v-model="showEditShortcutDialog" title="编辑快捷键" width="500px">
      <el-form label-position="top">
        <el-form-item label="功能">
          <el-input v-model="editingShortcut.description" disabled />
        </el-form-item>
        <el-form-item label="快捷键">
          <div class="shortcut-input">
            <el-input 
              v-model="editingShortcutKey" 
              placeholder="按下快捷键组合..."
              readonly
              @keydown="captureShortcut"
            />
            <el-button @click="clearShortcutInput">清除</el-button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-checkbox-group v-model="editingModifiers">
            <el-checkbox label="ctrl">Ctrl</el-checkbox>
            <el-checkbox label="alt">Alt</el-checkbox>
            <el-checkbox label="shift">Shift</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-alert 
          v-if="shortcutConflict"
          type="warning" 
          :closable="false"
          show-icon
        >
          <template #title>
            该快捷键已被占用: {{ shortcutConflict }}
          </template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="showEditShortcutDialog = false">取消</el-button>
        <el-button type="primary" @click="saveShortcut" :disabled="!!shortcutConflict">
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 编辑终端快捷键对话框 -->
    <el-dialog v-model="showEditTerminalShortcutDialog" title="编辑终端快捷键" width="500px">
      <el-form label-position="top">
        <el-form-item label="功能">
          <el-input :model-value="editingTerminalShortcut.description" disabled />
        </el-form-item>
        <el-form-item label="快捷键">
          <div class="shortcut-input">
            <el-input 
              v-model="editingTerminalShortcutKey" 
              placeholder="按下快捷键组合..."
              readonly
              @keydown="captureTerminalShortcut"
            />
            <el-button @click="clearTerminalShortcutInput">清除</el-button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-checkbox-group v-model="editingTerminalModifiers">
            <el-checkbox label="ctrl">Ctrl</el-checkbox>
            <el-checkbox label="alt">Alt</el-checkbox>
            <el-checkbox label="shift">Shift</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-alert 
          v-if="terminalShortcutConflict"
          type="warning" 
          :closable="false"
          show-icon
        >
          <template #title>
            该快捷键已被占用: {{ terminalShortcutConflict }}
          </template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="showEditTerminalShortcutDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTerminalShortcut" :disabled="!!terminalShortcutConflict">
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 创建备份对话框 -->
    <el-dialog v-model="showCreateBackupDialog" title="创建备份" width="500px">
      <el-form label-position="top">
        <el-form-item label="备份密码">
          <el-input 
            v-model="backupPassword" 
            type="password" 
            placeholder="请输入备份密码（用于加密数据）"
            show-password
          />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input 
            v-model="backupPasswordConfirm" 
            type="password" 
            placeholder="请再次输入密码"
            show-password
          />
        </el-form-item>
        <el-alert 
          type="warning" 
          :closable="false"
          show-icon
          style="margin-bottom: 12px;"
        >
          <template #title>
            备份将包含所有数据，包括SSH私钥文件
          </template>
        </el-alert>
        <el-alert 
          type="info" 
          :closable="false"
          show-icon
        >
          <template #title>
            请妥善保管备份密码和备份文件，丢失后将无法恢复数据
          </template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="showCreateBackupDialog = false">取消</el-button>
        <el-button type="primary" @click="createBackup" :loading="backupLoading">
          创建备份
        </el-button>
      </template>
    </el-dialog>

    <!-- 恢复备份对话框 -->
    <el-dialog v-model="showRestoreBackupDialog" title="恢复备份" width="600px">
      <el-form label-position="top" v-if="!restoreBackupData">
        <el-form-item label="备份文件">
          <div style="display: flex; gap: 8px;">
            <el-input 
              v-model="restoreFilePath" 
              placeholder="选择备份文件"
              readonly
            />
            <el-button @click="selectRestoreFile">浏览</el-button>
          </div>
        </el-form-item>
        <el-form-item label="备份密码">
          <el-input 
            v-model="restorePassword" 
            type="password" 
            placeholder="请输入备份密码"
            show-password
          />
        </el-form-item>
      </el-form>

      <div v-if="restoreBackupData" class="restore-options">
        <h4>选择要恢复的数据</h4>
        <el-checkbox-group v-model="restoreOptions">
          <el-checkbox label="sessions">
            SSH会话 ({{ restoreBackupData.sessions?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="snippets">
            命令片段 ({{ restoreBackupData.snippets?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="commandHistory">
            命令历史 ({{ restoreBackupData.commandHistory?.length || 0 }} 条)
          </el-checkbox>
          <el-checkbox label="sshKeys">
            SSH密钥 ({{ restoreBackupData.sshKeys?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="portForwards">
            端口转发 ({{ (restoreBackupData.portForwards?.length || 0) + (restoreBackupData.portForwardTemplates?.length || 0) }} 个)
          </el-checkbox>
          <el-checkbox label="sessionTemplates">
            会话模板 ({{ restoreBackupData.sessionTemplates?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="scheduledTasks">
            任务调度 ({{ restoreBackupData.scheduledTasks?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="workflows">
            工作流 ({{ restoreBackupData.workflows?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="settings">应用设置</el-checkbox>
          <el-checkbox label="aiConfig" :disabled="!restoreBackupData.aiConfig">
            AI 配置 {{ restoreBackupData.aiConfig ? '✓' : '(无)' }}
          </el-checkbox>
          <el-checkbox label="aiChatHistory" :disabled="!restoreBackupData.aiChatHistory && !restoreBackupData.aiTerminalChatHistory">
            AI 聊天历史 ({{ restoreBackupData.aiChatHistory?.length || 0 }} 条{{ restoreBackupData.aiTerminalChatHistory ? `, ${Object.keys(restoreBackupData.aiTerminalChatHistory).length} 个终端` : '' }})
          </el-checkbox>
          <el-checkbox label="connectionStats" :disabled="!restoreBackupData.connectionStats">
            连接统计 ({{ restoreBackupData.connectionStats?.length || 0 }} 条)
          </el-checkbox>
          <el-checkbox label="auditLogs" :disabled="!restoreBackupData.auditLogs">
            审计日志 ({{ restoreBackupData.auditLogs?.length || 0 }} 条)
          </el-checkbox>
          <el-checkbox label="transferRecords" :disabled="!restoreBackupData.transferRecords">
            传输记录 ({{ restoreBackupData.transferRecords?.length || 0 }} 条)
          </el-checkbox>
          <el-checkbox label="lockConfig" :disabled="!restoreBackupData.lockConfig">
            锁定配置 {{ restoreBackupData.lockConfig ? '✓' : '(无)' }}
          </el-checkbox>
        </el-checkbox-group>
        <el-alert 
          type="info" 
          :closable="false"
          show-icon
          style="margin-top: 16px;"
        >
          <template #title>
            备份版本: {{ restoreBackupData.version }}<br/>
            备份时间: {{ formatDate(restoreBackupData.timestamp) }}
          </template>
        </el-alert>
      </div>

      <template #footer>
        <el-button @click="cancelRestore">取消</el-button>
        <el-button 
          v-if="!restoreBackupData"
          type="primary" 
          @click="loadBackupFile" 
          :loading="backupLoading"
        >
          加载备份
        </el-button>
        <el-button 
          v-else
          type="primary" 
          @click="applyRestore" 
          :loading="backupLoading"
        >
          恢复数据
        </el-button>
      </template>
    </el-dialog>
  </div>

  <!-- 设置密码对话框 -->
  <el-dialog 
    v-model="showSetPasswordDialog" 
    title="设置密码" 
    width="400px"
    @close="handleSetPasswordDialogClose"
  >
    <el-form label-width="80px">
      <el-form-item label="新密码">
        <el-input v-model="newPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="确认密码">
        <el-input v-model="confirmPassword" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="cancelSetPassword">取消</el-button>
      <el-button type="primary" @click="setPassword">确定</el-button>
    </template>
  </el-dialog>

  <!-- 修改密码对话框 -->
  <el-dialog v-model="showChangePasswordDialog" title="修改密码" width="400px">
    <el-form label-width="80px">
      <el-form-item label="当前密码">
        <el-input v-model="currentPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="newPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="确认密码">
        <el-input v-model="confirmPassword" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showChangePasswordDialog = false">取消</el-button>
      <el-button type="primary" @click="changePassword">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, toRaw, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Upload, Refresh, Plus, Edit, Lock, Unlock } from '@element-plus/icons-vue'
import { themes } from '@/utils/terminal-themes'
import { keyboardShortcutManager, type ShortcutConfig } from '@/utils/keyboard-shortcuts'
import { terminalShortcutsManager, type TerminalShortcut, type TerminalShortcutsConfig } from '@/utils/terminal-shortcuts'
import LanguageSwitcher from './LanguageSwitcher.vue'
import AISettingsPanel from '../AI/AISettingsPanel.vue'
import logoImg from '@/assets/logo.png'

// AI 设置面板引用
const aiSettingsPanelRef = ref<InstanceType<typeof AISettingsPanel> | null>(null)

const activeTab = ref('general')

// 主题相关状态
const availableThemes = themes
const currentTheme = ref('dark')

const settings = ref({
  general: {
    startWithSystem: false,
    minimizeToTray: true,
    closeToTray: false,
    language: 'zh-CN',
    theme: 'dark' as 'light' | 'dark' | 'auto'
  },
  terminal: {
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    cursorStyle: 'block' as 'block' | 'underline' | 'bar',
    cursorBlink: true,
    scrollback: 10000,
    theme: 'dark',
    rendererType: 'auto' as 'auto' | 'webgl' | 'canvas' | 'dom',
    copyOnSelect: false
  },
  ssh: {
    timeout: 30,
    keepalive: true,
    keepaliveInterval: 60,
    autoReconnect: true,
    maxReconnectAttempts: 3,
    reconnectInterval: 5,
    commandAutocomplete: true,
    aiCommandSuggest: true,
    commandExplain: true
  },
  sftp: {
    maxConcurrentTransfers: 3,
    defaultLocalPath: '',
    confirmBeforeDelete: true,
    showHiddenFiles: false
  },
  security: {
    savePasswords: true,
    sessionTimeout: 0,
    verifyHostKey: true
  },
  updates: {
    autoCheck: true,
    autoDownload: false
  }
})

// 会话锁定相关状态
const lockConfig = ref({
  hasPassword: false,
  autoLockEnabled: false,
  autoLockTimeout: 15,
  lockOnMinimize: false,
  lockOnSuspend: false
})

const lockStatus = ref({
  isLocked: false,
  hasPassword: false
})

const showSetPasswordDialog = ref(false)
const showChangePasswordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

// 备份相关状态
const backupConfig = ref({
  enabled: false,
  interval: 24,
  maxBackups: 10,
  backupDir: '',
  lastBackup: undefined as string | undefined,
  autoBackupPassword: '' // 自动备份密码
})

const backupList = ref<any[]>([])
const showCreateBackupDialog = ref(false)
const showRestoreBackupDialog = ref(false)
const backupPassword = ref('')
const backupPasswordConfirm = ref('')
const restoreFilePath = ref('')
const restorePassword = ref('')
const restoreBackupData = ref<any>(null)
const restoreOptions = ref<string[]>(['sessions', 'snippets', 'commandHistory', 'sshKeys', 'portForwards', 'sessionTemplates', 'scheduledTasks', 'workflows', 'settings', 'aiConfig', 'aiChatHistory', 'connectionStats', 'auditLogs', 'transferRecords', 'lockConfig'])
const backupLoading = ref(false)

const appVersion = ref('0.1.3')

// 更新相关状态
const updateState = ref({
  checking: false,
  downloading: false,
  status: '' as '' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error',
  newVersion: '',
  releaseNotes: '',
  progress: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  error: ''
})

// 同步相关状态
const syncConfig = ref({
  enabled: false,
  provider: 'github' as 'github' | 'gitlab' | 'webdav' | 's3',
  autoSync: false,
  syncInterval: 30,
  lastSync: undefined as string | undefined,
  encryptionPassword: '',
  github: undefined as { token: string; gistId?: string; gistUrl?: string; username?: string } | undefined,
  gitlab: undefined as { token: string; snippetId?: string; snippetUrl?: string; username?: string; instanceUrl?: string } | undefined
})
const syncState = ref({
  verifying: false,
  verifyingGitLab: false,
  syncing: false,
  uploading: false,
  downloading: false,
  uploadingGitLab: false,
  downloadingGitLab: false
})
const syncActiveTab = ref('github')
const githubTokenInput = ref('')
const gitlabTokenInput = ref('')
const gitlabInstanceUrl = ref('https://gitlab.com')

// 快捷键相关状态
const shortcuts = ref<Record<string, ShortcutConfig>>({})
const showEditShortcutDialog = ref(false)
const editingShortcutId = ref('')
const editingShortcut = ref<ShortcutConfig>({
  key: '',
  description: '',
  action: () => {}
})
const editingShortcutKey = ref('')
const editingModifiers = ref<string[]>([])
const shortcutConflict = ref('')

// 终端快捷键相关状态
const terminalShortcuts = ref<TerminalShortcutsConfig>(terminalShortcutsManager.getAll())
const showEditTerminalShortcutDialog = ref(false)
const editingTerminalShortcutId = ref<keyof TerminalShortcutsConfig>('copy')
const editingTerminalShortcut = ref<TerminalShortcut>({
  key: '',
  ctrl: false,
  alt: false,
  shift: false,
  description: ''
})
const editingTerminalShortcutKey = ref('')
const editingTerminalModifiers = ref<string[]>([])
const terminalShortcutConflict = ref('')

// 默认快捷键配置
const defaultShortcuts: Record<string, Omit<ShortcutConfig, 'action'>> = {
  'new-session': { key: 'n', ctrl: true, description: '新建会话' },
  'quick-connect': { key: 't', ctrl: true, description: '快速连接' },
  'close-tab': { key: 'w', ctrl: true, description: '关闭标签' },
  'next-tab': { key: 'Tab', ctrl: true, description: '下一个标签' },
  'prev-tab': { key: 'Tab', ctrl: true, shift: true, description: '上一个标签' },
  'search-sessions': { key: 'f', ctrl: true, description: '搜索会话' },
  'open-settings': { key: ',', ctrl: true, description: '打开设置' },
  'lock-session': { key: 'l', ctrl: true, alt: true, description: '锁定会话' },
  'switch-tab-1': { key: '1', ctrl: true, description: '切换到标签 1' },
  'switch-tab-2': { key: '2', ctrl: true, description: '切换到标签 2' },
  'switch-tab-3': { key: '3', ctrl: true, description: '切换到标签 3' },
  'switch-tab-4': { key: '4', ctrl: true, description: '切换到标签 4' },
  'switch-tab-5': { key: '5', ctrl: true, description: '切换到标签 5' },
  'switch-tab-6': { key: '6', ctrl: true, description: '切换到标签 6' },
  'switch-tab-7': { key: '7', ctrl: true, description: '切换到标签 7' },
  'switch-tab-8': { key: '8', ctrl: true, description: '切换到标签 8' },
  'switch-tab-9': { key: '9', ctrl: true, description: '切换到标签 9' }
}

watch(() => settings.value.general.theme, (newTheme) => {
  if (newTheme === 'light' && settings.value.terminal.theme === 'dark') {
    settings.value.terminal.theme = 'light'
  } else if (newTheme === 'dark' && settings.value.terminal.theme === 'light') {
    settings.value.terminal.theme = 'dark'
  }
})

onMounted(async () => {
  loadSettings()
  loadBackupConfig()
  loadBackupList()
  loadLockConfig()
  loadLockStatus()
  loadSyncConfig()
  
  // 延迟加载快捷键，确保 App.vue 中的快捷键已经注册
  setTimeout(() => {
    loadShortcuts()
  }, 100)
  
  if (window.electronAPI.app && window.electronAPI.app.getVersion) {
    try {
      appVersion.value = await window.electronAPI.app.getVersion()
    } catch (e) {
      console.error('Failed to get app version:', e)
    }
  }
  
  // 设置更新事件监听
  setupUpdateListeners()
})

const loadSettings = async () => {
  try {
    const saved = await window.electronAPI.settings.get()
    if (saved) {
      // 深度合并设置，确保新增的默认值不会丢失
      settings.value = {
        general: { ...settings.value.general, ...saved.general },
        terminal: { ...settings.value.terminal, ...saved.terminal },
        ssh: { ...settings.value.ssh, ...saved.ssh },
        sftp: { ...settings.value.sftp, ...saved.sftp },
        security: { ...settings.value.security, ...saved.security },
        updates: { ...settings.value.updates, ...saved.updates }
      }
    }
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
}

const saveSettings = async () => {
  try {
    // 保存常规设置
    await window.electronAPI.settings.update(toRaw(settings.value))
    
    // 保存 AI 设置（如果有更改）
    if (aiSettingsPanelRef.value) {
      await aiSettingsPanelRef.value.saveConfig()
    }
    
    ElMessage.success('设置已保存')
  } catch (error) {
    console.error('Save settings error:', error)
    ElMessage.error('保存设置失败')
  }
}

// 备份配置相关
const loadBackupConfig = async () => {
  try {
    const result = await window.electronAPI.backup.getConfig()
    if (result.success) {
      backupConfig.value = result.data
    }
  } catch (error) {
    console.error('Failed to load backup config:', error)
  }
}

const saveBackupConfig = async () => {
  try {
    // 如果启用了自动备份但没有设置密码，提示用户
    if (backupConfig.value.enabled && !backupConfig.value.autoBackupPassword) {
      ElMessage.warning('请设置自动备份密码')
      return
    }

    // 使用toRaw获取原始对象，避免Vue响应式代理导致的序列化问题
    const configToSave = toRaw(backupConfig.value)
    
    const result = await window.electronAPI.backup.updateConfig(configToSave)
    if (result.success) {
      ElMessage.success('备份配置已保存')
    } else {
      ElMessage.error('保存失败: ' + result.error)
    }
  } catch (error: any) {
    ElMessage.error('保存备份配置失败: ' + error.message)
  }
}

const selectDownloadDir = async () => {
  try {
    const result = await window.electronAPI.dialog.openDirectory({ properties: ['openDirectory'] })
    if (result) {
      settings.value.sftp.defaultLocalPath = result as unknown as string // result definition might vary
    }
  } catch (error) {
    ElMessage.error('选择目录失败')
  }
}

const selectBackupDir = async () => {
  try {
    const result = await window.electronAPI.backup.selectDirectory()
    if (result.success && result.data) {
      backupConfig.value.backupDir = result.data
      await saveBackupConfig()
    }
  } catch (error) {
    ElMessage.error('选择目录失败')
  }
}

const loadBackupList = async () => {
  try {
    const result = await window.electronAPI.backup.list()
    if (result.success) {
      backupList.value = result.data
    }
  } catch (error) {
    console.error('Failed to load backup list:', error)
  }
}

// 创建备份
const createBackup = async () => {
  if (!backupPassword.value) {
    ElMessage.warning('请输入备份密码')
    return
  }

  if (backupPassword.value !== backupPasswordConfirm.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }

  try {
    backupLoading.value = true

    // 选择保存位置
    const pathResult = await window.electronAPI.backup.selectSavePath(backupConfig.value.backupDir)
    if (!pathResult.success) {
      return
    }

    // 创建备份
    const result = await window.electronAPI.backup.create(backupPassword.value, pathResult.data)
    
    if (result.success) {
      ElMessage.success('备份创建成功')
      showCreateBackupDialog.value = false
      backupPassword.value = ''
      backupPasswordConfirm.value = ''
      await loadBackupList()
      await loadBackupConfig()
    } else {
      ElMessage.error('创建备份失败: ' + result.error)
    }
  } catch (error: any) {
    ElMessage.error('创建备份失败: ' + error.message)
  } finally {
    backupLoading.value = false
  }
}

// 选择恢复文件
const selectRestoreFile = async () => {
  try {
    const result = await window.electronAPI.backup.selectOpenPath()
    if (result.success) {
      restoreFilePath.value = result.data
    }
  } catch (error) {
    ElMessage.error('选择文件失败')
  }
}

// 加载备份文件
const loadBackupFile = async () => {
  if (!restoreFilePath.value) {
    ElMessage.warning('请选择备份文件')
    return
  }

  if (!restorePassword.value) {
    ElMessage.warning('请输入备份密码')
    return
  }

  try {
    backupLoading.value = true
    const result = await window.electronAPI.backup.restore(restoreFilePath.value, restorePassword.value)
    
    if (result.success) {
      restoreBackupData.value = result.data
      ElMessage.success('备份文件加载成功')
    } else {
      ElMessage.error('加载失败: ' + result.error)
    }
  } catch (error: any) {
    ElMessage.error('加载备份文件失败: ' + error.message)
  } finally {
    backupLoading.value = false
  }
}

// 应用恢复
const applyRestore = async () => {
  if (restoreOptions.value.length === 0) {
    ElMessage.warning('请至少选择一项要恢复的数据')
    return
  }

  try {
    await ElMessageBox.confirm(
      '恢复数据将会添加备份中的数据到当前系统，是否继续？',
      '确认恢复',
      {
        type: 'warning'
      }
    )

    backupLoading.value = true

    const options = {
      restoreSessions: restoreOptions.value.includes('sessions'),
      restoreSnippets: restoreOptions.value.includes('snippets'),
      restoreCommandHistory: restoreOptions.value.includes('commandHistory'),
      restoreSSHKeys: restoreOptions.value.includes('sshKeys'),
      restorePortForwards: restoreOptions.value.includes('portForwards'),
      restoreSessionTemplates: restoreOptions.value.includes('sessionTemplates'),
      restoreScheduledTasks: restoreOptions.value.includes('scheduledTasks'),
      restoreWorkflows: restoreOptions.value.includes('workflows'),
      restoreSettings: restoreOptions.value.includes('settings'),
      restoreAIConfig: restoreOptions.value.includes('aiConfig'),
      restoreAIChatHistory: restoreOptions.value.includes('aiChatHistory'),
      restoreConnectionStats: restoreOptions.value.includes('connectionStats'),
      restoreAuditLogs: restoreOptions.value.includes('auditLogs'),
      restoreTransferRecords: restoreOptions.value.includes('transferRecords'),
      restoreLockConfig: restoreOptions.value.includes('lockConfig')
    }

    const result = await window.electronAPI.backup.apply(toRaw(restoreBackupData.value), options)
    
    if (result.success) {
      ElMessage.success('数据恢复成功，应用将自动刷新')
      showRestoreBackupDialog.value = false
      cancelRestore()
      
      // Delay slightly to let the modal close animation finish, then reload to reflect changes
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } else {
      ElMessage.error('恢复失败: ' + result.error)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('恢复数据失败: ' + error.message)
    }
  } finally {
    backupLoading.value = false
  }
}

// 从历史恢复
const restoreFromHistory = (backup: any) => {
  restoreFilePath.value = backup.path
  showRestoreBackupDialog.value = true
}

// 删除备份
const deleteBackup = async (backup: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除备份 "${backup.name}" 吗？`,
      '确认删除',
      {
        type: 'warning'
      }
    )

    const result = await window.electronAPI.backup.delete(backup.path)
    
    if (result.success) {
      ElMessage.success('备份已删除')
      await loadBackupList()
    } else {
      ElMessage.error('删除失败: ' + result.error)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除备份失败: ' + error.message)
    }
  }
}

// 取消恢复
const cancelRestore = () => {
  showRestoreBackupDialog.value = false
  restoreFilePath.value = ''
  restorePassword.value = ''
  restoreBackupData.value = null
  restoreOptions.value = ['sessions', 'snippets', 'commandHistory', 'sshKeys', 'portForwards', 'sessionTemplates', 'scheduledTasks', 'workflows', 'settings', 'aiConfig', 'aiChatHistory', 'connectionStats', 'auditLogs', 'transferRecords', 'lockConfig']
}

// 格式化函数
const formatBackupTime = (time?: string) => {
  if (!time) return '从未备份'
  const date = new Date(time)
  return date.toLocaleString('zh-CN')
}

const formatDate = (date: string | Date) => {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('zh-CN')
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}
const checkForUpdates = async () => {
  if (updateState.value.checking) return
  
  updateState.value.checking = true
  updateState.value.status = ''
  updateState.value.error = ''
  
  try {
    const result = await window.electronAPI.update?.check()
    console.log('[SettingsPanel] Check update result:', result)
    if (!result?.success) {
      updateState.value.status = 'error'
      updateState.value.error = result?.error || '检查更新失败'
      updateState.value.checking = false
    }
    // 如果成功，等待事件回调更新状态
  } catch (error: any) {
    console.error('[SettingsPanel] Check update error:', error)
    updateState.value.status = 'error'
    updateState.value.error = error.message || '检查更新失败'
    updateState.value.checking = false
  }
}

const downloadUpdate = async () => {
  if (updateState.value.downloading) return
  
  updateState.value.downloading = true
  updateState.value.status = 'downloading'
  
  try {
    const result = await window.electronAPI.update?.download()
    if (!result?.success) {
      updateState.value.status = 'error'
      updateState.value.error = result?.error || '下载更新失败'
      updateState.value.downloading = false
    }
  } catch (error: any) {
    updateState.value.status = 'error'
    updateState.value.error = error.message || '下载更新失败'
    updateState.value.downloading = false
  }
}

const installUpdate = async () => {
  try {
    await window.electronAPI.update?.install()
  } catch (error: any) {
    ElMessage.error('安装更新失败: ' + error.message)
  }
}

const setupUpdateListeners = () => {
  if (!window.electronAPI.update) {
    console.warn('[SettingsPanel] Update API not available')
    return
  }
  
  console.log('[SettingsPanel] Setting up update listeners')
  
  window.electronAPI.update.onChecking(() => {
    console.log('[SettingsPanel] Update: checking')
    updateState.value.checking = true
  })
  
  window.electronAPI.update.onAvailable((info: any) => {
    console.log('[SettingsPanel] Update: available', info)
    updateState.value.checking = false
    updateState.value.status = 'available'
    updateState.value.newVersion = info.version
    updateState.value.releaseNotes = info.releaseNotes || ''
  })
  
  window.electronAPI.update.onNotAvailable(() => {
    console.log('[SettingsPanel] Update: not available (up-to-date)')
    updateState.value.checking = false
    updateState.value.status = 'up-to-date'
    ElMessage.info('已是最新版本')
  })
  
  window.electronAPI.update.onProgress((progress: any) => {
    console.log('[SettingsPanel] Update: progress', progress.percent)
    updateState.value.status = 'downloading'
    updateState.value.progress = Math.round(progress.percent)
    updateState.value.bytesPerSecond = progress.bytesPerSecond
    updateState.value.transferred = progress.transferred
    updateState.value.total = progress.total
  })
  
  window.electronAPI.update.onDownloaded((info: any) => {
    console.log('[SettingsPanel] Update: downloaded', info)
    updateState.value.downloading = false
    updateState.value.status = 'downloaded'
    updateState.value.newVersion = info.version
    ElMessage.success('更新已下载完成，可以安装')
  })
  
  window.electronAPI.update.onError((error: any) => {
    console.error('[SettingsPanel] Update: error', error)
    updateState.value.checking = false
    updateState.value.downloading = false
    updateState.value.status = 'error'
    updateState.value.error = error.message || '更新出错'
  })
}

const formatProgress = (percentage: number) => {
  return `${percentage}%`
}

const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// ==================== 同步相关函数 ====================

const loadSyncConfig = async () => {
  try {
    const result = await window.electronAPI.sync?.getConfig()
    if (result?.success && result.data) {
      syncConfig.value = {
        ...syncConfig.value,
        ...result.data
      }
    }
  } catch (error) {
    console.error('Failed to load sync config:', error)
  }
}

const saveSyncConfig = async () => {
  try {
    // 转换为普通对象，移除 undefined 值
    const configToSave = JSON.parse(JSON.stringify(syncConfig.value))
    await window.electronAPI.sync?.updateConfig(configToSave)
  } catch (error: any) {
    ElMessage.error('保存同步配置失败: ' + error.message)
  }
}

const verifyAndConnectGitHub = async () => {
  if (!githubTokenInput.value) {
    ElMessage.warning('请输入 GitHub Token')
    return
  }
  
  syncState.value.verifying = true
  
  try {
    const result = await window.electronAPI.sync?.verifyGitHubToken(githubTokenInput.value)
    
    if (result?.success && result.data?.valid) {
      // Token 有效，保存配置
      syncConfig.value.github = {
        token: githubTokenInput.value,
        username: result.data.username
      }
      syncConfig.value.provider = 'github'
      await saveSyncConfig()
      
      githubTokenInput.value = ''
      ElMessage.success(`已连接到 GitHub (${result.data.username})`)
    } else {
      ElMessage.error(result?.data?.error || 'Token 验证失败')
    }
  } catch (error: any) {
    ElMessage.error('连接失败: ' + error.message)
  } finally {
    syncState.value.verifying = false
  }
}

const disconnectGitHub = async () => {
  try {
    await ElMessageBox.confirm(
      '断开连接后，云端数据不会被删除，但本地将不再同步。确定要断开吗？',
      '断开 GitHub 连接',
      { type: 'warning' }
    )
    
    await window.electronAPI.sync?.disconnectGitHub()
    syncConfig.value = {
      enabled: false,
      provider: 'github',
      autoSync: false,
      syncInterval: 30,
      lastSync: undefined,
      encryptionPassword: '',
      github: undefined
    }
    ElMessage.success('已断开 GitHub 连接')
  } catch {
    // 用户取消
  }
}

const doSync = async () => {
  if (!syncConfig.value.encryptionPassword) {
    ElMessage.warning('请先设置同步加密密码')
    return
  }
  
  syncState.value.syncing = true
  
  try {
    const result = await window.electronAPI.sync?.sync()
    
    if (result?.success) {
      const data = result.data
      if (data.action === 'uploaded') {
        ElMessage.success('数据已上传到云端')
      } else if (data.action === 'downloaded') {
        ElMessage.success('数据已从云端下载并应用')
      } else if (data.action === 'no-change') {
        ElMessage.info('数据已是最新，无需同步')
      }
      await loadSyncConfig()
    } else {
      ElMessage.error(result?.data?.message || '同步失败')
    }
  } catch (error: any) {
    ElMessage.error('同步失败: ' + error.message)
  } finally {
    syncState.value.syncing = false
  }
}

const doUpload = async () => {
  if (!syncConfig.value.encryptionPassword) {
    ElMessage.warning('请先设置同步加密密码')
    return
  }
  
  syncState.value.uploading = true
  
  try {
    const result = await window.electronAPI.sync?.uploadToGitHub()
    
    if (result?.success) {
      ElMessage.success('数据已上传到云端')
      await loadSyncConfig()
    } else {
      ElMessage.error(result?.data?.message || '上传失败')
    }
  } catch (error: any) {
    ElMessage.error('上传失败: ' + error.message)
  } finally {
    syncState.value.uploading = false
  }
}

const doDownload = async () => {
  if (!syncConfig.value.encryptionPassword) {
    ElMessage.warning('请先设置同步加密密码')
    return
  }
  
  try {
    await ElMessageBox.confirm(
      '从云端下载将覆盖本地数据，确定要继续吗？',
      '从云端下载',
      { type: 'warning' }
    )
  } catch {
    return
  }
  
  syncState.value.downloading = true
  
  try {
    const result = await window.electronAPI.sync?.downloadFromGitHub()
    
    if (result?.success) {
      ElMessage.success('数据已从云端下载并应用')
      await loadSyncConfig()
      // 重新加载设置
      await loadSettings()
    } else {
      ElMessage.error(result?.data?.message || '下载失败')
    }
  } catch (error: any) {
    ElMessage.error('下载失败: ' + error.message)
  } finally {
    syncState.value.downloading = false
  }
}

const formatSyncTime = (time?: string) => {
  if (!time) return '从未同步'
  return new Date(time).toLocaleString()
}

// GitHub 同步开关
const onGitHubSyncToggle = async () => {
  if (syncConfig.value.enabled) {
    syncConfig.value.provider = 'github'
  }
  await saveSyncConfig()
}

// GitLab 同步开关
const onGitLabSyncToggle = async () => {
  if (syncConfig.value.enabled) {
    syncConfig.value.provider = 'gitlab'
  }
  await saveSyncConfig()
}

// ==================== GitLab 同步函数 ====================

const verifyAndConnectGitLab = async () => {
  if (!gitlabTokenInput.value) {
    ElMessage.warning('请输入 GitLab Token')
    return
  }
  
  syncState.value.verifyingGitLab = true
  
  try {
    const instanceUrl = gitlabInstanceUrl.value || 'https://gitlab.com'
    const result = await window.electronAPI.sync?.verifyGitLabToken(gitlabTokenInput.value, instanceUrl)
    
    if (result?.success && result.data?.valid) {
      syncConfig.value.gitlab = {
        token: gitlabTokenInput.value,
        username: result.data.username,
        instanceUrl: instanceUrl
      }
      await saveSyncConfig()
      
      gitlabTokenInput.value = ''
      ElMessage.success(`已连接到 GitLab (${result.data.username})`)
    } else {
      ElMessage.error(result?.data?.error || 'Token 验证失败')
    }
  } catch (error: any) {
    ElMessage.error('连接失败: ' + error.message)
  } finally {
    syncState.value.verifyingGitLab = false
  }
}

const disconnectGitLab = async () => {
  try {
    await ElMessageBox.confirm(
      '断开连接后，云端数据不会被删除，但本地将不再同步。确定要断开吗？',
      '断开 GitLab 连接',
      { type: 'warning' }
    )
    
    await window.electronAPI.sync?.disconnectGitLab()
    syncConfig.value.gitlab = undefined
    if (syncConfig.value.provider === 'gitlab') {
      syncConfig.value.enabled = false
      syncConfig.value.provider = 'github'
    }
    ElMessage.success('已断开 GitLab 连接')
  } catch {
    // 用户取消
  }
}

const doUploadGitLab = async () => {
  if (!syncConfig.value.encryptionPassword) {
    ElMessage.warning('请先设置同步加密密码')
    return
  }
  
  syncState.value.uploadingGitLab = true
  
  try {
    const result = await window.electronAPI.sync?.uploadToGitLab()
    
    if (result?.success) {
      ElMessage.success('数据已上传到 GitLab')
      await loadSyncConfig()
    } else {
      ElMessage.error(result?.data?.message || '上传失败')
    }
  } catch (error: any) {
    ElMessage.error('上传失败: ' + error.message)
  } finally {
    syncState.value.uploadingGitLab = false
  }
}

const doDownloadGitLab = async () => {
  if (!syncConfig.value.encryptionPassword) {
    ElMessage.warning('请先设置同步加密密码')
    return
  }
  
  try {
    await ElMessageBox.confirm(
      '从云端下载将覆盖本地数据，确定要继续吗？',
      '从云端下载',
      { type: 'warning' }
    )
  } catch {
    return
  }
  
  syncState.value.downloadingGitLab = true
  
  try {
    const result = await window.electronAPI.sync?.downloadFromGitLab()
    
    if (result?.success) {
      ElMessage.success('数据已从 GitLab 下载并应用')
      await loadSyncConfig()
      await loadSettings()
    } else {
      ElMessage.error(result?.data?.message || '下载失败')
    }
  } catch (error: any) {
    ElMessage.error('下载失败: ' + error.message)
  } finally {
    syncState.value.downloadingGitLab = false
  }
}

// 主题相关函数
const getThemePreviewStyle = (theme: any) => {
  if (!theme) return {}
  
  return {
    '--preview-bg': theme.background || '#1e1e1e',
    '--preview-header': theme.black || '#000000',
    '--preview-content': theme.brightBlack || '#666666'
  }
}

const applyTheme = async (themeKey: string) => {
  currentTheme.value = themeKey
  settings.value.terminal.theme = themeKey
  
  try {
    await window.electronAPI.settings.update({
      terminal: {
        theme: themeKey
      }
    })
    ElMessage.success(`已切换到 ${themes[themeKey].name}`)
  } catch (error: any) {
    ElMessage.error(`切换主题失败: ${error.message}`)
  }
}

// 快捷键相关函数
const loadShortcuts = () => {
  console.log('[SettingsPanel] Loading shortcuts...')
  
  // 首先尝试从快捷键管理器获取
  const allShortcuts = keyboardShortcutManager.getAll()
  console.log('[SettingsPanel] Shortcuts from manager:', allShortcuts.size)
  
  if (allShortcuts.size > 0) {
    // 如果管理器中有快捷键，使用它们
    const shortcutsObj: Record<string, ShortcutConfig> = {}
    allShortcuts.forEach((config, id) => {
      shortcutsObj[id] = config
    })
    shortcuts.value = shortcutsObj
    console.log('[SettingsPanel] Loaded shortcuts from manager:', Object.keys(shortcutsObj).length)
  } else {
    // 如果管理器中没有快捷键，使用默认配置并注册到管理器
    console.log('[SettingsPanel] No shortcuts in manager, using defaults')
    const shortcutsObj: Record<string, ShortcutConfig> = {}
    
    for (const [id, config] of Object.entries(defaultShortcuts)) {
      const fullConfig: ShortcutConfig = {
        ...config,
        action: () => {} // 占位 action，实际的 action 在 App.vue 中定义
      }
      
      // 注册到管理器
      keyboardShortcutManager.register(id, fullConfig)
      shortcutsObj[id] = fullConfig
    }
    
    shortcuts.value = shortcutsObj
    console.log('[SettingsPanel] Loaded default shortcuts:', Object.keys(shortcutsObj).length)
  }
  
  console.log('[SettingsPanel] Final shortcuts:', shortcuts.value)
}

const formatShortcutKey = (shortcut: ShortcutConfig): string => {
  const parts: string[] = []
  if (shortcut.ctrl) parts.push('Ctrl')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.meta) parts.push('Meta')
  parts.push(shortcut.key.toUpperCase())
  return parts.join(' + ')
}

const editShortcut = (id: string, shortcut: ShortcutConfig) => {
  editingShortcutId.value = id
  editingShortcut.value = { ...shortcut }
  editingShortcutKey.value = shortcut.key
  
  const modifiers: string[] = []
  if (shortcut.ctrl) modifiers.push('ctrl')
  if (shortcut.alt) modifiers.push('alt')
  if (shortcut.shift) modifiers.push('shift')
  editingModifiers.value = modifiers
  
  shortcutConflict.value = ''
  showEditShortcutDialog.value = true
}

const captureShortcut = (event: KeyboardEvent) => {
  event.preventDefault()
  event.stopPropagation()
  
  // 忽略单独的修饰键
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    return
  }
  
  // 使用 event.code 来获取物理按键，避免 Alt 键改变按键值的问题
  const codeToKey: Record<string, string> = {
    'KeyA': 'a', 'KeyB': 'b', 'KeyC': 'c', 'KeyD': 'd', 'KeyE': 'e',
    'KeyF': 'f', 'KeyG': 'g', 'KeyH': 'h', 'KeyI': 'i', 'KeyJ': 'j',
    'KeyK': 'k', 'KeyL': 'l', 'KeyM': 'm', 'KeyN': 'n', 'KeyO': 'o',
    'KeyP': 'p', 'KeyQ': 'q', 'KeyR': 'r', 'KeyS': 's', 'KeyT': 't',
    'KeyU': 'u', 'KeyV': 'v', 'KeyW': 'w', 'KeyX': 'x', 'KeyY': 'y',
    'KeyZ': 'z',
    'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4', 'Digit5': '5',
    'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9', 'Digit0': '0',
    'Comma': ',', 'Period': '.', 'Slash': '/', 'Semicolon': ';',
    'Tab': 'Tab', 'Enter': 'Enter', 'Escape': 'Escape', 'Space': 'Space'
  }
  
  // 优先使用 code 映射，如果没有映射则使用 key
  const key = codeToKey[event.code] || event.key
  editingShortcutKey.value = key
  
  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('ctrl')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  editingModifiers.value = modifiers
  
  checkShortcutConflict()
}

const clearShortcutInput = () => {
  editingShortcutKey.value = ''
  editingModifiers.value = []
  shortcutConflict.value = ''
}

const checkShortcutConflict = () => {
  if (!editingShortcutKey.value) {
    shortcutConflict.value = ''
    return
  }
  
  const newConfig = {
    key: editingShortcutKey.value,
    ctrl: editingModifiers.value.includes('ctrl'),
    alt: editingModifiers.value.includes('alt'),
    shift: editingModifiers.value.includes('shift')
  }
  
  for (const [id, shortcut] of Object.entries(shortcuts.value)) {
    if (id === editingShortcutId.value) continue
    
    if (
      shortcut.key.toLowerCase() === newConfig.key.toLowerCase() &&
      !!shortcut.ctrl === newConfig.ctrl &&
      !!shortcut.alt === newConfig.alt &&
      !!shortcut.shift === newConfig.shift
    ) {
      shortcutConflict.value = shortcut.description
      return
    }
  }
  
  shortcutConflict.value = ''
}

const saveShortcut = () => {
  if (!editingShortcutKey.value) {
    ElMessage.warning('请设置快捷键')
    return
  }
  
  if (shortcutConflict.value) {
    ElMessage.warning('快捷键冲突，请选择其他组合')
    return
  }
  
  const updatedConfig: ShortcutConfig = {
    ...editingShortcut.value,
    key: editingShortcutKey.value,
    ctrl: editingModifiers.value.includes('ctrl'),
    alt: editingModifiers.value.includes('alt'),
    shift: editingModifiers.value.includes('shift')
  }
  
  // 更新快捷键管理器
  keyboardShortcutManager.register(editingShortcutId.value, updatedConfig)
  
  // 更新本地显示
  shortcuts.value[editingShortcutId.value] = updatedConfig
  
  // 保存到设置
  saveShortcutSettings()
  
  ElMessage.success('快捷键已更新')
  showEditShortcutDialog.value = false
}

const resetShortcut = (id: string) => {
  const defaultConfig = defaultShortcuts[id]
  if (!defaultConfig) return
  
  const shortcut = shortcuts.value[id]
  if (!shortcut) return
  
  const resetConfig: ShortcutConfig = {
    ...defaultConfig,
    action: shortcut.action
  }
  
  keyboardShortcutManager.register(id, resetConfig)
  shortcuts.value[id] = resetConfig
  
  saveShortcutSettings()
  ElMessage.success('快捷键已重置')
}

const saveShortcutSettings = async () => {
  try {
    const shortcutSettings: Record<string, any> = {}
    
    for (const [id, shortcut] of Object.entries(shortcuts.value)) {
      shortcutSettings[id] = {
        key: shortcut.key,
        ctrl: shortcut.ctrl,
        alt: shortcut.alt,
        shift: shortcut.shift,
        description: shortcut.description
      }
    }
    
    await window.electronAPI.settings.update({
      ...toRaw(settings.value),
      shortcuts: shortcutSettings
    })
  } catch (error) {
    console.error('Failed to save shortcut settings:', error)
  }
}

// 终端快捷键相关函数
const formatTerminalShortcutKey = (id: keyof TerminalShortcutsConfig) => {
  return terminalShortcutsManager.format(id)
}

const editTerminalShortcut = (id: string, shortcut: TerminalShortcut) => {
  editingTerminalShortcutId.value = id as keyof TerminalShortcutsConfig
  editingTerminalShortcut.value = { ...shortcut }
  editingTerminalShortcutKey.value = shortcut.key
  
  const modifiers: string[] = []
  if (shortcut.ctrl) modifiers.push('ctrl')
  if (shortcut.alt) modifiers.push('alt')
  if (shortcut.shift) modifiers.push('shift')
  editingTerminalModifiers.value = modifiers
  
  terminalShortcutConflict.value = ''
  showEditTerminalShortcutDialog.value = true
}

const captureTerminalShortcut = (event: KeyboardEvent) => {
  event.preventDefault()
  event.stopPropagation()
  
  // 忽略单独的修饰键
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    return
  }
  
  // 使用 event.code 来获取物理按键
  const codeToKey: Record<string, string> = {
    'KeyA': 'A', 'KeyB': 'B', 'KeyC': 'C', 'KeyD': 'D', 'KeyE': 'E',
    'KeyF': 'F', 'KeyG': 'G', 'KeyH': 'H', 'KeyI': 'I', 'KeyJ': 'J',
    'KeyK': 'K', 'KeyL': 'L', 'KeyM': 'M', 'KeyN': 'N', 'KeyO': 'O',
    'KeyP': 'P', 'KeyQ': 'Q', 'KeyR': 'R', 'KeyS': 'S', 'KeyT': 'T',
    'KeyU': 'U', 'KeyV': 'V', 'KeyW': 'W', 'KeyX': 'X', 'KeyY': 'Y',
    'KeyZ': 'Z'
  }
  
  const key = codeToKey[event.code] || event.key.toUpperCase()
  editingTerminalShortcutKey.value = key
  
  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('ctrl')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  editingTerminalModifiers.value = modifiers
  
  checkTerminalShortcutConflict()
}

const clearTerminalShortcutInput = () => {
  editingTerminalShortcutKey.value = ''
  editingTerminalModifiers.value = []
  terminalShortcutConflict.value = ''
}

const checkTerminalShortcutConflict = () => {
  if (!editingTerminalShortcutKey.value) {
    terminalShortcutConflict.value = ''
    return
  }
  
  const newConfig = {
    key: editingTerminalShortcutKey.value,
    ctrl: editingTerminalModifiers.value.includes('ctrl'),
    alt: editingTerminalModifiers.value.includes('alt'),
    shift: editingTerminalModifiers.value.includes('shift')
  }
  
  // 检查与其他终端快捷键的冲突
  for (const [id, shortcut] of Object.entries(terminalShortcuts.value)) {
    if (id === editingTerminalShortcutId.value) continue
    
    if (
      shortcut.key.toUpperCase() === newConfig.key.toUpperCase() &&
      shortcut.ctrl === newConfig.ctrl &&
      shortcut.alt === newConfig.alt &&
      shortcut.shift === newConfig.shift
    ) {
      terminalShortcutConflict.value = shortcut.description
      return
    }
  }
  
  terminalShortcutConflict.value = ''
}

const saveTerminalShortcut = () => {
  if (!editingTerminalShortcutKey.value) {
    ElMessage.warning('请设置快捷键')
    return
  }
  
  if (terminalShortcutConflict.value) {
    ElMessage.warning('快捷键冲突，请选择其他组合')
    return
  }
  
  // 更新终端快捷键管理器
  terminalShortcutsManager.update(editingTerminalShortcutId.value, {
    key: editingTerminalShortcutKey.value,
    ctrl: editingTerminalModifiers.value.includes('ctrl'),
    alt: editingTerminalModifiers.value.includes('alt'),
    shift: editingTerminalModifiers.value.includes('shift')
  })
  
  // 更新本地显示
  terminalShortcuts.value = terminalShortcutsManager.getAll()
  
  ElMessage.success('终端快捷键已更新')
  showEditTerminalShortcutDialog.value = false
}

const resetTerminalShortcut = (id: string) => {
  terminalShortcutsManager.reset(id as keyof TerminalShortcutsConfig)
  terminalShortcuts.value = terminalShortcutsManager.getAll()
  ElMessage.success('终端快捷键已重置')
}

// 会话锁定相关函数
const loadLockConfig = async () => {
  try {
    const result = await window.electronAPI.sessionLock?.getConfig?.()
    if (result?.success && result.data) {
      // 映射后端字段名到前端字段名
      lockConfig.value.autoLockEnabled = result.data.enabled
      lockConfig.value.autoLockTimeout = result.data.autoLockTimeout
      lockConfig.value.lockOnMinimize = result.data.lockOnMinimize
      lockConfig.value.lockOnSuspend = result.data.lockOnSuspend
    }
  } catch (error) {
    console.error('Failed to load lock config:', error)
  }
}

const loadLockStatus = async () => {
  try {
    const result = await window.electronAPI.sessionLock?.getStatus?.()
    if (result?.success) {
      lockStatus.value = result.data
      lockConfig.value.hasPassword = result.data.hasPassword
    }
  } catch (error) {
    console.error('Failed to load lock status:', error)
  }
}

const saveLockConfig = async () => {
  try {
    // 映射前端字段名到后端字段名
    const configData = {
      enabled: lockConfig.value.autoLockEnabled,  // 前端用 autoLockEnabled，后端用 enabled
      autoLockTimeout: lockConfig.value.autoLockTimeout,
      lockOnMinimize: lockConfig.value.lockOnMinimize,
      lockOnSuspend: lockConfig.value.lockOnSuspend
    }
    const result = await window.electronAPI.sessionLock?.updateConfig?.(configData)
    if (result?.success) {
      ElMessage.success('设置已保存')
    }
  } catch (error: any) {
    ElMessage.error(`保存失败: ${error.message}`)
  }
}

const handlePasswordToggle = () => {
  if (lockConfig.value.hasPassword) {
    showSetPasswordDialog.value = true
  } else {
    // 用户关闭了密码保护开关，恢复状态
    lockConfig.value.hasPassword = false
    removePassword()
  }
}

const cancelSetPassword = () => {
  // 用户取消设置密码，恢复开关状态
  lockConfig.value.hasPassword = false
  showSetPasswordDialog.value = false
  newPassword.value = ''
  confirmPassword.value = ''
}

const handleSetPasswordDialogClose = () => {
  // 对话框关闭时，如果没有成功设置密码，恢复开关状态
  if (!lockStatus.value.hasPassword) {
    lockConfig.value.hasPassword = false
  }
  newPassword.value = ''
  confirmPassword.value = ''
}

const setPassword = async () => {
  if (!newPassword.value) {
    ElMessage.warning('请输入密码')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }

  try {
    const result = await window.electronAPI.sessionLock?.setPassword?.(newPassword.value)
    if (result?.success) {
      ElMessage.success('密码已设置')
      showSetPasswordDialog.value = false
      newPassword.value = ''
      confirmPassword.value = ''
      await loadLockStatus()
      // 不需要调用 saveLockConfig，因为 setPassword 已经保存了
    } else {
      // 设置失败，恢复开关状态
      lockConfig.value.hasPassword = false
      ElMessage.error(result?.error || '设置密码失败')
    }
  } catch (error: any) {
    // 设置失败，恢复开关状态
    lockConfig.value.hasPassword = false
    ElMessage.error(`设置密码失败: ${error.message}`)
  }
}

const changePassword = async () => {
  if (!currentPassword.value || !newPassword.value) {
    ElMessage.warning('请填写所有字段')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }

  try {
    // 先验证当前密码
    const verifyResult = await window.electronAPI.sessionLock?.verifyPassword?.(currentPassword.value)
    if (!verifyResult?.success) {
      ElMessage.error('当前密码错误')
      return
    }

    // 设置新密码
    const result = await window.electronAPI.sessionLock?.setPassword?.(newPassword.value)
    if (result?.success) {
      ElMessage.success('密码已修改')
      showChangePasswordDialog.value = false
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
    }
  } catch (error: any) {
    ElMessage.error(`修改密码失败: ${error.message}`)
  }
}

const removePassword = async () => {
  try {
    // 先要求输入当前密码验证
    const { value: password } = await ElMessageBox.prompt('请输入当前密码以确认移除', '验证密码', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputType: 'password',
      inputPlaceholder: '输入当前密码',
      inputValidator: (value) => {
        if (!value) {
          return '请输入密码'
        }
        return true
      }
    })

    // 验证密码
    const verifyResult = await window.electronAPI.sessionLock?.verifyPassword?.(password)
    if (!verifyResult?.success) {
      ElMessage.error('密码错误')
      return
    }

    // 再次确认
    await ElMessageBox.confirm('确定要移除密码保护吗？', '确认', {
      type: 'warning'
    })

    const result = await window.electronAPI.sessionLock?.removePassword?.()
    if (result?.success) {
      ElMessage.success('密码已移除')
      lockConfig.value.hasPassword = false
      await loadLockStatus()
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`移除密码失败: ${error.message}`)
    }
  }
}

const lockNow = async () => {
  try {
    const result = await window.electronAPI.sessionLock?.lock?.()
    if (result?.success) {
      ElMessage.success('已锁定')
      // 触发全局锁定事件，App.vue 会监听并显示锁定界面
      window.dispatchEvent(new CustomEvent('session-locked'))
    }
  } catch (error: any) {
    ElMessage.error(`锁定失败: ${error.message}`)
  }
}

// 测试快捷键功能
const testShortcuts = () => {
  const registeredCount = Object.keys(shortcuts.value).length
  const expectedCount = 17 // 9个数字键 + 8个其他快捷键
  
  let statusHtml = `
    <div style="text-align: left; line-height: 1.8;">
      <p><strong>快捷键系统状态：</strong></p>
      <ul style="list-style: none; padding-left: 0; margin-bottom: 16px;">
        <li>✓ 已注册快捷键数量: ${registeredCount} / ${expectedCount}</li>
        <li>✓ 快捷键管理器: 已启动</li>
        <li>✓ 事件监听器: 已激活</li>
      </ul>
  `
  
  if (registeredCount < expectedCount) {
    statusHtml += `
      <el-alert type="warning" style="margin-bottom: 16px;">
        <p>警告：部分快捷键未注册！</p>
        <p>预期 ${expectedCount} 个，实际 ${registeredCount} 个</p>
      </el-alert>
    `
  }
  
  statusHtml += `
      <p><strong>请尝试以下快捷键：</strong></p>
      <ul style="list-style: none; padding-left: 0;">
        <li>✓ Ctrl+N - 新建会话</li>
        <li>✓ Ctrl+T - 快速连接</li>
        <li>✓ Ctrl+W - 关闭当前标签</li>
        <li>✓ Ctrl+Tab - 下一个标签</li>
        <li>✓ Ctrl+Shift+Tab - 上一个标签</li>
        <li>✓ Ctrl+F - 搜索会话</li>
        <li>✓ Ctrl+, - 打开设置</li>
        <li>✓ Ctrl+Alt+L - 锁定会话</li>
        <li>✓ Ctrl+1~9 - 切换到指定标签</li>
      </ul>
      <p style="margin-top: 16px; color: #666; font-size: var(--text-md);">
        <strong>调试提示：</strong><br/>
        1. 关闭此对话框后，尝试按下快捷键<br/>
        2. 打开浏览器控制台（F12）查看日志<br/>
        3. 每次按下快捷键都会输出日志信息<br/>
        4. 如果没有日志，说明快捷键被其他元素拦截
      </p>
    </div>
  `
  
  ElMessageBox.alert(statusHtml, '快捷键测试', {
    dangerouslyUseHTMLString: true,
    confirmButtonText: '开始测试',
    callback: () => {
      console.log('[SettingsPanel] Shortcut test started')
      console.log('[SettingsPanel] Registered shortcuts:', shortcuts.value)
      ElMessage.info('请尝试按下快捷键，并查看控制台日志')
    }
  })
}
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
  transition: background-color var(--transition-normal);
}

/* 同步子标签页样式 */
.sync-tabs {
  margin-top: -8px;
}

.sync-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.sync-tabs :deep(.el-tabs__item) {
  font-size: var(--text-sm);
  padding: 0 16px;
}

/* 头部 */
.panel-header {
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h2 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* 内容区域 */
.settings-content {
  flex: 1;
  overflow: hidden;
}

.settings-tabs {
  height: 100%;
}

.settings-tabs :deep(.el-tabs__header) {
  display: flex;
  justify-content: center;
  margin: 0;
}

.settings-tabs :deep(.el-tabs__nav-wrap) {
  display: flex;
  justify-content: center;
}

.settings-tabs :deep(.el-tabs__nav) {
  float: none;
}

.settings-tabs :deep(.el-tabs__content) {
  height: calc(100% - 55px);
  overflow-y: auto;
  padding: var(--spacing-xl);
}

.settings-tabs :deep(.el-tab-pane) {
  width: 100%;
}

/* 设置区块 */
.settings-section {
  width: 100%;
  margin-bottom: var(--spacing-xl);
}

.settings-section :deep(.el-form) {
  width: 100%;
}

.settings-section :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
  display: flex;
  align-items: center;
}

.settings-section :deep(.el-form-item__label) {
  width: 160px;
  flex-shrink: 0;
  text-align: left;
  padding-right: var(--spacing-md);
  white-space: nowrap;
}

.settings-section :deep(.el-form-item__content) {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.settings-section h3 {
  margin: 0 0 var(--spacing-lg) 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
}

.form-hint {
  margin-left: var(--spacing-sm);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

/* 关于页面 */
.about-section {
  max-width: 600px;
  text-align: center;
}

.app-info {
  padding: var(--spacing-2xl) 0;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: var(--spacing-xl);
}

.app-logo {
  width: 80px;
  height: 80px;
  margin: 0 auto var(--spacing-lg);
  background: transparent;
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.app-logo .logo-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.app-info h2 {
  margin: 0 0 var(--spacing-sm) 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.version {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.description {
  margin: 0;
  font-size: var(--text-base);
  color: var(--text-secondary);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-lg);
  text-align: left;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.info-item label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-item span,
.info-item a {
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.info-item a {
  color: var(--primary-color);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.info-item a:hover {
  color: var(--primary-light);
}

/* 备份相关样式 */
.backup-actions {
  display: flex;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.restore-options {
  padding: var(--spacing-lg);
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

.restore-options h4 {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.restore-options :deep(.el-checkbox-group) {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.restore-options :deep(.el-checkbox) {
  margin-right: 0;
}

/* 快捷键列表样式 */
.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.shortcut-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.shortcut-item:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.shortcut-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  flex: 1;
}

.shortcut-name {
  font-size: var(--text-base);
  color: var(--text-primary);
  font-weight: 500;
}

.shortcut-key {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  background: var(--bg-main);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  display: inline-block;
  width: fit-content;
}

.shortcut-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.shortcut-input {
  display: flex;
  gap: var(--spacing-sm);
  width: 100%;
}

.shortcut-input .el-input {
  flex: 1;
}

.shortcut-tips {
  margin: 0;
  padding-left: var(--spacing-lg);
  color: var(--text-secondary);
}

.shortcut-tips li {
  margin-bottom: var(--spacing-xs);
}

/* 主题列表样式 */
.theme-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.theme-item {
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
}

.theme-item:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.theme-item.active {
  border-color: var(--primary-color);
  background: rgba(14, 165, 233, 0.05);
}

.theme-preview {
  width: 100%;
  height: 100px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: var(--spacing-sm);
  background: var(--preview-bg);
}

.preview-header {
  height: 30%;
  background: var(--preview-header);
}

.preview-content {
  height: 70%;
  background: var(--preview-content);
}

.theme-info {
  text-align: center;
}

.theme-name {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.theme-type {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.theme-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

.theme-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: center;
}

/* 会话锁定样式 */
.lock-status-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  margin-bottom: 16px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-indicator.locked {
  color: var(--error-color);
}

.status-text {
  font-size: var(--text-lg);
  font-weight: 600;
}

/* 更新相关样式 */
.version-text {
  font-weight: 600;
  color: var(--primary-color);
}

.update-status {
  margin: var(--spacing-lg) 0;
}

.update-status .el-alert {
  margin-bottom: var(--spacing-md);
}

.release-notes {
  max-height: 150px;
  overflow-y: auto;
  margin: var(--spacing-sm) 0;
  padding: var(--spacing-sm);
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.update-actions {
  margin-top: var(--spacing-md);
}

.download-info {
  margin-top: var(--spacing-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

</style>
