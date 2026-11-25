<template>
  <div class="mobile-shell" :class="{ 'is-locked': isLocked && securitySettings.enabled }">
    <LockScreen
      v-if="isLocked && securitySettings.enabled"
      :settings="securitySettings"
      @unlocked="unlockApp"
    />

    <header class="app-header">
      <div class="brand-title">
        <img src="@/assets/logo.png" alt="MShell" class="app-logo" />
        <div>
          <p class="eyebrow">MShell Android</p>
          <h1>{{ activeTitle }}</h1>
        </div>
      </div>
      <div class="header-actions">
        <button
          v-if="terminalWindows.length"
          class="icon-button secondary"
          type="button"
          title="终端窗口"
          @click="showTerminalSwitcher = true"
        >
          窗
        </button>
        <button class="icon-button secondary" type="button" title="安全锁" @click="lockApp">
          锁
        </button>
        <button class="icon-button" type="button" title="导入数据" @click="showImport = true">
          ⇪
        </button>
      </div>
    </header>

    <main class="content">
      <section v-if="activeTab === 'sessions'" class="panel">
        <div class="section-head">
          <div>
            <h2>SSH 会话</h2>
            <p>{{ filteredSessions.length }} / {{ sshSessions.length }} 个 SSH 会话</p>
            <p v-if="connectionMessage" class="inline-status">{{ connectionMessage }}</p>
          </div>
          <div class="inline-actions">
            <button type="button" class="secondary" @click="openCategoryDrawer('sessions')">
              分类
            </button>
            <button type="button" class="secondary" :disabled="isTerminalConnecting" @click="openSelectedOrFirstTerminal">
              {{ isTerminalConnecting ? '打开中' : '连接' }}
            </button>
            <button type="button" @click="openSessionEditor()">新增</button>
          </div>
        </div>
        <article
          v-if="selectedSessionGroup"
          class="list-card compact-card"
        >
          <div>
            <h3>{{ selectedSessionGroup.name }}</h3>
            <p>{{ selectedSessionGroup.count }} 个会话</p>
          </div>
          <div class="card-actions">
            <button type="button" class="secondary small" @click="openGroupEditor(selectedSessionGroup)">
              编辑
            </button>
            <button type="button" class="danger small" @click="deleteGroup(selectedSessionGroup.id)">
              删除
            </button>
          </div>
        </article>

        <div v-if="filteredSessions.length === 0" class="empty-state">
          可以新增 SSH 会话，也可以导入桌面端备份或同步数据。
        </div>
        <article
          v-for="session in filteredSessions"
          :key="session.id"
          class="list-card session-card"
          :class="{ selected: selectedSessionId === session.id }"
          @click="selectSession(session)"
        >
          <div class="session-summary">
            <h3>{{ session.name }}</h3>
            <p>{{ session.username }}@{{ session.host }}:{{ session.port }}</p>
            <p>{{ session.authType === 'privateKey' ? 'SSH 密钥认证' : '密码认证' }}</p>
            <p v-if="sessionManagementText(session)">{{ sessionManagementText(session) }}</p>
            <p v-if="sessionBillingText(session)">{{ sessionBillingText(session) }}</p>
            <p v-if="session.description">{{ session.description }}</p>
            <p v-if="session.notes">{{ session.notes }}</p>
          </div>
          <div class="session-actions">
            <button type="button" class="session-connect-button" @click.stop="openTerminal(session)">
              连接
            </button>
            <button type="button" class="secondary small" @click.stop="openSessionEditor(session)">
              编辑
            </button>
            <button type="button" class="secondary small" @click.stop="openSessionActions(session)">
              更多
            </button>
          </div>
        </article>

      </section>

      <section v-else-if="activeTab === 'snippets'" class="panel">
        <div class="section-head">
          <div>
            <h2>命令片段</h2>
            <p>{{ filteredSnippets.length }} / {{ state.snippets.length }} 条片段</p>
          </div>
          <div class="inline-actions">
            <input v-model="snippetQuery" placeholder="搜索" />
            <button type="button" class="secondary" @click="openCategoryDrawer('snippets')">
              分类
            </button>
            <button type="button" @click="openSnippetEditor()">新增</button>
          </div>
        </div>
        <div v-if="filteredSnippets.length === 0" class="empty-state">
          还没有命令片段，可以直接新增常用命令。
        </div>
        <article v-for="snippet in filteredSnippets" :key="snippet.id" class="list-card stacked">
          <div class="card-row">
            <div>
              <h3>{{ snippet.name }}</h3>
              <p>{{ snippet.description || snippet.category || '未分类' }}</p>
            </div>
            <div class="card-actions">
              <button type="button" class="secondary small" @click="openSnippetEditor(snippet)">
                编辑
              </button>
              <button type="button" class="danger small" @click="deleteSnippet(snippet.id)">
                删除
              </button>
            </div>
          </div>
          <code>{{ snippet.command }}</code>
          <button type="button" @click="copySnippetCommand(snippet.command)">复制</button>
        </article>
      </section>

      <section v-else-if="activeTab === 'keys'" class="panel">
        <div class="section-head">
          <div>
            <h2>SSH 密钥</h2>
            <p>{{ state.sshKeys.length }} 个密钥</p>
          </div>
          <button type="button" @click="openKeyEditor()">新增</button>
        </div>
        <div v-if="state.sshKeys.length === 0" class="empty-state">
          可以新增或粘贴已有私钥，私钥内容会随加密备份或加密同步一起保存。
        </div>
        <article v-for="key in state.sshKeys" :key="key.id" class="list-card">
          <div>
            <h3>{{ key.name }}</h3>
            <p>{{ key.fingerprint || '未生成指纹' }}</p>
            <p v-if="key.comment">{{ key.comment }}</p>
          </div>
          <div class="card-actions">
            <span>{{ key.type }}</span>
            <button type="button" class="secondary small" @click="openKeyEditor(key)">编辑</button>
            <button type="button" class="danger small" @click="deleteKey(key.id)">删除</button>
          </div>
        </article>
      </section>

      <section v-else class="panel">
        <div class="section-head">
          <div>
            <h2>设置</h2>
            <p>{{ activeSettingsTabDescription }}</p>
          </div>
        </div>
        <nav class="settings-tabs" aria-label="设置分类">
          <button
            v-for="tab in settingsTabs"
            :key="tab.id"
            type="button"
            :class="{ active: activeSettingsTab === tab.id }"
            @click="activeSettingsTab = tab.id"
          >
            <span>{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        </nav>
        <RemoteSyncPanel v-if="activeSettingsTab === 'sync'" @synced="refreshState" />
        <ImportPanel v-else-if="activeSettingsTab === 'import'" @imported="refreshState" />
        <ExportPanel v-else-if="activeSettingsTab === 'export'" />
        <AppSettingsPanel
          v-else-if="activeSettingsTab === 'terminal'"
          :settings="appSettings"
          @updated="appSettings = $event"
        />
        <SecurityPanel
          v-else
          :settings="securitySettings"
          @lock-now="lockApp"
        />
      </section>
    </main>

    <nav class="bottom-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="{ active: activeTab === tab.id }"
        @click="switchTab(tab.id)"
      >
        <span>{{ tab.icon }}</span>
        {{ tab.label }}
      </button>
    </nav>

    <div
      v-if="showTerminalSwitcher"
      class="modal-backdrop terminal-switcher-backdrop"
      @click.self="showTerminalSwitcher = false"
    >
      <div class="modal terminal-switcher">
        <header>
          <h2>终端窗口</h2>
          <button type="button" @click="showTerminalSwitcher = false">×</button>
        </header>
        <div v-if="terminalWindows.length === 0" class="empty-state compact">
          暂无打开的终端窗口
        </div>
        <article v-for="terminal in terminalWindows" :key="terminal.id" class="list-card">
          <div>
            <h3>{{ terminal.session.name }}</h3>
            <p>{{ terminal.session.username }}@{{ terminal.session.host }}:{{ terminal.session.port }}</p>
            <p>{{ getTerminalStatusText(terminal) }}{{ terminal.minimized ? ' · 已最小化' : '' }}</p>
          </div>
          <div class="card-actions">
            <button type="button" class="secondary small" @click="restoreTerminal(terminal.id)">
              打开
            </button>
            <button type="button" class="danger small" @click="closeTerminal(terminal.id)">
              关闭
            </button>
          </div>
        </article>
      </div>
    </div>

    <section v-if="visibleTerminal" class="terminal-window">
      <header>
        <div>
          <p class="eyebrow">SSH Session</p>
          <h2>{{ visibleTerminal.session.name }}</h2>
          <p>{{ getTerminalStatusText(visibleTerminal) }}</p>
        </div>
        <div class="terminal-window-actions">
          <button type="button" class="secondary" @click="minimizeTerminal(visibleTerminal.id)">
            最小化
          </button>
          <button type="button" class="danger" @click="closeTerminal(visibleTerminal.id)">
            关闭
          </button>
        </div>
      </header>

      <div
        v-if="visibleTerminal.inputMode === 'direct-terminal'"
        ref="terminalOutputRef"
        class="terminal-output terminal-xterm interactive"
        tabindex="0"
        @click="focusVisibleTerminal"
      />
      <pre
        v-else
        class="terminal-output"
      >{{ visibleTerminal.output || '正在打开连接...' }}</pre>

      <div class="terminal-tools">
        <span class="terminal-mode-pill">
          {{ visibleTerminal.inputMode === 'direct-terminal' ? '直接输入' : '命令框' }}
        </span>
        <button
          type="button"
          class="secondary"
          :disabled="visibleTerminal.status !== 'connected'"
          @click="visibleTerminal.snippetPanel = !visibleTerminal.snippetPanel"
        >
          片段
        </button>
        <button type="button" class="secondary" @click="showTerminalSwitcher = true">
          窗口
        </button>
      </div>

      <div v-if="visibleTerminal.snippetPanel" class="terminal-snippets">
        <div class="terminal-snippet-head">
          <select v-model="visibleTerminal.snippetCategory">
            <option value="all">全部分类（{{ state.snippets.length }}）</option>
            <option value="uncategorized">未分类（{{ uncategorizedSnippetCount }}）</option>
            <option
              v-for="category in snippetCategoriesWithCounts"
              :key="category.name"
              :value="category.name"
            >
              {{ category.name }}（{{ category.count }}）
            </option>
          </select>
          <input v-model="visibleTerminal.snippetQuery" placeholder="搜索片段" />
          <button type="button" class="secondary" @click="visibleTerminal.snippetPanel = false">
            收起
          </button>
        </div>
        <div v-if="terminalSnippets.length === 0" class="empty-state compact">
          没有匹配的命令片段
        </div>
        <article v-for="snippet in terminalSnippets" :key="snippet.id" class="terminal-snippet-card">
          <div>
            <h3>{{ snippet.name }}</h3>
            <p class="snippet-category">{{ snippet.category || '未分类' }}</p>
            <p v-if="snippet.description">{{ snippet.description }}</p>
            <code>{{ snippet.command }}</code>
          </div>
          <div class="card-actions">
            <button type="button" class="secondary small" @click="copySnippetCommand(snippet.command)">
              复制
            </button>
            <button type="button" class="small" @click="executeSnippetInTerminal(snippet.command, visibleTerminal)">
              执行
            </button>
          </div>
        </article>
      </div>

      <form
        v-if="visibleTerminal.inputMode === 'command-box'"
        class="terminal-input terminal-input-multiline"
        @submit.prevent="executeTerminalCommand(visibleTerminal)"
      >
        <textarea
          v-model="visibleTerminal.command"
          :disabled="visibleTerminal.status !== 'connected'"
          autocomplete="off"
          rows="4"
          placeholder="输入命令或多行脚本，Enter 换行，Ctrl/⌘ + Enter 执行"
          @keydown="handleCommandBoxKeydown($event, visibleTerminal)"
        />
        <button type="submit" :disabled="visibleTerminal.status !== 'connected' || !visibleTerminal.command.trim()">
          执行
        </button>
      </form>
      <div v-else class="terminal-direct-input">
        点击上方终端区域直接输入；Enter 发送回车，Ctrl+C 发送中断。
      </div>
    </section>

    <div v-if="showImport" class="modal-backdrop" @click.self="showImport = false">
      <div class="modal">
        <header>
          <h2>导入同步数据</h2>
          <button type="button" @click="showImport = false">×</button>
        </header>
        <ImportPanel @imported="handleModalImported" />
      </div>
    </div>

    <div
      v-if="sessionActionMenu"
      class="modal-backdrop session-action-backdrop"
      @click.self="closeSessionActions"
    >
      <div class="modal session-action-sheet">
        <header>
          <h2>{{ sessionActionMenu.name }}</h2>
          <button type="button" @click="closeSessionActions">×</button>
        </header>
        <div class="action-sheet-body">
          <button type="button" @click="connectFromSessionActions">
            连接
          </button>
          <button type="button" class="secondary" @click="editFromSessionActions">
            编辑
          </button>
          <button type="button" class="danger" @click="deleteFromSessionActions">
            删除此会话
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="categoryDrawer"
      class="drawer-backdrop"
      @click.self="categoryDrawer = null"
    >
      <aside class="side-drawer">
        <header>
          <h2>{{ categoryDrawer === 'sessions' ? '会话分类' : '片段分类' }}</h2>
          <button type="button" @click="categoryDrawer = null">×</button>
        </header>

        <template v-if="categoryDrawer === 'sessions'">
          <button
            type="button"
            class="drawer-item"
            :class="{ active: selectedGroupId === 'all' }"
            @click="selectSessionGroup('all')"
          >
            <span>全部分组</span>
            <strong>{{ sshSessions.length }}</strong>
          </button>
          <button
            type="button"
            class="drawer-item"
            :class="{ active: selectedGroupId === 'ungrouped' }"
            @click="selectSessionGroup('ungrouped')"
          >
            <span>未分组</span>
            <strong>{{ ungroupedSessionCount }}</strong>
          </button>
          <button
            v-for="group in sessionGroupsWithCounts"
            :key="group.id"
            type="button"
            class="drawer-item"
            :class="{ active: selectedGroupId === group.id }"
            @click="selectSessionGroup(group.id)"
          >
            <span>{{ group.name }}</span>
            <strong>{{ group.count }}</strong>
          </button>
          <button type="button" class="secondary drawer-action" @click="openGroupEditor()">
            新增分组
          </button>
        </template>

        <template v-else>
          <button
            type="button"
            class="drawer-item"
            :class="{ active: selectedSnippetCategory === 'all' }"
            @click="selectSnippetCategory('all')"
          >
            <span>全部分类</span>
            <strong>{{ state.snippets.length }}</strong>
          </button>
          <button
            type="button"
            class="drawer-item"
            :class="{ active: selectedSnippetCategory === 'uncategorized' }"
            @click="selectSnippetCategory('uncategorized')"
          >
            <span>未分类</span>
            <strong>{{ uncategorizedSnippetCount }}</strong>
          </button>
          <button
            v-for="category in snippetCategoriesWithCounts"
            :key="category.name"
            type="button"
            class="drawer-item"
            :class="{ active: selectedSnippetCategory === category.name }"
            @click="selectSnippetCategory(category.name)"
          >
            <span>{{ category.name }}</span>
            <strong>{{ category.count }}</strong>
          </button>
        </template>
      </aside>
    </div>

    <div v-if="editor" class="modal-backdrop" @click.self="closeEditor">
      <form class="modal editor-modal" @submit.prevent="saveEditor">
        <header>
          <h2>{{ editorTitle }}</h2>
          <button type="button" @click="closeEditor">×</button>
        </header>

        <div v-if="editor.type === 'session'" class="form-grid">
          <label>
            名称
            <input v-model="sessionForm.name" required placeholder="Alpha VPS" />
          </label>
          <label>
            主机
            <input v-model="sessionForm.host" required placeholder="example.com" />
          </label>
          <label>
            端口
            <input v-model.number="sessionForm.port" required type="number" min="1" max="65535" />
          </label>
          <label>
            用户名
            <input v-model="sessionForm.username" required placeholder="root" />
          </label>
          <label>
            认证方式
            <select v-model="sessionForm.authType">
              <option value="password">密码</option>
              <option value="privateKey">SSH 密钥</option>
            </select>
          </label>
          <label v-if="sessionForm.authType === 'password'">
            密码
            <input v-model="sessionForm.password" type="password" autocomplete="new-password" />
          </label>
          <div v-else class="compound-field">
            <label>
              SSH 密钥
              <select v-model="sessionForm.privateKeyId">
                <option value="">选择密钥</option>
                <option v-for="key in state.sshKeys" :key="key.id" :value="key.id">
                  {{ key.name }}
                </option>
              </select>
            </label>
            <label>
              导入私钥文件
              <input type="file" accept=".pem,.key,.ppk,.txt,*" @change="importSessionKeyFile" />
            </label>
          </div>
          <label v-if="sessionForm.authType === 'privateKey'">
            密钥密码
            <input v-model="sessionForm.passphrase" type="password" autocomplete="new-password" />
          </label>
          <div class="compound-field">
            <label>
              分组
              <select v-model="sessionForm.group">
                <option value="">未分组</option>
                <option v-for="group in state.sessionGroups" :key="group.id" :value="group.id">
                  {{ group.name }}
                </option>
              </select>
            </label>
            <label>
              新分组名称
              <input v-model="sessionForm.newGroupName" placeholder="保存时自动创建并选中" />
            </label>
          </div>
          <label>
            服务商
            <input v-model="sessionForm.provider" placeholder="AlphaVPS" />
          </label>
          <label>
            地区
            <input v-model="sessionForm.region" placeholder="US" />
          </label>
          <label>
            到期时间
            <input v-model="sessionForm.expiryDate" type="date" />
          </label>
          <label>
            计费周期
            <select v-model="sessionForm.billingCycle">
              <option value="">未设置</option>
              <option value="monthly">月付</option>
              <option value="quarterly">季付</option>
              <option value="semi-annually">半年付</option>
              <option value="annually">年付</option>
              <option value="biennially">两年付</option>
              <option value="triennially">三年付</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            计费金额
            <input v-model.number="sessionForm.billingAmount" type="number" min="0" step="0.01" />
          </label>
          <label>
            货币
            <input v-model="sessionForm.billingCurrency" placeholder="CNY" />
          </label>
          <label>
            说明
            <textarea v-model="sessionForm.description" rows="3" />
          </label>
          <label>
            备注
            <textarea v-model="sessionForm.notes" rows="3" />
          </label>
        </div>

        <div v-else-if="editor.type === 'snippet'" class="form-grid">
          <label>
            名称
            <input v-model="snippetForm.name" required placeholder="查看磁盘" />
          </label>
          <label>
            命令
            <textarea v-model="snippetForm.command" required rows="5" placeholder="df -h" />
          </label>
          <label>
            描述
            <input v-model="snippetForm.description" placeholder="可选" />
          </label>
          <label>
            分类
            <input v-model="snippetForm.category" list="snippet-category-options" placeholder="system" />
            <datalist id="snippet-category-options">
              <option v-for="category in snippetCategoriesWithCounts" :key="category.name" :value="category.name" />
            </datalist>
          </label>
          <label>
            标签
            <input v-model="snippetForm.tagsText" placeholder="linux, disk" />
          </label>
        </div>

        <div v-else class="form-grid">
          <template v-if="editor.type === 'group'">
            <label>
              分组名称
              <input v-model="groupForm.name" required placeholder="生产服务器" />
            </label>
            <p v-if="groupForm.id" class="form-hint">
              删除分组不会删除会话，只会将该分组下的会话改为未分组。
            </p>
          </template>
          <template v-else>
          <label>
            名称
            <input v-model="keyForm.name" required placeholder="main-key" />
          </label>
          <label>
            类型
            <select v-model="keyForm.type">
              <option value="rsa">RSA</option>
              <option value="ed25519">ED25519</option>
              <option value="ecdsa">ECDSA</option>
            </select>
          </label>
          <label>
            导入私钥文件
            <input type="file" accept=".pem,.key,.ppk,.txt,*" @change="loadPrivateKeyFile" />
          </label>
          <label>
            导入公钥文件
            <input type="file" accept=".pub,.txt,*" @change="loadPublicKeyFile" />
          </label>
          <label>
            公钥
            <textarea v-model="keyForm.publicKey" rows="4" placeholder="ssh-ed25519 ..." />
          </label>
          <label>
            私钥
            <textarea
              v-model="keyForm.privateKeyContent"
              rows="8"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </label>
          <label>
            指纹
            <input v-model="keyForm.fingerprint" placeholder="留空会自动按公钥/私钥内容生成" />
          </label>
          <label>
            备注
            <input v-model="keyForm.comment" placeholder="可选" />
          </label>
          <label class="checkbox-row">
            <input v-model="keyForm.protected" type="checkbox" />
            私钥有密码保护
          </label>
          </template>
        </div>

        <div class="form-actions">
          <button type="submit">保存</button>
          <button type="button" class="secondary" @click="closeEditor">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { App as CapacitorApp } from '@capacitor/app'
import type { SessionConfig, SessionGroup } from '@/types/session'
import type { MobileSnippet, MobileSSHKey, MobileStoreState } from './types'
import { createMobileId, mobileStore } from './services/mobile-store'
import {
  closeSshShell,
  disconnectSshSession,
  executeSshCommand,
  onSshShellData,
  openSshShell,
  openSshSession,
  writeSshShell
} from './services/android-ssh'
import { securityStore, type SecuritySettings } from './services/security-store'
import {
  appSettingsStore,
  type MobileAppSettings,
  type TerminalInputMode
} from './services/app-settings'
import { stripTerminalControlSequences } from './services/terminal-output'
import ImportPanel from './components/ImportPanel.vue'
import ExportPanel from './components/ExportPanel.vue'
import RemoteSyncPanel from './components/RemoteSyncPanel.vue'
import AppSettingsPanel from './components/AppSettingsPanel.vue'
import LockScreen from './components/LockScreen.vue'
import SecurityPanel from './components/SecurityPanel.vue'
import 'xterm/css/xterm.css'

type TabId = 'sessions' | 'snippets' | 'keys' | 'sync'
type SettingsTabId = 'sync' | 'import' | 'export' | 'terminal' | 'security'
type CategoryDrawer = 'sessions' | 'snippets'
type TerminalStatus = 'idle' | 'connecting' | 'connected' | 'error'
interface TerminalWindow {
  id: string
  status: TerminalStatus
  session: SessionConfig
  sessionId?: string
  output: string
  command: string
  inputMode: TerminalInputMode
  shellOpen: boolean
  snippetPanel: boolean
  snippetQuery: string
  snippetCategory: string
  minimized: boolean
}

interface TerminalRuntime {
  terminal: XTerm
  fitAddon: FitAddon
  disposables: Array<{ dispose: () => void }>
  touchScrollHost?: HTMLElement
  disposeTouchScroll?: () => void
}

type EditorState =
  | { type: 'session'; mode: 'create' | 'edit'; id?: string }
  | { type: 'snippet'; mode: 'create' | 'edit'; id?: string }
  | { type: 'key'; mode: 'create' | 'edit'; id?: string }
  | { type: 'group'; mode: 'create' | 'edit'; id?: string }

const tabs: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'sessions', label: '会话', icon: '⌁' },
  { id: 'snippets', label: '片段', icon: '⌘' },
  { id: 'keys', label: '密钥', icon: '◇' },
  { id: 'sync', label: '设置', icon: '⚙' }
]

const settingsTabs: Array<{
  id: SettingsTabId
  label: string
  icon: string
  description: string
}> = [
  { id: 'sync', label: '同步', icon: '⇄', description: '管理远程同步和云端配置' },
  { id: 'import', label: '导入', icon: '⇪', description: '导入桌面端备份或同步数据' },
  { id: 'export', label: '导出', icon: '⇩', description: '导出当前手机端数据备份' },
  { id: 'terminal', label: '终端', icon: '⌁', description: '设置终端输入模式' },
  { id: 'security', label: '安全', icon: '锁', description: '管理 PIN、系统验证和前台重新锁定' }
]

const activeTab = ref<TabId>('sessions')
const activeSettingsTab = ref<SettingsTabId>('sync')
const showImport = ref(false)
const state = ref<MobileStoreState>(mobileStore.load())
const securitySettings = ref<SecuritySettings>(securityStore.load())
const appSettings = ref<MobileAppSettings>(appSettingsStore.load())
const isLocked = ref(securityStore.isLockRequired() && securitySettings.value.lockOnStart)
const selectedSessionId = ref('')
const connectionMessage = ref('')
const terminalWindows = ref<TerminalWindow[]>([])
const activeTerminalId = ref('')
const showTerminalSwitcher = ref(false)
const snippetQuery = ref('')
const selectedGroupId = ref('all')
const selectedSnippetCategory = ref('all')
const categoryDrawer = ref<CategoryDrawer | null>(null)
const editor = ref<EditorState | null>(null)
const lastSessionTap = ref<{ id: string; at: number }>({ id: '', at: 0 })
const sessionActionMenu = ref<SessionConfig | null>(null)
const terminalOutputRef = ref<HTMLElement | null>(null)
const terminalRuntimes = new Map<string, TerminalRuntime>()

const sessionForm = reactive({
  id: '',
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password' as SessionConfig['authType'],
  password: '',
  privateKeyId: '',
  passphrase: '',
  group: '',
  newGroupName: '',
  provider: '',
  region: '',
  expiryDate: '',
  billingCycle: '' as '' | NonNullable<SessionConfig['billingCycle']>,
  billingAmount: undefined as number | undefined,
  billingCurrency: '',
  description: '',
  notes: '',
  createdAt: new Date()
})

const snippetForm = reactive({
  id: '',
  name: '',
  command: '',
  description: '',
  category: '',
  tagsText: '',
  createdAt: ''
})

const groupForm = reactive({
  id: '',
  name: ''
})

const keyForm = reactive({
  id: '',
  name: '',
  type: 'rsa' as MobileSSHKey['type'],
  publicKey: '',
  privateKeyContent: '',
  fingerprint: '',
  comment: '',
  protected: false,
  createdAt: ''
})
let removeShellDataListener: (() => Promise<void>) | undefined
let removeBackButtonListener: (() => Promise<void>) | undefined

const activeTitle = computed(
  () => tabs.find((tab) => tab.id === activeTab.value)?.label || 'MShell'
)
const activeSettingsTabDescription = computed(
  () => settingsTabs.find((tab) => tab.id === activeSettingsTab.value)?.description || '管理设置'
)

const closeTransientUi = () => {
  showImport.value = false
  showTerminalSwitcher.value = false
  categoryDrawer.value = null
  editor.value = null
  sessionActionMenu.value = null
}

const requireUnlock = () => {
  if (!securityStore.isLockRequired()) return false
  closeTransientUi()
  isLocked.value = true
  return true
}

const editorTitle = computed(() => {
  if (!editor.value) return ''
  const action = editor.value.mode === 'create' ? '新增' : '编辑'
  const target =
    editor.value.type === 'session'
      ? 'SSH 会话'
      : editor.value.type === 'snippet'
        ? '命令片段'
        : editor.value.type === 'group'
          ? '会话分组'
          : 'SSH 密钥'
  return `${action}${target}`
})
const sshSessions = computed(() =>
  state.value.sessions.filter(
    (session) => session.type !== 'rdp' && session.type !== 'vnc' && session.type !== 'ipmi'
  )
)
const sessionGroupsWithCounts = computed(() =>
  state.value.sessionGroups.map((group) => ({
    ...group,
    count: sshSessions.value.filter((session) => session.group === group.id).length
  }))
)
const selectedSessionGroup = computed(() =>
  sessionGroupsWithCounts.value.find((group) => group.id === selectedGroupId.value)
)
const ungroupedSessionCount = computed(
  () => sshSessions.value.filter((session) => !session.group).length
)
const filteredSessions = computed(() => {
  if (selectedGroupId.value === 'all') return sshSessions.value
  if (selectedGroupId.value === 'ungrouped') {
    return sshSessions.value.filter((session) => !session.group)
  }
  return sshSessions.value.filter((session) => session.group === selectedGroupId.value)
})
const selectedSession = computed<SessionConfig | undefined>(() =>
  sshSessions.value.find((session) => session.id === selectedSessionId.value)
)
const snippetCategoriesWithCounts = computed(() => {
  const counts = new Map<string, number>()
  state.value.snippets.forEach((snippet) => {
    const category = snippet.category.trim()
    if (!category) return
    counts.set(category, (counts.get(category) || 0) + 1)
  })
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
})
const uncategorizedSnippetCount = computed(
  () => state.value.snippets.filter((snippet) => !snippet.category.trim()).length
)
const filteredSnippets = computed(() => {
  const query = snippetQuery.value.trim().toLowerCase()
  const byCategory =
    selectedSnippetCategory.value === 'all'
      ? state.value.snippets
      : selectedSnippetCategory.value === 'uncategorized'
        ? state.value.snippets.filter((snippet) => !snippet.category.trim())
        : state.value.snippets.filter((snippet) => snippet.category === selectedSnippetCategory.value)
  if (!query) return byCategory
  return byCategory.filter((snippet) =>
    [snippet.name, snippet.command, snippet.description, snippet.category, snippet.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
})
const activeTerminal = computed(() =>
  terminalWindows.value.find((terminal) => terminal.id === activeTerminalId.value)
)
const visibleTerminal = computed(() => {
  const terminal = activeTerminal.value
  return terminal && !terminal.minimized ? terminal : undefined
})
const isTerminalConnecting = computed(() =>
  terminalWindows.value.some((terminal) => terminal.status === 'connecting')
)
const terminalSnippets = computed(() => {
  const terminal = visibleTerminal.value
  const query = terminal?.snippetQuery.trim().toLowerCase() || ''
  const category = terminal?.snippetCategory || 'all'
  const byCategory =
    category === 'all'
      ? state.value.snippets
      : category === 'uncategorized'
        ? state.value.snippets.filter((snippet) => !snippet.category.trim())
        : state.value.snippets.filter((snippet) => snippet.category === category)

  if (!query) return byCategory.slice(0, 20)
  return byCategory
    .filter((snippet) =>
      [snippet.name, snippet.command, snippet.description, snippet.category, snippet.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
    .slice(0, 20)
})

watch(
  () => `${visibleTerminal.value?.id || ''}:${visibleTerminal.value?.inputMode || ''}`,
  () => {
    void syncVisibleTerminalRuntime()
  },
  { flush: 'post' }
)

const billingCycleLabels: Record<NonNullable<SessionConfig['billingCycle']>, string> = {
  monthly: '月付',
  quarterly: '季付',
  'semi-annually': '半年付',
  annually: '年付',
  biennially: '两年付',
  triennially: '三年付',
  custom: '自定义'
}

onMounted(() => {
  mobileStore.subscribe((nextState) => {
    state.value = nextState
    if (!selectedSessionId.value && filteredSessions.value[0]) {
      selectedSessionId.value = filteredSessions.value[0].id
    }
    if (
      selectedGroupId.value !== 'all' &&
      selectedGroupId.value !== 'ungrouped' &&
      !nextState.sessionGroups.some((group) => group.id === selectedGroupId.value)
    ) {
      selectedGroupId.value = 'all'
    }
    if (
      selectedSnippetCategory.value !== 'all' &&
      selectedSnippetCategory.value !== 'uncategorized' &&
      !nextState.snippets.some((snippet) => snippet.category === selectedSnippetCategory.value)
    ) {
      selectedSnippetCategory.value = 'all'
    }
  })
  securityStore.subscribe((settings) => {
    securitySettings.value = settings
    if (!securityStore.isLockRequired()) {
      isLocked.value = false
    }
  })
  appSettingsStore.subscribe((settings) => {
    appSettings.value = settings
  })
  onSshShellData((event) => {
    const terminal = terminalWindows.value.find((item) => item.sessionId === event.sessionId)
    if (terminal) {
      appendShellDataToTerminal(terminal, event.data)
    }
  }).then((listener) => {
    removeShellDataListener = listener.remove
  }).catch((error) => {
    console.warn('[MobileApp] Failed to register shell output listener', error)
  })
  CapacitorApp.addListener('backButton', () => {
    void handleAndroidBackButton()
  }).then((listener) => {
    removeBackButtonListener = listener.remove
  }).catch((error) => {
    console.warn('[MobileApp] Failed to register Android back button listener', error)
  })
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  removeShellDataListener?.()
  removeBackButtonListener?.()
  disposeAllTerminalRuntimes()
})

const handleVisibilityChange = () => {
  if (
    (document.visibilityState === 'hidden' || document.visibilityState === 'visible') &&
    securityStore.isLockRequired() &&
    securitySettings.value.lockOnResume
  ) {
    requireUnlock()
  }
}

const handleAndroidBackButton = async () => {
  if (isLocked.value && securitySettings.value.enabled) {
    await CapacitorApp.exitApp()
    return
  }

  if (showTerminalSwitcher.value) {
    showTerminalSwitcher.value = false
    return
  }
  if (showImport.value) {
    showImport.value = false
    return
  }
  if (sessionActionMenu.value) {
    closeSessionActions()
    return
  }
  if (categoryDrawer.value) {
    categoryDrawer.value = null
    return
  }
  if (editor.value) {
    closeEditor()
    return
  }

  const terminal = visibleTerminal.value
  if (terminal?.snippetPanel) {
    terminal.snippetPanel = false
    return
  }
  if (terminal) {
    minimizeTerminal(terminal.id)
    return
  }

  if (activeTab.value === 'sync' && activeSettingsTab.value !== 'sync') {
    activeSettingsTab.value = 'sync'
    return
  }
  if (activeTab.value !== 'sessions') {
    switchTab('sessions')
    return
  }
  if (selectedGroupId.value !== 'all') {
    selectedGroupId.value = 'all'
    selectedSessionId.value = filteredSessions.value[0]?.id || ''
    return
  }

  await CapacitorApp.exitApp()
}

const unlockApp = () => {
  isLocked.value = false
}

const lockApp = () => {
  if (!requireUnlock()) {
    activeTab.value = 'sync'
    activeSettingsTab.value = 'security'
  }
}

const refreshState = () => {
  state.value = mobileStore.getState()
  if (!selectedSessionId.value && filteredSessions.value[0]) {
    selectedSessionId.value = filteredSessions.value[0].id
  }
}

const handleModalImported = () => {
  refreshState()
  showImport.value = false
}

const openCategoryDrawer = (type: CategoryDrawer) => {
  categoryDrawer.value = type
}

const selectSessionGroup = (id: string) => {
  selectedGroupId.value = id
  selectedSessionId.value = filteredSessions.value[0]?.id || ''
  categoryDrawer.value = null
}

const selectSnippetCategory = (category: string) => {
  selectedSnippetCategory.value = category
  categoryDrawer.value = null
}

const switchTab = (tab: TabId) => {
  minimizeActiveTerminal()
  activeTab.value = tab
}

const copySnippetCommand = async (command: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command)
    } else {
      const textArea = document.createElement('textarea')
      textArea.value = command
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
    connectionMessage.value = '命令已复制'
  } catch {
    connectionMessage.value = '复制失败，请长按命令手动复制'
  }
}

const selectSession = (session: SessionConfig) => {
  const now = Date.now()
  const isDoubleTap = lastSessionTap.value.id === session.id && now - lastSessionTap.value.at < 420
  selectedSessionId.value = session.id
  connectionMessage.value = `已选择 ${session.name}`
  lastSessionTap.value = { id: session.id, at: now }
  if (isDoubleTap) {
    openTerminal(session)
  }
}

const openSelectedOrFirstTerminal = async () => {
  const session = selectedSession.value || filteredSessions.value[0]
  if (!session) {
    connectionMessage.value = '没有可连接的 SSH 会话'
    return
  }
  selectedSessionId.value = session.id
  await openTerminal(session)
}

const openSessionActions = (session: SessionConfig) => {
  selectedSessionId.value = session.id
  sessionActionMenu.value = session
}

const closeSessionActions = () => {
  sessionActionMenu.value = null
}

const connectFromSessionActions = async () => {
  const session = sessionActionMenu.value
  if (!session) return
  closeSessionActions()
  await openTerminal(session)
}

const editFromSessionActions = () => {
  const session = sessionActionMenu.value
  if (!session) return
  closeSessionActions()
  openSessionEditor(session)
}

const deleteFromSessionActions = () => {
  const session = sessionActionMenu.value
  if (!session) return
  deleteSession(session.id)
  if (!state.value.sessions.some((item) => item.id === session.id)) {
    closeSessionActions()
  }
}

const openTerminal = async (session: SessionConfig) => {
  terminalWindows.value.forEach((terminal) => {
    terminal.minimized = true
  })
  const terminal: TerminalWindow = {
    id: createMobileId('terminal'),
    status: 'connecting',
    session,
    sessionId: undefined,
    output: `正在连接 ${session.username}@${session.host}:${session.port}...\n`,
    command: '',
    inputMode: appSettings.value.terminalInputMode,
    shellOpen: false,
    snippetPanel: false,
    snippetQuery: '',
    snippetCategory: 'all',
    minimized: false
  }
  terminalWindows.value.push(terminal)
  activeTerminalId.value = terminal.id
  showTerminalSwitcher.value = false
  selectedSessionId.value = session.id
  connectionMessage.value = `正在打开 ${session.name}`

  try {
    const result = await openSshSession(session, state.value.sshKeys)
    const currentTerminal = findTerminal(terminal.id)
    if (!currentTerminal) {
      if (result.sessionId) {
        await disconnectSshSession(result.sessionId)
      }
      return
    }
    if (!result.success || !result.sessionId) {
      currentTerminal.status = 'error'
      currentTerminal.output += `${result.error || 'SSH 连接失败'}\n`
      connectionMessage.value = result.error || `连接 ${session.name} 失败`
      return
    }

    currentTerminal.status = 'connected'
    currentTerminal.sessionId = result.sessionId
    if (currentTerminal.inputMode === 'direct-terminal') {
      const runtime = await prepareVisibleTerminalRuntime(currentTerminal)
      const shell = await openSshShell(result.sessionId, {
        cols: runtime.terminal.cols || 80,
        rows: runtime.terminal.rows || 24
      })
      if (!shell.success) {
        appendLocalTerminalOutput(
          currentTerminal,
          `${shell.error || 'Shell 通道打开失败，已切回命令框模式'}\n`
        )
        currentTerminal.inputMode = 'command-box'
        disposeTerminalRuntime(currentTerminal.id)
      } else {
        currentTerminal.shellOpen = true
        appendLocalTerminalOutput(currentTerminal, `已连接。点击终端区域后可直接输入。\n`)
        await syncVisibleTerminalRuntime()
        focusVisibleTerminal()
      }
    } else {
      currentTerminal.output += `已连接。输入命令后点击执行，支持多行。\n`
    }
    connectionMessage.value = `已打开 ${session.name}`
  } catch (error) {
    const currentTerminal = findTerminal(terminal.id)
    if (!currentTerminal) return
    currentTerminal.status = 'error'
    const message = error instanceof Error ? error.message : `连接 ${session.name} 失败`
    currentTerminal.output += `${message}\n`
    connectionMessage.value = message
  }
}

const findTerminal = (id: string) =>
  terminalWindows.value.find((terminal) => terminal.id === id)

const getTerminalStatusText = (terminal: TerminalWindow) => {
  if (terminal.status === 'connecting') return '正在连接...'
  if (terminal.status === 'connected') return '已连接'
  if (terminal.status === 'error') return '连接失败'
  return '未连接'
}

const createTerminalRuntime = (terminalWindow: TerminalWindow): TerminalRuntime => {
  const terminal = new XTerm({
    cols: 80,
    rows: 24,
    cursorBlink: true,
    convertEol: true,
    disableStdin: true,
    fontFamily: "'Cascadia Mono', 'SFMono-Regular', Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.35,
    scrollback: 5000,
    theme: {
      background: '#050812',
      foreground: '#d1fae5',
      cursor: '#bbf7d0',
      selectionBackground: '#2563eb66',
      black: '#020617',
      red: '#f87171',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e5e7eb',
      brightBlack: '#64748b',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#ffffff'
    }
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  const runtime: TerminalRuntime = {
    terminal,
    fitAddon,
    disposables: [
      terminal.onData((data) => {
        const currentTerminal = findTerminal(terminalWindow.id)
        if (
          !currentTerminal ||
          currentTerminal.inputMode !== 'direct-terminal' ||
          currentTerminal.status !== 'connected' ||
          !currentTerminal.shellOpen ||
          !currentTerminal.sessionId
        ) {
          return
        }
        void writeSshShell(currentTerminal.sessionId, data)
      })
    ]
  }

  terminalRuntimes.set(terminalWindow.id, runtime)
  if (terminalWindow.output) {
    terminal.write(formatLocalTerminalOutput(terminalWindow.output))
  }
  return runtime
}

const ensureTerminalRuntime = (terminal: TerminalWindow): TerminalRuntime =>
  terminalRuntimes.get(terminal.id) || createTerminalRuntime(terminal)

const getTerminalTouchLineHeight = (terminal: XTerm) => {
  const fontSize = typeof terminal.options.fontSize === 'number' ? terminal.options.fontSize : 12
  const lineHeight = typeof terminal.options.lineHeight === 'number' ? terminal.options.lineHeight : 1
  return Math.max(8, fontSize * lineHeight)
}

const attachTerminalTouchScroll = (runtime: TerminalRuntime, host: HTMLElement) => {
  if (runtime.touchScrollHost === host) return

  runtime.disposeTouchScroll?.()

  let startX = 0
  let startY = 0
  let lastY = 0
  let remainder = 0
  let isVerticalScroll = false

  const resetTouchScroll = () => {
    startX = 0
    startY = 0
    lastY = 0
    remainder = 0
    isVerticalScroll = false
  }

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      resetTouchScroll()
      return
    }
    const touch = event.touches[0]
    startX = touch.clientX
    startY = touch.clientY
    lastY = touch.clientY
    remainder = 0
    isVerticalScroll = false
  }

  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      resetTouchScroll()
      return
    }

    const touch = event.touches[0]
    const totalX = touch.clientX - startX
    const totalY = touch.clientY - startY

    if (!isVerticalScroll) {
      const absX = Math.abs(totalX)
      const absY = Math.abs(totalY)
      if (absX < 6 && absY < 6) return
      if (absY <= absX * 1.2) {
        lastY = touch.clientY
        return
      }
      isVerticalScroll = true
    }

    const deltaY = lastY - touch.clientY
    lastY = touch.clientY
    if (deltaY === 0) return

    remainder += deltaY / getTerminalTouchLineHeight(runtime.terminal)
    const lines = remainder > 0 ? Math.floor(remainder) : Math.ceil(remainder)
    if (lines !== 0) {
      runtime.terminal.scrollLines(lines)
      remainder -= lines
    }

    event.preventDefault()
    event.stopPropagation()
  }

  const options: AddEventListenerOptions = { capture: true }
  const moveOptions: AddEventListenerOptions = { capture: true, passive: false }
  host.addEventListener('touchstart', handleTouchStart, options)
  host.addEventListener('touchmove', handleTouchMove, moveOptions)
  host.addEventListener('touchend', resetTouchScroll, options)
  host.addEventListener('touchcancel', resetTouchScroll, options)

  runtime.touchScrollHost = host
  runtime.disposeTouchScroll = () => {
    host.removeEventListener('touchstart', handleTouchStart, options)
    host.removeEventListener('touchmove', handleTouchMove, moveOptions)
    host.removeEventListener('touchend', resetTouchScroll, options)
    host.removeEventListener('touchcancel', resetTouchScroll, options)
    if (runtime.touchScrollHost === host) {
      runtime.touchScrollHost = undefined
      runtime.disposeTouchScroll = undefined
    }
  }
}

const attachTerminalRuntime = (runtime: TerminalRuntime, host: HTMLElement) => {
  if (!runtime.terminal.element) {
    runtime.terminal.open(host)
  } else if (!host.contains(runtime.terminal.element)) {
    host.replaceChildren(runtime.terminal.element)
  }
  attachTerminalTouchScroll(runtime, host)
  fitTerminalRuntime(runtime)
}

const fitTerminalRuntime = (runtime: TerminalRuntime) => {
  window.requestAnimationFrame(() => {
    try {
      runtime.fitAddon.fit()
    } catch (error) {
      console.warn('[MobileApp] Failed to fit mobile terminal', error)
    }
  })
}

const syncVisibleTerminalRuntime = async () => {
  await nextTick()
  const terminal = visibleTerminal.value
  const host = terminalOutputRef.value
  if (!terminal || terminal.inputMode !== 'direct-terminal' || !host) return

  const runtime = ensureTerminalRuntime(terminal)
  attachTerminalRuntime(runtime, host)
  runtime.terminal.options.disableStdin =
    terminal.status !== 'connected' || !terminal.shellOpen || !terminal.sessionId
}

const prepareVisibleTerminalRuntime = async (terminal: TerminalWindow): Promise<TerminalRuntime> => {
  const runtime = ensureTerminalRuntime(terminal)
  await syncVisibleTerminalRuntime()
  return runtime
}

const focusVisibleTerminal = () => {
  const terminal = visibleTerminal.value
  if (!terminal) return
  terminalRuntimes.get(terminal.id)?.terminal.focus()
}

const formatLocalTerminalOutput = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')

const appendLocalTerminalOutput = (terminal: TerminalWindow, value: string) => {
  terminal.output += value
  if (terminal.inputMode === 'direct-terminal') {
    ensureTerminalRuntime(terminal).terminal.write(formatLocalTerminalOutput(value))
  }
}

const appendShellDataToTerminal = (terminal: TerminalWindow, data: string) => {
  if (terminal.inputMode === 'direct-terminal') {
    ensureTerminalRuntime(terminal).terminal.write(data)
    return
  }
  terminal.output += stripTerminalControlSequences(data)
}

const appendCommandResultOutput = (terminal: TerminalWindow, output: string) => {
  const normalizedOutput = stripTerminalControlSequences(output)
  if (!normalizedOutput) return
  terminal.output += normalizedOutput.endsWith('\n') ? normalizedOutput : `${normalizedOutput}\n`
}

const disposeTerminalRuntime = (id: string) => {
  const runtime = terminalRuntimes.get(id)
  if (!runtime) return
  runtime.disposeTouchScroll?.()
  runtime.disposables.forEach((disposable) => disposable.dispose())
  runtime.terminal.dispose()
  terminalRuntimes.delete(id)
}

const disposeAllTerminalRuntimes = () => {
  Array.from(terminalRuntimes.keys()).forEach(disposeTerminalRuntime)
}

const minimizeActiveTerminal = () => {
  const terminal = activeTerminal.value
  if (terminal) {
    terminal.minimized = true
  }
  showTerminalSwitcher.value = false
}

const minimizeTerminal = (id: string) => {
  const terminal = findTerminal(id)
  if (terminal) {
    terminal.minimized = true
  }
}

const restoreTerminal = (id: string) => {
  const terminal = findTerminal(id)
  if (!terminal) return
  terminalWindows.value.forEach((windowItem) => {
    windowItem.minimized = windowItem.id !== id
  })
  activeTerminalId.value = id
  showTerminalSwitcher.value = false
}

const executeTerminalCommand = async (terminal?: TerminalWindow) => {
  if (!terminal) return
  const command = terminal.command
  if (!command.trim() || terminal.status !== 'connected' || !terminal.sessionId) return
  terminal.command = ''
  await executeCommandInTerminal(command, terminal)
}

const handleCommandBoxKeydown = (event: KeyboardEvent, terminal: TerminalWindow) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    executeTerminalCommand(terminal)
  }
}

const executeCommandInTerminal = async (command: string, terminal: TerminalWindow) => {
  const sessionId = terminal.sessionId
  if (!sessionId) return
  terminal.output += `\n$ ${command}\n`
  try {
    const result = await executeSshCommand(sessionId, command)
    const currentTerminal = findTerminal(terminal.id)
    if (!currentTerminal) return
    if (result.output) {
      appendCommandResultOutput(currentTerminal, result.output)
    }
    if (!result.success) {
      currentTerminal.output += `${result.error || '命令执行失败'}\n`
    }
  } catch (error) {
    const currentTerminal = findTerminal(terminal.id)
    if (currentTerminal) {
      currentTerminal.output += `${error instanceof Error ? error.message : '命令执行失败'}\n`
    }
  }
}

const executeSnippetInTerminal = async (command: string, terminal?: TerminalWindow) => {
  if (!terminal || terminal.status !== 'connected' || !terminal.sessionId) return
  terminal.snippetPanel = false
  if (terminal.inputMode === 'direct-terminal' && terminal.shellOpen) {
    await writeSshShell(terminal.sessionId, `${command.replace(/\r\n/g, '\r').replace(/\n/g, '\r')}\r`)
    return
  }
  await executeCommandInTerminal(command, terminal)
}

const closeTerminal = async (id = activeTerminalId.value) => {
  const index = terminalWindows.value.findIndex((terminal) => terminal.id === id)
  if (index === -1) return
  const [terminal] = terminalWindows.value.splice(index, 1)
  const sessionId = terminal.sessionId
  if (activeTerminalId.value === id) {
    const nextTerminal = terminalWindows.value[index] || terminalWindows.value[index - 1]
    activeTerminalId.value = nextTerminal?.id || ''
    if (nextTerminal && !terminal.minimized) {
      nextTerminal.minimized = false
    }
  }
  if (terminalWindows.value.length === 0) {
    showTerminalSwitcher.value = false
  }
  if (sessionId) {
    if (terminal.shellOpen) {
      await closeSshShell(sessionId)
    }
    await disconnectSshSession(sessionId)
  }
  disposeTerminalRuntime(id)
}

const openSessionEditor = (session?: SessionConfig) => {
  const now = new Date()
  Object.assign(sessionForm, {
    id: session?.id || createMobileId('session'),
    name: session?.name || '',
    host: session?.host || '',
    port: session?.port || 22,
    username: session?.username || 'root',
    authType: session?.authType || 'password',
    password: session?.password || '',
    privateKeyId: session?.privateKeyId || '',
    passphrase: session?.passphrase || '',
    group: session?.group || '',
    newGroupName: '',
    provider: session?.provider || '',
    region: session?.region || '',
    expiryDate: formatDateInput(session?.expiryDate),
    billingCycle: session?.billingCycle || '',
    billingAmount: session?.billingAmount,
    billingCurrency: session?.billingCurrency || '',
    description: session?.description || '',
    notes: session?.notes || '',
    createdAt: session?.createdAt || now
  })
  editor.value = { type: 'session', mode: session ? 'edit' : 'create', id: session?.id }
}

const openSnippetEditor = (snippet?: MobileSnippet) => {
  const now = new Date().toISOString()
  Object.assign(snippetForm, {
    id: snippet?.id || createMobileId('snippet'),
    name: snippet?.name || '',
    command: snippet?.command || '',
    description: snippet?.description || '',
    category: snippet?.category || '',
    tagsText: snippet?.tags?.join(', ') || '',
    createdAt: snippet?.createdAt || now
  })
  editor.value = { type: 'snippet', mode: snippet ? 'edit' : 'create', id: snippet?.id }
}

const openGroupEditor = (group?: SessionGroup) => {
  categoryDrawer.value = null
  Object.assign(groupForm, {
    id: group?.id || createMobileId('group'),
    name: group?.name || ''
  })
  editor.value = { type: 'group', mode: group ? 'edit' : 'create', id: group?.id }
}

const openKeyEditor = (key?: MobileSSHKey) => {
  const now = new Date().toISOString()
  Object.assign(keyForm, {
    id: key?.id || createMobileId('key'),
    name: key?.name || '',
    type: key?.type || 'rsa',
    publicKey: key?.publicKey || key?.publicKeyContent || '',
    privateKeyContent: key?.privateKeyContent || '',
    fingerprint: key?.fingerprint || '',
    comment: key?.comment || '',
    protected: key?.protected || false,
    createdAt: key?.createdAt || now
  })
  editor.value = { type: 'key', mode: key ? 'edit' : 'create', id: key?.id }
}

const closeEditor = () => {
  editor.value = null
}

const saveEditor = async () => {
  if (!editor.value) return
  if (editor.value.type === 'session') {
    saveSession()
  } else if (editor.value.type === 'snippet') {
    saveSnippet()
  } else if (editor.value.type === 'group') {
    saveGroup()
  } else {
    await saveKey()
  }
  closeEditor()
}

const saveSession = () => {
  const existing = state.value.sessions.find((session) => session.id === sessionForm.id)
  const groupId = resolveSessionGroupId()
  const nextSession: SessionConfig = {
    ...(existing || ({} as SessionConfig)),
    id: sessionForm.id,
    name: sessionForm.name.trim(),
    type: 'ssh',
    host: sessionForm.host.trim(),
    port: Number(sessionForm.port) || 22,
    username: sessionForm.username.trim(),
    authType: sessionForm.authType,
    password: sessionForm.authType === 'password' ? sessionForm.password : undefined,
    privateKeyId: sessionForm.authType === 'privateKey' ? sessionForm.privateKeyId || undefined : undefined,
    passphrase: sessionForm.authType === 'privateKey' ? sessionForm.passphrase || undefined : undefined,
    group: groupId,
    provider: sessionForm.provider.trim() || undefined,
    region: sessionForm.region.trim() || undefined,
    expiryDate: sessionForm.expiryDate ? parseDateInput(sessionForm.expiryDate) : undefined,
    billingCycle: sessionForm.billingCycle || undefined,
    billingAmount:
      sessionForm.billingAmount !== undefined && Number.isFinite(Number(sessionForm.billingAmount))
        ? Number(sessionForm.billingAmount)
        : undefined,
    billingCurrency: sessionForm.billingCurrency.trim() || undefined,
    description: sessionForm.description.trim() || undefined,
    notes: sessionForm.notes.trim() || undefined,
    createdAt: existing?.createdAt || sessionForm.createdAt || new Date(),
    updatedAt: new Date()
  }

  mobileStore.upsertSession(nextSession)
  if (groupId) {
    selectedGroupId.value = groupId
  }
  selectedSessionId.value = nextSession.id
  refreshState()
}

const resolveSessionGroupId = (): string | undefined => {
  const newName = sessionForm.newGroupName.trim()
  if (!newName) {
    return sessionForm.group.trim() || undefined
  }

  const existing = state.value.sessionGroups.find((group) => group.name === newName)
  if (existing) {
    return existing.id
  }

  const id = createMobileId('group')
  mobileStore.upsertSessionGroup({ id, name: newName, sessions: [] })
  return id
}

const saveSnippet = () => {
  const existing = state.value.snippets.find((snippet) => snippet.id === snippetForm.id)
  const now = new Date().toISOString()
  const nextSnippet: MobileSnippet = {
    ...(existing || ({} as MobileSnippet)),
    id: snippetForm.id,
    name: snippetForm.name.trim(),
    command: snippetForm.command,
    description: snippetForm.description.trim(),
    category: snippetForm.category.trim(),
    tags: parseTags(snippetForm.tagsText),
    variables: existing?.variables || [],
    usageCount: existing?.usageCount || 0,
    createdAt: existing?.createdAt || snippetForm.createdAt || now,
    updatedAt: now
  }
  mobileStore.upsertSnippet(nextSnippet)
  refreshState()
}

const saveKey = async () => {
  const existing = state.value.sshKeys.find((key) => key.id === keyForm.id)
  const now = new Date().toISOString()
  const publicKey = keyForm.publicKey.trim()
  const privateKeyContent = keyForm.privateKeyContent.trim()
  const fingerprint =
    keyForm.fingerprint.trim() || (await createFingerprint(publicKey || privateKeyContent || keyForm.name))
  const nextKey: MobileSSHKey = {
    ...(existing || ({} as MobileSSHKey)),
    id: keyForm.id,
    name: keyForm.name.trim(),
    type: keyForm.type,
    publicKey,
    fingerprint,
    comment: keyForm.comment.trim() || undefined,
    createdAt: existing?.createdAt || keyForm.createdAt || now,
    usageCount: existing?.usageCount || 0,
    protected: keyForm.protected,
    privateKeyContent: privateKeyContent || existing?.privateKeyContent,
    publicKeyContent: publicKey || existing?.publicKeyContent
  }
  mobileStore.upsertKey(nextKey)
  refreshState()
}

const saveGroup = () => {
  mobileStore.upsertSessionGroup({
    id: groupForm.id,
    name: groupForm.name.trim(),
    sessions: state.value.sessions
      .filter((session) => session.group === groupForm.id)
      .map((session) => session.id)
  })
  selectedGroupId.value = groupForm.id
  refreshState()
}

const loadPrivateKeyFile = async (event: Event) => {
  const content = await readSelectedFile(event)
  if (!content) return
  keyForm.privateKeyContent = content
  keyForm.type = detectKeyType(content)
  keyForm.protected = keyForm.protected || isEncryptedPrivateKey(content)
  if (!keyForm.name) {
    keyForm.name = selectedFileName(event)
  }
  if (!keyForm.fingerprint) {
    keyForm.fingerprint = await createFingerprint(content)
  }
}

const loadPublicKeyFile = async (event: Event) => {
  const content = await readSelectedFile(event)
  if (!content) return
  keyForm.publicKey = content.trim()
  keyForm.fingerprint = await createFingerprint(keyForm.publicKey)
  if (!keyForm.name) {
    keyForm.name = selectedFileName(event)
  }
}

const importSessionKeyFile = async (event: Event) => {
  const content = await readSelectedFile(event)
  if (!content) return
  const name = selectedFileName(event) || 'imported-key'
  const id = createMobileId('key')
  const publicKey = ''
  const key: MobileSSHKey = {
    id,
    name,
    type: detectKeyType(content),
    publicKey,
    fingerprint: await createFingerprint(content),
    createdAt: new Date().toISOString(),
    usageCount: 0,
    protected: isEncryptedPrivateKey(content),
    privateKeyContent: content,
    publicKeyContent: publicKey
  }
  mobileStore.upsertKey(key)
  refreshState()
  sessionForm.privateKeyId = id
}

const deleteSession = (id: string) => {
  if (!window.confirm('删除这个 SSH 会话？')) return
  mobileStore.deleteSession(id)
  if (selectedSessionId.value === id) {
    selectedSessionId.value = ''
  }
  refreshState()
}

const deleteSnippet = (id: string) => {
  if (!window.confirm('删除这个命令片段？')) return
  mobileStore.deleteSnippet(id)
  refreshState()
}

const deleteGroup = (id: string) => {
  if (!window.confirm('删除这个会话分组？分组下的会话会保留并改为未分组。')) return
  mobileStore.deleteSessionGroup(id)
  selectedGroupId.value = 'all'
  refreshState()
}

const deleteKey = (id: string) => {
  if (!window.confirm('删除这个 SSH 密钥？关联会话会清除密钥引用。')) return
  mobileStore.deleteKey(id)
  refreshState()
}

const parseTags = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

const readSelectedFile = async (event: Event): Promise<string> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return ''
  try {
    return await file.text()
  } finally {
    input.value = ''
  }
}

const selectedFileName = (event: Event): string => {
  const file = (event.target as HTMLInputElement).files?.[0]
  return file?.name?.replace(/\.(pem|key|ppk|pub|txt)$/i, '') || ''
}

const detectKeyType = (content: string): MobileSSHKey['type'] => {
  const normalized = content.trim()
  if (/^ssh-ed25519\s/i.test(normalized)) return 'ed25519'
  if (/^ecdsa-sha2-nistp/i.test(normalized)) return 'ecdsa'
  if (/^ssh-rsa\s/i.test(normalized)) return 'rsa'

  if (/ed25519/i.test(content)) return 'ed25519'
  if (/ecdsa|EC PRIVATE KEY/i.test(content)) return 'ecdsa'

  const opensshPayload = decodeOpenSshPrivateKey(content)
  if (opensshPayload.includes('ssh-ed25519')) return 'ed25519'
  if (opensshPayload.includes('ecdsa-sha2-nistp')) return 'ecdsa'

  return 'rsa'
}

const isEncryptedPrivateKey = (content: string): boolean => {
  if (/ENCRYPTED|Proc-Type: 4,ENCRYPTED/i.test(content)) return true

  const opensshPayload = decodeOpenSshPrivateKey(content)
  if (!opensshPayload.startsWith('openssh-key-v1')) return false

  const cipherName = readOpenSshString(opensshPayload, 'openssh-key-v1'.length + 1)
  return Boolean(cipherName && cipherName !== 'none')
}

const decodeOpenSshPrivateKey = (content: string): string => {
  const match = content.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/i)
  if (!match) return ''

  try {
    return atob(match[1].replace(/\s+/g, ''))
  } catch {
    return ''
  }
}

const readOpenSshString = (payload: string, offset: number): string => {
  if (offset + 4 > payload.length) return ''
  const length =
    (payload.charCodeAt(offset) << 24) |
    (payload.charCodeAt(offset + 1) << 16) |
    (payload.charCodeAt(offset + 2) << 8) |
    payload.charCodeAt(offset + 3)
  const start = offset + 4
  const end = start + length
  return length >= 0 && end <= payload.length ? payload.slice(start, end) : ''
}

const formatDateInput = (value?: Date): string => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const parseDateInput = (value: string): Date => new Date(`${value}T00:00:00.000`)

const formatDisplayDate = (value?: Date): string => {
  const formatted = formatDateInput(value)
  return formatted
}

const sessionManagementText = (session: SessionConfig): string => {
  const parts = [session.provider, session.region].filter(Boolean)
  const expiry = formatDisplayDate(session.expiryDate)
  if (expiry) {
    parts.push(`到期 ${expiry}`)
  }
  return parts.join(' · ')
}

const sessionBillingText = (session: SessionConfig): string => {
  const parts: string[] = []
  if (session.billingCycle) {
    parts.push(billingCycleLabels[session.billingCycle])
  }
  if (session.billingAmount !== undefined) {
    parts.push(`${session.billingAmount}${session.billingCurrency || ''}`)
  }
  return parts.join(' · ')
}

const createFingerprint = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const bytes = new Uint8Array(digest)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return `SHA256:${btoa(binary).replace(/=+$/, '')}`
}
</script>
