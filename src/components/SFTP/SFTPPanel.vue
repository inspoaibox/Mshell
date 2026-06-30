<template>
  <div class="sftp-panel">
    <!-- 双面板布局 -->
    <div class="dual-panel">
      <!-- 左侧：本地文件浏览器 -->
      <div class="file-browser local-browser">
        <div class="browser-header">
          <div class="header-title">
            <h3>本地文件</h3>
            <el-tooltip content="Ctrl+点击 多选单个，Shift+点击 范围选择" placement="top">
              <el-icon class="help-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </div>

          <!-- 盘符选择 -->
          <div class="drive-selector">
            <el-select
              v-model="currentDrive"
              @change="changeDrive"
              size="small"
              style="width: 100%"
            >
              <el-option
                v-for="drive in availableDrives"
                :key="drive"
                :label="drive"
                :value="drive"
              />
            </el-select>
          </div>

          <!-- 路径输入 -->
          <div class="path-input">
            <el-input
              v-model="localPathInput"
              size="small"
              placeholder="输入路径按回车跳转"
              @keyup.enter="navigateToLocalPathInput"
            >
              <template #prefix>
                <el-icon><FolderOpened /></el-icon>
              </template>
            </el-input>
          </div>

          <!-- 工具栏 -->
          <div class="toolbar">
            <el-button :icon="Back" size="small" @click="goBackLocal" :disabled="!canGoBackLocal">
              返回
            </el-button>
            <el-button :icon="FolderAdd" size="small" @click="createLocalFolder"> 新建 </el-button>
            <el-button :icon="Refresh" size="small" @click="refreshLocalDirectory">
              刷新
            </el-button>
          </div>
        </div>

        <div class="file-list" v-loading="loadingLocal">
          <VirtualTable
            :data="visibleLocalFiles"
            :columns="localFileColumns"
            :row-height="40"
            :buffer="10"
            selectable
            selected-key="path"
            resizable
            storage-key="sftp-local-files"
            @row-click="handleLocalClick"
            @row-dblclick="handleLocalDoubleClick"
            @row-contextmenu="handleLocalContextMenu"
            @selection-change="handleLocalSelectionChange"
          >
            <template #name="{ row }">
              <div class="file-name-cell">
                <el-icon :size="18" class="file-icon">
                  <Folder v-if="row.type === 'directory'" />
                  <Document v-else />
                </el-icon>
                <span>{{ row.name }}</span>
              </div>
            </template>
            <template #size="{ row }">
              {{ formatSize({ size: row.size }) }}
            </template>
            <template #modifyTime="{ row }">
              {{ formatTime({ modifyTime: row.modifyTime }) }}
            </template>
            <template #empty>
              <div class="directory-empty">
                <el-icon :size="40"><FolderOpened /></el-icon>
                <p>当前目录为空</p>
              </div>
            </template>
          </VirtualTable>
        </div>
      </div>

      <!-- 中间：传输按钮 -->
      <div class="transfer-controls">
        <el-tooltip content="上传选中文件到远程" placement="left">
          <button
            class="transfer-btn upload-btn"
            @click="uploadSelected"
            :disabled="selectedLocalFiles.length === 0 || !currentSession"
          >
            <el-icon><Top /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip content="下载选中文件到本地" placement="right">
          <button
            class="transfer-btn download-btn"
            @click="downloadSelected"
            :disabled="selectedRemoteFiles.length === 0 || !currentSession"
          >
            <el-icon><Bottom /></el-icon>
          </button>
        </el-tooltip>
      </div>

      <!-- 右侧：远程文件浏览器 -->
      <div class="file-browser remote-browser">
        <div class="browser-header">
          <div class="header-title">
            <h3>远程文件</h3>
            <el-tooltip content="Ctrl+点击 多选单个，Shift+点击 范围选择" placement="top">
              <el-icon class="help-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </div>

          <!-- 会话选择 -->
          <div v-if="!currentSession" class="session-selector">
            <div style="display: flex; gap: 8px; align-items: center">
              <el-select
                v-model="selectedSessionId"
                placeholder="选择会话连接"
                @change="connectToSession"
                filterable
                size="small"
                style="flex: 1"
              >
                <el-option
                  v-for="session in sessions"
                  :key="session.id"
                  :label="session.name"
                  :value="session.id"
                >
                  <div class="session-option">
                    <span>{{ session.name }}</span>
                    <span class="session-host">{{ session.username }}@{{ session.host }}</span>
                  </div>
                </el-option>
              </el-select>
              <el-tooltip content="刷新会话列表" placement="top">
                <el-button :icon="Refresh" size="small" @click="loadSessions" />
              </el-tooltip>
            </div>
          </div>

          <!-- 已连接状态 -->
          <div v-else class="connected-session">
            <div class="session-info">
              <el-icon class="connected-icon"><Connection /></el-icon>
              <span>{{ currentSession.name }}</span>
            </div>
            <el-button size="small" @click="disconnectSession">断开</el-button>
          </div>

          <!-- 路径输入 -->
          <div v-if="currentSession" class="path-input">
            <el-input
              v-model="remotePathInput"
              size="small"
              placeholder="输入路径按回车跳转"
              @keyup.enter="navigateToRemotePathInput"
            >
              <template #prefix>
                <el-icon><FolderOpened /></el-icon>
              </template>
            </el-input>
          </div>

          <!-- 工具栏 -->
          <div v-if="currentSession" class="toolbar">
            <el-button :icon="Back" size="small" @click="goBackRemote" :disabled="!canGoBackRemote">
              返回
            </el-button>
            <el-dropdown @command="handleCreateCommand" trigger="click">
              <el-button :icon="FolderAdd" size="small">
                新建<el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="folder">
                    <el-icon><FolderAdd /></el-icon>
                    新建文件夹
                  </el-dropdown-item>
                  <el-dropdown-item command="file">
                    <el-icon><Document /></el-icon>
                    新建文件
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button :icon="Refresh" size="small" @click="refreshRemoteDirectory">
              刷新
            </el-button>
          </div>
        </div>

        <div class="file-list" v-loading="loadingRemote">
          <div v-if="!currentSession" class="empty-state">
            <el-icon :size="64"><FolderOpened /></el-icon>
            <p>请选择会话连接到远程服务器</p>
          </div>

          <FileDropZone v-else :disabled="!currentSession" @upload="handleFilesDrop">
            <div v-if="remoteDirectoryError" class="empty-state error-state">
              <el-icon :size="48"><FolderOpened /></el-icon>
              <p>{{ remoteDirectoryError }}</p>
              <el-button size="small" type="primary" @click="loadRemoteDirectory()">重试</el-button>
            </div>
            <VirtualTable
              v-else
              :data="visibleRemoteFiles"
              :columns="remoteFileColumns"
              :row-height="40"
              :buffer="10"
              selectable
              selected-key="path"
              resizable
              storage-key="sftp-remote-files"
              @row-click="handleRemoteClick"
              @row-dblclick="handleRemoteDoubleClick"
              @row-contextmenu="handleRemoteContextMenu"
              @selection-change="handleRemoteSelectionChange"
            >
              <template #name="{ row }">
                <div class="file-name-cell">
                  <el-icon :size="18" class="file-icon">
                    <Folder v-if="row.type === 'directory'" />
                    <Document v-else-if="row.type === 'file'" />
                    <Link v-else />
                  </el-icon>
                  <span>{{ row.name }}</span>
                </div>
              </template>
              <template #size="{ row }">
                {{ formatSize({ size: row.size }) }}
              </template>
              <template #modifyTime="{ row }">
                {{ formatTime({ modifyTime: row.modifyTime }) }}
              </template>
              <template #permissions="{ row }">
                <span class="permissions">{{ formatPermissions(row.permissions) }}</span>
              </template>
              <template #empty>
                <div class="directory-empty">
                  <el-icon :size="40"><FolderOpened /></el-icon>
                  <p>远程目录为空</p>
                </div>
              </template>
            </VirtualTable>
          </FileDropZone>
        </div>
      </div>
    </div>

    <!-- 传输队列入口 -->
    <div class="transfer-queue-entry">
      <el-tooltip :content="queueEntryTooltip" placement="left">
        <el-button
          class="queue-entry-button"
          :type="queueAttentionCount > 0 ? 'primary' : 'default'"
          :icon="Upload"
          @click="showTransferQueueDialog = true"
        >
          <span>传输队列</span>
          <span v-if="queueAttentionCount > 0" class="queue-entry-badge">
            {{ queueAttentionCount }}
          </span>
        </el-button>
      </el-tooltip>
    </div>

    <el-dialog
      v-model="showTransferQueueDialog"
      title="传输队列"
      width="min(960px, 92vw)"
      class="transfer-queue-dialog"
    >
      <div class="transfer-queue">
      <div class="queue-header">
        <el-tabs v-model="activeQueueTab" class="queue-tabs">
          <el-tab-pane label="当前传输" name="current">
            <template #label>
              <span>当前传输 ({{ activeTransfers }}/{{ transfers.length }})</span>
            </template>
          </el-tab-pane>
          <el-tab-pane label="未完成传输" name="incomplete">
            <template #label>
              <span>未完成传输 ({{ incompleteTransfers.length }})</span>
            </template>
          </el-tab-pane>
          <el-tab-pane label="传输历史" name="history">
            <template #label>
              <span>传输历史 ({{ transferHistory.length }})</span>
            </template>
          </el-tab-pane>
        </el-tabs>
        <div class="queue-actions">
          <el-button
            v-if="activeQueueTab === 'current'"
            text
            size="small"
            @click="pauseAllTransfers"
            >全部暂停</el-button
          >
          <el-button v-if="activeQueueTab === 'current'" text size="small" @click="clearCompleted"
            >清除已完成</el-button
          >
          <el-button v-if="activeQueueTab === 'current'" text size="small" @click="clearAll"
            >清空队列</el-button
          >
          <el-button
            v-if="activeQueueTab === 'incomplete'"
            text
            size="small"
            @click="loadIncompleteTransfers"
            >刷新</el-button
          >
          <el-button
            v-if="activeQueueTab === 'incomplete'"
            text
            size="small"
            @click="cleanupCompletedRecords"
            >清理已完成</el-button
          >
          <el-button v-if="activeQueueTab === 'history'" text size="small" @click="clearHistory"
            >清空历史</el-button
          >
          <el-button v-if="activeQueueTab === 'history'" text size="small" @click="exportHistory"
            >导出历史</el-button
          >
        </div>
      </div>

      <!-- 当前传输列表 -->
      <div v-show="activeQueueTab === 'current'" class="queue-list">
        <div v-for="transfer in transfers" :key="transfer.id" class="transfer-item">
          <div class="transfer-info">
            <el-icon>
              <Upload v-if="transfer.type === 'upload'" />
              <Download v-else />
            </el-icon>
            <div class="transfer-details">
              <div class="transfer-name">{{ transfer.name }}</div>
              <div class="transfer-path">
                <span class="path-label"
                  >{{ transfer.type === 'upload' ? '上传至' : '下载至' }}:</span
                >
                <span class="path-value">{{ transfer.targetPath }}</span>
              </div>
            </div>
            <div class="transfer-status">
              <span :class="['status-text', transfer.status]">{{
                getTransferStatusText(transfer)
              }}</span>
              <span v-if="transfer.status === 'active'" class="transfer-speed">{{
                formatSpeed(transfer.speed)
              }}</span>
            </div>
            <div class="transfer-actions">
              <el-tooltip content="提高优先级" placement="top">
                <el-button
                  v-if="transfer.status === 'pending' || transfer.status === 'active'"
                  text
                  size="small"
                  @click="increasePriority(transfer.id)"
                  :icon="Top"
                  :disabled="(transfer.priority || 3) >= 5"
                />
              </el-tooltip>
              <el-tooltip content="降低优先级" placement="top">
                <el-button
                  v-if="transfer.status === 'pending' || transfer.status === 'active'"
                  text
                  size="small"
                  @click="decreasePriority(transfer.id)"
                  :icon="Bottom"
                  :disabled="(transfer.priority || 3) <= 1"
                />
              </el-tooltip>
              <el-button
                v-if="transfer.status === 'active'"
                text
                size="small"
                @click="pauseTransfer(transfer.id)"
                :icon="VideoPause"
              >
                暂停
              </el-button>
              <el-button
                v-if="transfer.status === 'paused'"
                text
                size="small"
                type="primary"
                @click="resumeTransfer(transfer.id)"
                :icon="VideoPlay"
              >
                继续
              </el-button>
              <el-button
                v-if="transfer.status === 'failed'"
                text
                size="small"
                type="warning"
                @click="retryTransfer(transfer.id)"
                :icon="Refresh"
              >
                重试
              </el-button>
              <el-button
                text
                size="small"
                type="danger"
                @click="cancelTransfer(transfer.id)"
                :icon="Close"
              >
                取消
              </el-button>
            </div>
          </div>
          <el-progress
            :percentage="transfer.progress"
            :format="formatProgressText"
            :precision="2"
            :status="
              transfer.status === 'failed'
                ? 'exception'
                : transfer.status === 'completed'
                  ? 'success'
                  : transfer.status === 'paused'
                    ? 'warning'
                    : undefined
            "
          />
          <div v-if="transfer.status === 'active'" class="transfer-progress-meta">
            <span>{{ formatTransferAmount(transfer) }}</span>
            <span v-if="transfer.eta > 0">剩余 {{ formatEta(transfer.eta) }}</span>
          </div>
        </div>
      </div>

      <!-- 未完成传输列表 -->
      <div v-show="activeQueueTab === 'incomplete'" class="queue-list">
        <div v-if="incompleteTransfers.length === 0" class="empty-state">
          <el-icon :size="48"><CircleCheck /></el-icon>
          <p>没有未完成的传输</p>
        </div>
        <div
          v-for="record in incompleteTransfers"
          :key="getTransferRecordId(record)"
          class="transfer-item incomplete-item"
        >
          <div class="transfer-info">
            <el-icon>
              <Upload v-if="record.type === 'upload'" />
              <Download v-else />
            </el-icon>
            <div class="transfer-details">
              <div class="transfer-name">{{ getFileName(record.remotePath) }}</div>
              <div class="transfer-path">
                <span class="path-label">本地:</span>
                <span class="path-value">{{ record.localPath }}</span>
              </div>
              <div class="transfer-path">
                <span class="path-label">远程:</span>
                <span class="path-value">{{ record.remotePath }}</span>
              </div>
              <div class="transfer-meta">
                <span
                  >已传输: {{ formatSize({ size: record.transferred }) }} /
                  {{ formatSize({ size: record.totalSize }) }}</span
                >
                <span>进度: {{ ((record.transferred / record.totalSize) * 100).toFixed(1) }}%</span>
                <span>时间: {{ formatTime({ modifyTime: getTransferRecordTime(record) }) }}</span>
              </div>
            </div>
            <div class="transfer-actions">
              <el-button
                text
                size="small"
                type="primary"
                @click="resumeIncompleteTransfer(record)"
                :icon="VideoPlay"
              >
                恢复传输
              </el-button>
              <el-button
                text
                size="small"
                type="danger"
                @click="deleteTransferRecord(getTransferRecordId(record))"
                :icon="Delete"
              >
                删除记录
              </el-button>
            </div>
          </div>
          <el-progress
            :percentage="
              normalizeProgressPercentage(
                calculateProgressPercentage(record.transferred, record.totalSize)
              )
            "
            :format="formatProgressText"
            :precision="2"
            status="warning"
          />
        </div>
      </div>

      <!-- 传输历史列表 -->
      <div v-show="activeQueueTab === 'history'" class="queue-list">
        <div v-if="transferHistory.length === 0" class="empty-state">
          <el-icon :size="48"><Clock /></el-icon>
          <p>暂无传输历史</p>
        </div>
        <div v-for="item in transferHistory" :key="item.id" class="transfer-item history-item">
          <div class="transfer-info">
            <el-icon>
              <Upload v-if="item.type === 'upload'" />
              <Download v-else />
            </el-icon>
            <div class="transfer-details">
              <div class="transfer-name">{{ item.name }}</div>
              <div class="transfer-path">
                <span class="path-label">本地:</span>
                <span class="path-value">{{ item.localPath }}</span>
              </div>
              <div class="transfer-path">
                <span class="path-label">远程:</span>
                <span class="path-value">{{ item.remotePath }}</span>
              </div>
              <div class="transfer-meta">
                <span>大小: {{ formatSize({ size: item.size }) }}</span>
                <span>耗时: {{ formatDuration(item.duration) }}</span>
                <span>时间: {{ formatHistoryTime(item.endTime) }}</span>
              </div>
              <div v-if="item.error" class="transfer-error">
                <span class="error-label">错误:</span>
                <span class="error-message">{{ item.error }}</span>
              </div>
            </div>
            <div class="transfer-status">
              <el-tag
                :type="
                  item.status === 'completed'
                    ? 'success'
                    : item.status === 'failed'
                      ? 'danger'
                      : 'info'
                "
                size="small"
              >
                {{
                  item.status === 'completed'
                    ? '已完成'
                    : item.status === 'failed'
                      ? '失败'
                      : '已取消'
                }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
      </div>
    </el-dialog>

    <!-- 新建远程文件夹对话框 -->
    <el-dialog v-model="showCreateRemoteFolderDialog" title="新建远程文件夹" width="400px">
      <el-input
        v-model="newRemoteFolderName"
        placeholder="输入文件夹名称"
        @keyup.enter="createRemoteFolder"
      />
      <template #footer>
        <el-button @click="showCreateRemoteFolderDialog = false">取消</el-button>
        <el-button type="primary" @click="createRemoteFolder">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新建远程文件对话框 -->
    <el-dialog v-model="showCreateRemoteFileDialog" title="新建远程文件" width="400px">
      <el-input
        v-model="newRemoteFileName"
        placeholder="输入文件名称"
        @keyup.enter="createRemoteFile"
      />
      <template #footer>
        <el-button @click="showCreateRemoteFileDialog = false">取消</el-button>
        <el-button type="primary" @click="createRemoteFile">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重命名对话框 -->
    <el-dialog v-model="showRenameDialog" title="重命名" width="400px">
      <el-input v-model="renameValue" placeholder="输入新名称" @keyup.enter="confirmRename" />
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动文件对话框 -->
    <el-dialog v-model="showMoveDialog" title="移动文件/文件夹" width="500px">
      <div style="margin-bottom: 12px"><strong>源文件：</strong> {{ movingFile?.name }}</div>
      <el-input v-model="moveTargetPath" placeholder="输入目标路径" />
      <template #footer>
        <el-button @click="showMoveDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmMove">移动</el-button>
      </template>
    </el-dialog>

    <!-- 复制文件对话框 -->
    <el-dialog v-model="showCopyDialog" title="复制文件/文件夹" width="500px">
      <div style="margin-bottom: 12px"><strong>源文件：</strong> {{ copyingFile?.name }}</div>
      <el-input v-model="copyTargetPath" placeholder="输入目标路径" />
      <template #footer>
        <el-button @click="showCopyDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmCopy">复制</el-button>
      </template>
    </el-dialog>

    <!-- 权限编辑对话框 -->
    <el-dialog v-model="showPermissionsDialog" title="修改权限" width="450px">
      <div style="margin-bottom: 16px"><strong>文件：</strong> {{ editingPermissions?.name }}</div>

      <div class="permissions-editor">
        <!-- 所有者权限 -->
        <div class="permission-group">
          <h4>所有者 (Owner)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.ownerRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.ownerWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.ownerExecute">执行 (x)</el-checkbox>
          </div>
        </div>

        <!-- 组权限 -->
        <div class="permission-group">
          <h4>组 (Group)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.groupRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.groupWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.groupExecute">执行 (x)</el-checkbox>
          </div>
        </div>

        <!-- 其他用户权限 -->
        <div class="permission-group">
          <h4>其他 (Others)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.otherRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.otherWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.otherExecute">执行 (x)</el-checkbox>
          </div>
        </div>

        <!-- 八进制表示 -->
        <div class="permission-octal">
          <strong>八进制表示：</strong>
          <span class="octal-value">{{ computedOctalPermission }}</span>
        </div>
      </div>

      <template #footer>
        <el-button @click="showPermissionsDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPermissions">确定</el-button>
      </template>
    </el-dialog>

    <!-- 文件预览对话框 -->
    <FilePreview
      v-model="showPreview"
      :file="previewFile"
      :connection-id="currentSession?.id || ''"
      @download="handlePreviewDownload"
    />

    <el-dialog
      :model-value="Boolean(transferConflictDialog)"
      :title="transferConflictDialog?.direction === 'upload' ? '上传冲突' : '下载冲突'"
      width="460px"
      @close="handleTransferConflictClosed"
    >
      <div v-if="transferConflictDialog" class="transfer-conflict">
        <p class="conflict-title">
          目标位置已存在同名{{ formatConflictTargetType(transferConflictDialog.targetType) }}
          "{{ transferConflictDialog.fileName }}"
        </p>
        <div class="conflict-details">
          <div>
            <span>源文件</span>
            <strong>{{ formatSize({ size: transferConflictDialog.sourceSize }) }}</strong>
          </div>
          <div>
            <span>目标文件</span>
            <strong>
              {{
                transferConflictDialog.targetSize !== undefined
                  ? formatSize({ size: transferConflictDialog.targetSize })
                  : '未知大小'
              }}
            </strong>
          </div>
          <div>
            <span>目标路径</span>
            <strong>{{ transferConflictDialog.targetPath }}</strong>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="resolveTransferConflictAction('skip')">跳过</el-button>
        <el-button @click="resolveTransferConflictAction('rename')">重命名</el-button>
        <el-button
          v-if="transferConflictDialog?.canResume"
          type="warning"
          @click="resolveTransferConflictAction('resume')"
        >
          续传
        </el-button>
        <el-button
          v-if="transferConflictDialog?.canOverwrite"
          type="primary"
          @click="resolveTransferConflictAction('overwrite')"
        >
          覆盖
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import {
  createSSHConnectOptions,
  runWithHostKeyConfirmation
} from '@/utils/ssh-host-key-confirm'
import {
  Connection,
  FolderOpened,
  Back,
  FolderAdd,
  Upload,
  Download,
  Refresh,
  Folder,
  Document,
  Link,
  ArrowDown,
  VideoPause,
  VideoPlay,
  Close,
  Delete,
  CircleCheck,
  Top,
  Bottom,
  Clock,
  QuestionFilled
} from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'
import FilePreview from './FilePreview.vue'
import FileDropZone from './FileDropZone.vue'
import VirtualTable from '../Common/VirtualTable.vue'
import type { Column } from '../Common/virtual-table.types'
import { useLocale } from '@/composables/useLocale'
import { formatSftpOperationError } from '@/utils/sftp-errors'

// 国际化和格式化
const { formatBytes: formatBytesLocale, formatDateTime } = useLocale()

interface FileInfo {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifyTime: Date
  permissions?: number
}

interface Transfer {
  id: string
  name: string
  type: 'upload' | 'download'
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: number
  speed: number
  eta: number
  transferred: number
  total: number
  lastProgressAt: number
  stalled: boolean
  targetPath: string
  localPath?: string
  remotePath?: string
  priority?: number // 优先级：1-5，数字越大优先级越高
  startTime?: Date
  endTime?: Date
  error?: string
}

interface TransferRecord {
  id: string
  taskId?: string
  type: 'upload' | 'download'
  localPath: string
  remotePath: string
  totalSize: number
  transferred: number
  status: string
  createdAt?: string
  updatedAt?: string
  lastModified?: string
  connectionId?: string
}

interface TransferHistoryItem {
  id: string
  name: string
  type: 'upload' | 'download'
  status: 'completed' | 'failed' | 'cancelled'
  size: number
  startTime: Date
  endTime: Date
  duration: number // 毫秒
  localPath: string
  remotePath: string
  error?: string
}

interface TransferBatchResult {
  success: string[]
  failed: Array<{ path: string; error: string }>
  paused: string[]
}

interface TransferBatchItem {
  path: string
  transferId: string
}

type TransferConflictAction = 'overwrite' | 'skip' | 'rename' | 'resume'
type TransferConflictTargetType = 'file' | 'directory' | 'queued'

interface TransferConflictContext {
  direction: 'upload' | 'download'
  fileName: string
  sourcePath: string
  targetPath: string
  sourceSize: number
  targetSize?: number
  targetType: TransferConflictTargetType
  canOverwrite: boolean
  canResume: boolean
  existingNames: string[]
  caseSensitive: boolean
}

interface TransferConflictChoice {
  action: TransferConflictAction
  fileName?: string
}

interface UploadTransferPlan {
  name: string
  localPath: string
  remotePath: string
  taskId: string
  total: number
  resumeFromExisting?: boolean
}

interface DownloadTransferPlan {
  name: string
  remotePath: string
  localPath: string
  taskId: string
  total: number
  resumeFromExisting?: boolean
}

const sessions = ref<SessionConfig[]>([])
const selectedSessionId = ref('')
const currentSession = ref<SessionConfig | null>(null)
const sftpSettings = ref({
  defaultLocalPath: '',
  confirmBeforeDelete: true,
  showHiddenFiles: false
})

// SFTP 事件监听器清理函数
const sftpListenerCleanups: Array<() => void> = []

onUnmounted(() => {
  sftpListenerCleanups.forEach((cleanup) => {
    try {
      cleanup()
    } catch (e) {
      /* ignore */
    }
  })
  sftpListenerCleanups.length = 0
})

// 本地文件列定义
const localFileColumns: Column[] = [
  { key: 'name', label: '名称', minWidth: '200px', sortable: true, slot: 'name' },
  { key: 'size', label: '大小', width: '100px', sortable: true, slot: 'size' },
  { key: 'modifyTime', label: '修改时间', width: '150px', sortable: true, slot: 'modifyTime' }
]

// 远程文件列定义
const remoteFileColumns: Column[] = [
  { key: 'name', label: '名称', minWidth: '200px', sortable: true, slot: 'name' },
  { key: 'size', label: '大小', width: '100px', sortable: true, slot: 'size' },
  { key: 'modifyTime', label: '修改时间', width: '150px', sortable: true, slot: 'modifyTime' },
  { key: 'permissions', label: '权限', width: '90px', slot: 'permissions' }
]

// 本地文件
const localPath = ref('')
const localPathInput = ref('')
const currentDrive = ref('C:')
const availableDrives = ref<string[]>(['C:', 'D:', 'E:', 'F:', 'G:'])
const localFiles = ref<FileInfo[]>([])
const selectedLocalFiles = ref<FileInfo[]>([])
const loadingLocal = ref(false)

// 远程文件
const remotePath = ref('/')
const remotePathInput = ref('')
const remoteFiles = ref<FileInfo[]>([])
const selectedRemoteFiles = ref<FileInfo[]>([])
const loadingRemote = ref(false)
const remoteDirectoryError = ref('')

// 传输
const transfers = ref<Transfer[]>([])
const incompleteTransfers = ref<TransferRecord[]>([])
const transferHistory = ref<TransferHistoryItem[]>([])
const activeQueueTab = ref<'current' | 'incomplete' | 'history'>('current')
const transferConflictDialog = ref<TransferConflictContext | null>(null)
let transferConflictResolver: ((choice: TransferConflictChoice) => void) | null = null

const normalizeTransferBatchResult = (
  result?: Partial<TransferBatchResult>
): TransferBatchResult => ({
  success: result?.success || [],
  failed: result?.failed || [],
  paused: result?.paused || []
})

const resetTransferRuntimeState = (transfer: Transfer) => {
  transfer.speed = 0
  transfer.eta = 0
  transfer.stalled = false
}

const markTransferCompleted = (transfer: Transfer) => {
  if (transfer.status === 'completed' || transfer.status === 'cancelled') return

  transfer.status = 'completed'
  transfer.progress = 100
  transfer.transferred = transfer.total || transfer.transferred
  resetTransferRuntimeState(transfer)
  transfer.endTime = new Date()
  addToHistory(transfer)
}

const markTransferFailed = (transfer: Transfer, error?: string) => {
  if (transfer.status === 'failed' || transfer.status === 'cancelled') return

  transfer.status = 'failed'
  transfer.error = error
  resetTransferRuntimeState(transfer)
  transfer.endTime = new Date()
  addToHistory(transfer)
}

const markTransferPaused = (transfer: Transfer) => {
  if (transfer.status === 'completed' || transfer.status === 'failed' || transfer.status === 'cancelled') {
    return
  }

  transfer.status = 'paused'
  resetTransferRuntimeState(transfer)
}

const findTransferFromBatchPath = (path: string, items: TransferBatchItem[]) => {
  const item = items.find((entry) => entry.path === path)
  if (!item) return undefined
  return transfers.value.find((transfer) => transfer.id === item.transferId)
}

const markTransfersFailedByIds = (transferIds: string[], error?: string) => {
  transferIds.forEach((id) => {
    const transfer = transfers.value.find((item) => item.id === id)
    if (!transfer || transfer.status === 'paused' || transfer.status === 'completed') return
    markTransferFailed(transfer, error)
  })
}

const applyTransferBatchResults = (
  result: Partial<TransferBatchResult> | undefined,
  items: TransferBatchItem[],
  actionLabel: '上传' | '下载'
) => {
  const batchResult = normalizeTransferBatchResult(result)

  batchResult.success.forEach((path) => {
    const transfer = findTransferFromBatchPath(path, items)
    if (transfer && transfer.status !== 'paused') {
      markTransferCompleted(transfer)
    }
  })

  batchResult.failed.forEach((failure) => {
    const transfer = findTransferFromBatchPath(failure.path, items)
    if (transfer) {
      markTransferFailed(transfer, failure.error)
    }
  })

  batchResult.paused.forEach((path) => {
    const transfer = findTransferFromBatchPath(path, items)
    if (transfer) {
      markTransferPaused(transfer)
    }
  })

  if (batchResult.success.length > 0) {
    ElMessage.success(`成功${actionLabel} ${batchResult.success.length} 个文件`)
  }
  if (batchResult.paused.length > 0) {
    ElMessage.info(`已暂停 ${batchResult.paused.length} 个传输`)
  }
  if (batchResult.failed.length > 0) {
    ElMessage.error(`${batchResult.failed.length} 个文件${actionLabel}失败`)
  }
}

// 对话框
const showCreateRemoteFolderDialog = ref(false)
const showCreateRemoteFileDialog = ref(false)
const showRenameDialog = ref(false)
const showPreview = ref(false)
const showTransferQueueDialog = ref(false)
const newRemoteFolderName = ref('')
const newRemoteFileName = ref('')
const renameValue = ref('')
const renamingFile = ref<{ file: FileInfo; isRemote: boolean } | null>(null)
const previewFile = ref<FileInfo | null>(null)

// 移动文件相关
const showMoveDialog = ref(false)
const movingFile = ref<FileInfo | null>(null)
const moveTargetPath = ref('')

// 复制文件相关
const showCopyDialog = ref(false)
const copyingFile = ref<FileInfo | null>(null)
const copyTargetPath = ref('')

// 权限编辑相关
const showPermissionsDialog = ref(false)
const editingPermissions = ref<FileInfo | null>(null)
const permissionBits = ref({
  ownerRead: false,
  ownerWrite: false,
  ownerExecute: false,
  groupRead: false,
  groupWrite: false,
  groupExecute: false,
  otherRead: false,
  otherWrite: false,
  otherExecute: false
})

const canGoBackLocal = computed(() => {
  if (!localPath.value) return false
  const isRoot = localPath.value.match(/^[A-Z]:\\?$/i) || localPath.value === '/'
  return !isRoot
})

const canGoBackRemote = computed(() => {
  return remotePath.value !== '/'
})

const activeTransfers = computed(() => {
  return transfers.value.filter((t) => t.status === 'active' || t.status === 'pending').length
})

const queueAttentionCount = computed(() => activeTransfers.value + incompleteTransfers.value.length)

const queueEntryTooltip = computed(() => {
  if (queueAttentionCount.value === 0) {
    return '查看传输队列和历史记录'
  }

  const parts = []
  if (activeTransfers.value > 0) {
    parts.push(`${activeTransfers.value} 个进行中`)
  }
  if (incompleteTransfers.value.length > 0) {
    parts.push(`${incompleteTransfers.value.length} 个未完成`)
  }
  return parts.join('，')
})

const isHiddenFile = (file: FileInfo) => file.name.startsWith('.') || Boolean((file as any).hidden)

const visibleLocalFiles = computed(() =>
  sftpSettings.value.showHiddenFiles
    ? localFiles.value
    : localFiles.value.filter((file) => !isHiddenFile(file))
)

const visibleRemoteFiles = computed(() =>
  sftpSettings.value.showHiddenFiles
    ? remoteFiles.value
    : remoteFiles.value.filter((file) => !isHiddenFile(file))
)

const confirmDeleteIfNeeded = async (message: string, title = '确认删除') => {
  if (!sftpSettings.value.confirmBeforeDelete) return
  await ElMessageBox.confirm(message, title, { type: 'warning' })
}

const splitFileName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return { base: fileName, extension: '' }
  }
  return {
    base: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex)
  }
}

const hasNameConflict = (name: string, existingNames: string[], caseSensitive: boolean) => {
  if (caseSensitive) {
    return existingNames.includes(name)
  }
  const normalized = name.toLocaleLowerCase()
  return existingNames.some((existingName) => existingName.toLocaleLowerCase() === normalized)
}

const generateConflictRename = (
  fileName: string,
  existingNames: string[],
  caseSensitive: boolean
) => {
  const { base, extension } = splitFileName(fileName)
  let index = 1
  let nextName = `${base} (${index})${extension}`

  while (hasNameConflict(nextName, existingNames, caseSensitive)) {
    index += 1
    nextName = `${base} (${index})${extension}`
  }

  return nextName
}

const replacePathFileName = (path: string, fileName: string) => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (index < 0) return fileName
  return `${path.slice(0, index + 1)}${fileName}`
}

const formatConflictTargetType = (type: TransferConflictTargetType) => {
  if (type === 'directory') return '目录'
  if (type === 'queued') return '待传输文件'
  return '文件'
}

const showTransferConflictDialog = async (
  context: TransferConflictContext
): Promise<TransferConflictChoice> => {
  transferConflictDialog.value = context

  const choice = await new Promise<TransferConflictChoice>((resolve) => {
    transferConflictResolver = resolve
  })

  if (choice.action === 'rename' && !choice.fileName) {
    const generatedName = generateConflictRename(
      context.fileName,
      context.existingNames,
      context.caseSensitive
    )

    while (true) {
      const { value } = await ElMessageBox.prompt('请输入新的文件名', '重命名传输', {
        inputValue: generatedName,
        inputPattern: /^(?!\s*$)[^/\\]+$/,
        inputErrorMessage: '文件名不能为空，且不能包含 / 或 \\',
        closeOnClickModal: false,
        closeOnPressEscape: false
      }).catch(() => ({ value: '' }))

      if (!value) {
        return { action: 'skip' }
      }

      if (!hasNameConflict(value, context.existingNames, context.caseSensitive)) {
        return { action: 'rename', fileName: value }
      }

      ElMessage.warning('该名称仍然冲突，请重新输入')
    }
  }

  return choice
}

const resolveTransferConflictAction = (action: TransferConflictAction) => {
  const resolver = transferConflictResolver
  transferConflictResolver = null
  transferConflictDialog.value = null
  resolver?.({ action })
}

const handleTransferConflictClosed = () => {
  if (!transferConflictResolver) return
  resolveTransferConflictAction('skip')
}

const loadSftpSettings = async () => {
  try {
    const saved = await window.electronAPI.settings.get()
    applySftpSettings(saved)
  } catch (error) {
    console.error('[SFTPPanel] Failed to load SFTP settings:', error)
  }
}

const applySftpSettings = (settings: any) => {
  const sftp = settings?.sftp || {}
  sftpSettings.value = {
    defaultLocalPath: sftp.defaultLocalPath || '',
    confirmBeforeDelete: sftp.confirmBeforeDelete !== false,
    showHiddenFiles: sftp.showHiddenFiles === true
  }
}

const isExistingDirectory = async (path: string) => {
  if (!path) return false

  try {
    const result = await window.electronAPI.fs.stat(path)
    return result.success && Boolean(result.stats?.isDirectory)
  } catch {
    return false
  }
}

const getSystemDownloadsPath = async () => {
  try {
    const downloadsPath = await window.electronAPI.app.getDownloadsPath()
    if (downloadsPath) {
      return downloadsPath
    }
  } catch (error) {
    console.warn('[SFTPPanel] Failed to get system downloads path:', error)
  }

  return ''
}

const resolveInitialLocalPath = async () => {
  const configuredPath = sftpSettings.value.defaultLocalPath

  if (await isExistingDirectory(configuredPath)) {
    return configuredPath
  }

  if (configuredPath) {
    console.warn('[SFTPPanel] Ignoring unavailable default local path:', configuredPath)
  }

  const downloadsPath = await getSystemDownloadsPath()
  if (await isExistingDirectory(downloadsPath)) {
    return downloadsPath
  }

  return 'C:\\'
}

const normalizeRemotePath = (path: string) => {
  const trimmed = path.trim()
  if (!trimmed) return '/'
  return trimmed.startsWith('/') ? trimmed.replace(/\/+/g, '/') : `/${trimmed}`.replace(/\/+/g, '/')
}

const getRemoteHomePath = async (session: SessionConfig) => {
  try {
    const result = await window.electronAPI.ssh.executeCommand(
      session.id,
      'printf %s "$HOME"',
      3000
    )
    if (result.success && result.data?.trim()) {
      return normalizeRemotePath(result.data.trim())
    }
  } catch (error) {
    console.warn('[SFTPPanel] Failed to detect remote home path:', error)
  }

  return session.username === 'root' ? '/root' : `/home/${session.username}`
}

const getTransferRecordId = (record: TransferRecord) => record.id || record.taskId || ''

const getTransferRecordTime = (record: TransferRecord) =>
  new Date(record.updatedAt || record.lastModified || record.createdAt || Date.now())

// 计算八进制权限值
const computedOctalPermission = computed(() => {
  const owner =
    (permissionBits.value.ownerRead ? 4 : 0) +
    (permissionBits.value.ownerWrite ? 2 : 0) +
    (permissionBits.value.ownerExecute ? 1 : 0)
  const group =
    (permissionBits.value.groupRead ? 4 : 0) +
    (permissionBits.value.groupWrite ? 2 : 0) +
    (permissionBits.value.groupExecute ? 1 : 0)
  const other =
    (permissionBits.value.otherRead ? 4 : 0) +
    (permissionBits.value.otherWrite ? 2 : 0) +
    (permissionBits.value.otherExecute ? 1 : 0)
  return `${owner}${group}${other}`
})

onMounted(async () => {
  try {
    await loadSftpSettings()
    const initialLocalPath = await resolveInitialLocalPath()
    localPath.value = initialLocalPath
    localPathInput.value = initialLocalPath

    // 检测当前盘符
    if (initialLocalPath.match(/^[A-Z]:/i)) {
      currentDrive.value = initialLocalPath.substring(0, 2).toUpperCase()
    }

    await loadSessions()
    await loadLocalDirectory()
    await loadIncompleteTransfers()
    loadTransferHistory()
  } catch (error) {
    console.error('[SFTPPanel] Initialization error:', error)
    ElMessage.error('文件传输面板初始化失败')
  }

  // 监听传输进度事件（保存取消函数以便清理）
  const unsubProgress = window.electronAPI.sftp.onProgress((taskId: string, progress: any) => {
    const transfer = transfers.value.find((t) => t.id === taskId)
    if (transfer && transfer.status === 'active') {
      transfer.transferred = normalizeByteCount(progress.transferred, transfer.transferred)
      transfer.total = normalizeByteCount(progress.total, transfer.total)
      transfer.progress = normalizeProgressPercentage(
        progress.percentage ?? calculateProgressPercentage(transfer.transferred, transfer.total)
      )
      transfer.speed = normalizeByteCount(progress.speed)
      transfer.eta = normalizeDurationSeconds(progress.eta)
      transfer.lastProgressAt = Date.now()
      transfer.stalled = false
    }
  })

  const unsubComplete = window.electronAPI.sftp.onComplete((taskId: string) => {
    const transfer = transfers.value.find((t) => t.id === taskId)
    if (transfer && transfer.status !== 'cancelled') {
      markTransferCompleted(transfer)
    }
  })

  const unsubError = window.electronAPI.sftp.onError((taskId: string, error: string) => {
    const transfer = transfers.value.find((t) => t.id === taskId)
    if (transfer && transfer.status !== 'cancelled') {
      markTransferFailed(transfer, error)
    }
  })

  // 保存清理函数
  sftpListenerCleanups.push(unsubProgress, unsubComplete, unsubError)

  const transferWatchdog = window.setInterval(() => {
    const now = Date.now()
    transfers.value.forEach((transfer) => {
      if (transfer.status !== 'active') return
      if (now - transfer.lastProgressAt <= 3000) return

      transfer.speed = 0
      transfer.eta = 0
      transfer.stalled = true
    })
  }, 1000)
  sftpListenerCleanups.push(() => window.clearInterval(transferWatchdog))

  const unsubSettings = window.electronAPI.settings.onChange((settings: any) => {
    applySftpSettings(settings)
  })
  if (unsubSettings) {
    sftpListenerCleanups.push(unsubSettings)
  }
})

const loadSessions = async () => {
  try {
    console.log('Loading sessions for SFTP...')
    sessions.value = await window.electronAPI.session.getAll()
    console.log('Loaded sessions:', sessions.value.length, sessions.value)
    ElMessage.success(`已加载 ${sessions.value.length} 个会话`)
  } catch (error) {
    console.error('Failed to load sessions:', error)
    ElMessage.error('加载会话列表失败')
  }
}

const connectToSession = async () => {
  const session = sessions.value.find((s) => s.id === selectedSessionId.value)
  if (!session) return

  await connectSession(session)
}

const connectSession = async (session: SessionConfig) => {
  loadingRemote.value = true
  const loadingMsg = ElMessage({
    message: `正在连接到 ${session.name}...`,
    type: 'info',
    duration: 0
  })

  try {
    // 获取 SSH 设置
    const settings = await window.electronAPI.settings.get()
    const sshSettings = settings?.ssh || {}

    // 建立独立 SFTP 连接。它不依赖终端窗口，但和终端共用同一套 SSH 参数处理逻辑。
    // 主机指纹需要确认时，确认后自动保存新指纹并重试 SFTP 连接。
    const sftpConnectResult = await runWithHostKeyConfirmation(
      (trustedHostKey) =>
        window.electronAPI.sftp.connect(
          session.id,
          createSSHConnectOptions(session, sshSettings, trustedHostKey)
        ),
      session.name
    )

    if (!sftpConnectResult.success) {
      loadingMsg.close()
      ElMessage.error(`SFTP 连接失败: ${sftpConnectResult.error}`)
      return
    }

    currentSession.value = session

    remotePath.value = await getRemoteHomePath(session)

    remotePathInput.value = remotePath.value
    await loadFirstAccessibleRemoteDirectory([remotePath.value, '/', '/tmp'])

    // 加载未完成的传输
    await loadIncompleteTransfers()

    // 如果有未完成的传输，提示用户
    if (incompleteTransfers.value.length > 0) {
      ElNotification({
        title: '发现未完成的传输',
        message: `有 ${incompleteTransfers.value.length} 个未完成的传输，可以在传输队列中恢复`,
        type: 'info',
        duration: 5000
      })
    }

    loadingMsg.close()
    ElMessage.success(`已连接到 ${session.name}`)
  } catch (error: any) {
    loadingMsg.close()
    ElMessage.error(`连接失败: ${error.message}`)
  } finally {
    loadingRemote.value = false
  }
}

const disconnectSession = async () => {
  if (!currentSession.value) return

  try {
    await window.electronAPI.ssh.disconnect(currentSession.value.id)
    currentSession.value = null
    selectedSessionId.value = ''
    remoteFiles.value = []
    ElMessage.success('已断开连接')
  } catch (error: any) {
    ElMessage.error(`断开连接失败: ${error.message}`)
  }
}

// 本地文件操作
const loadLocalDirectory = async (silent = false) => {
  if (!silent) {
    loadingLocal.value = true
  }
  try {
    const result = await window.electronAPI.fs.readDirectory(localPath.value)
    if (result.success && result.files) {
      localFiles.value = result.files.map((file: any) => ({
        name: file.name,
        path:
          localPath.value +
          (localPath.value.endsWith('\\') || localPath.value.endsWith('/') ? '' : '\\') +
          file.name,
        type: file.isDirectory ? 'directory' : 'file',
        size: file.size || 0,
        modifyTime: new Date(file.mtime)
      }))
    }
  } catch (error: any) {
    ElMessage.error(`加载本地目录失败: ${error.message}`)
  } finally {
    loadingLocal.value = false
  }
}

const goBackLocal = () => {
  const parts = localPath.value.split('\\').filter((p) => p)
  if (parts.length > 1) {
    parts.pop()
    localPath.value = parts.join('\\')
  } else if (parts.length === 1) {
    localPath.value = parts[0] + '\\'
  }
  localPathInput.value = localPath.value
  loadLocalDirectory()
}

const changeDrive = () => {
  localPath.value = currentDrive.value + '\\'
  localPathInput.value = localPath.value
  loadLocalDirectory()
}

const navigateToLocalPathInput = async () => {
  const inputPath = localPathInput.value.trim()
  if (!inputPath) return

  try {
    // 检查路径是否存在
    const result = await window.electronAPI.fs.stat(inputPath)
    if (result.success && result.stats.isDirectory) {
      localPath.value = inputPath
      await loadLocalDirectory()
    } else {
      ElMessage.error('路径不存在或不是目录')
      localPathInput.value = localPath.value
    }
  } catch (error: any) {
    ElMessage.error(`无效路径: ${error.message}`)
    localPathInput.value = localPath.value
  }
}

const refreshLocalDirectory = async () => {
  console.log('[SFTP] Refreshing local directory:', localPath.value)
  await loadLocalDirectory()
  console.log('[SFTP] Local directory refreshed, files:', localFiles.value.length)
}

const createLocalFolder = async () => {
  try {
    const { value: folderName } = await ElMessageBox.prompt('输入文件夹名称', '新建本地文件夹', {
      inputPattern: /.+/,
      inputErrorMessage: '请输入文件夹名称'
    })

    if (folderName) {
      const newPath = localPath.value + (localPath.value.endsWith('\\') ? '' : '\\') + folderName
      const result = await window.electronAPI.fs.createDirectory(newPath)
      if (result.success) {
        ElMessage.success('文件夹创建成功')
        await loadLocalDirectory()
      } else {
        ElMessage.error(`创建失败: ${result.error}`)
      }
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`创建失败: ${error.message}`)
    }
  }
}

const handleLocalSelectionChange = (selection: FileInfo[]) => {
  selectedLocalFiles.value = selection
}

// 本地文件单击 - 仅选择
const handleLocalClick = (_row: FileInfo) => {
  // 单击只是选择，不做任何操作
  // 选择逻辑由 VirtualTable 的 selectable 属性处理
}

// 本地文件双击 - 打开文件夹
const handleLocalDoubleClick = (row: FileInfo) => {
  if (row.type === 'directory') {
    localPath.value = row.path
    loadLocalDirectory(true)
  }
}

const handleLocalContextMenu = async (row: FileInfo, _column: any, event: MouseEvent) => {
  event.preventDefault()

  const menuItems = []

  // 检查是否有多选
  const hasMultipleSelection = selectedLocalFiles.value.length > 1

  if (hasMultipleSelection) {
    // 多选菜单
    menuItems.push(
      { label: `上传 ${selectedLocalFiles.value.length} 个文件`, action: 'upload-multiple' },
      { label: `压缩 ${selectedLocalFiles.value.length} 个项目`, action: 'compress-multiple' },
      { label: `删除 ${selectedLocalFiles.value.length} 个项目`, action: 'delete-multiple' }
    )
  } else {
    // 单选菜单
    if (row.type === 'directory') {
      menuItems.push({ label: '打开', action: 'open' })
    }

    menuItems.push({ label: '上传到远程', action: 'upload' })

    // 压缩/解压选项
    const ext = row.name.toLowerCase()
    if (
      ext.endsWith('.zip') ||
      ext.endsWith('.tar') ||
      ext.endsWith('.tar.gz') ||
      ext.endsWith('.tgz') ||
      ext.endsWith('.7z')
    ) {
      menuItems.push({ label: '解压到当前目录', action: 'extract' })
      menuItems.push({ label: '解压到...', action: 'extract-to' })
    } else {
      menuItems.push({ label: '压缩', action: 'compress' })
    }

    menuItems.push({ label: '重命名', action: 'rename' }, { label: '删除', action: 'delete' })
  }

  try {
    const result = await window.electronAPI.dialog.showContextMenu(menuItems)

    if (result === 'open' && row.type === 'directory') {
      localPath.value = row.path
      await loadLocalDirectory()
    } else if (result === 'upload' || result === 'upload-multiple') {
      if (!currentSession.value) {
        ElMessage.warning('请先连接到远程服务器')
        return
      }
      if (result === 'upload') {
        selectedLocalFiles.value = [row]
      }
      await uploadSelected()
    } else if (result === 'rename') {
      renamingFile.value = { file: row, isRemote: false }
      renameValue.value = row.name
      showRenameDialog.value = true
    } else if (result === 'delete') {
      await deleteLocalFile(row)
    } else if (result === 'delete-multiple') {
      await deleteLocalFilesMultiple()
    } else if (result === 'compress') {
      await compressLocalFile(row)
    } else if (result === 'compress-multiple') {
      await compressLocalFilesMultiple()
    } else if (result === 'extract') {
      await extractLocalFile(row, localPath.value)
    } else if (result === 'extract-to') {
      await extractLocalFileTo(row)
    }
  } catch (error) {
    // 用户取消
  }
}

const deleteLocalFile = async (file: FileInfo) => {
  try {
    await confirmDeleteIfNeeded(`确定要删除 "${file.name}" 吗？`)

    const result = await window.electronAPI.fs.deleteFile(file.path)
    if (result.success) {
      ElMessage.success('删除成功')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`删除失败: ${result.error}`)
    }
  } catch (error) {
    // 用户取消
  }
}

const deleteLocalFilesMultiple = async () => {
  if (selectedLocalFiles.value.length === 0) return

  try {
    await confirmDeleteIfNeeded(
      `确定要删除选中的 ${selectedLocalFiles.value.length} 个项目吗？`,
      '批量删除'
    )

    let successCount = 0
    let failCount = 0

    for (const file of selectedLocalFiles.value) {
      try {
        const result = await window.electronAPI.fs.deleteFile(file.path)
        if (result.success) {
          successCount++
        } else {
          failCount++
        }
      } catch (error) {
        failCount++
      }
    }

    if (successCount > 0) {
      ElMessage.success(`成功删除 ${successCount} 个项目`)
    }
    if (failCount > 0) {
      ElMessage.error(`${failCount} 个项目删除失败`)
    }

    await loadLocalDirectory()
  } catch (error) {
    // 用户取消
  }
}

// 远程文件操作
const loadRemoteDirectory = async (silent = false): Promise<boolean> => {
  if (!currentSession.value) return false

  if (!silent) {
    loadingRemote.value = true
  }
  remoteDirectoryError.value = ''
  try {
    const targetPath = normalizeRemotePath(remotePath.value)
    const result = await window.electronAPI.sftp.listDirectory(currentSession.value.id, targetPath)

    if (result.success && result.files) {
      remotePath.value = targetPath
      remotePathInput.value = targetPath
      remoteFiles.value = result.files.map((file: any) => ({
        name: file.name,
        path: `${targetPath}/${file.name}`.replace(/\/+/g, '/'),
        type: file.type,
        size: file.size,
        modifyTime: new Date(file.modifyTime),
        permissions: file.permissions
      }))
      return true
    } else {
      const message = formatSftpOperationError('加载远程目录', result.error, targetPath)
      remoteFiles.value = []
      selectedRemoteFiles.value = []
      remoteDirectoryError.value = message
      if (!silent) ElMessage.error(message)
      return false
    }
  } catch (error: any) {
    const message = formatSftpOperationError('加载远程目录', error.message, remotePath.value)
    remoteFiles.value = []
    selectedRemoteFiles.value = []
    remoteDirectoryError.value = message
    if (!silent) ElMessage.error(message)
    return false
  } finally {
    loadingRemote.value = false
  }
}

const loadFirstAccessibleRemoteDirectory = async (paths: string[]) => {
  const normalizedPaths = Array.from(new Set(paths.map(normalizeRemotePath)))
  let lastError = ''

  for (const path of normalizedPaths) {
    remotePath.value = path
    remotePathInput.value = path
    const loaded = await loadRemoteDirectory(true)
    if (loaded) {
      if (path !== normalizedPaths[0]) {
        ElMessage.warning(`默认目录不可访问，已切换到 ${path}`)
      }
      return
    }
    lastError = remoteDirectoryError.value
  }

  if (lastError) {
    remoteDirectoryError.value = lastError
    ElMessage.error(lastError)
  }
}

const getRemoteDirectoryFiles = async (targetPath: string): Promise<FileInfo[]> => {
  if (!currentSession.value) return []

  const normalizedPath = normalizeRemotePath(targetPath)
  if (normalizedPath === remotePath.value && remoteFiles.value.length > 0) {
    return remoteFiles.value
  }

  const result = await window.electronAPI.sftp.listDirectory(currentSession.value.id, normalizedPath)
  if (!result.success || !result.files) {
    throw new Error(result.error || '无法读取远程目录')
  }

  return result.files.map((file: any) => ({
    name: file.name,
    path: `${normalizedPath}/${file.name}`.replace(/\/+/g, '/'),
    type: file.type,
    size: file.size,
    modifyTime: new Date(file.modifyTime),
    permissions: file.permissions
  }))
}

const resolveUploadConflict = async (
  fileName: string,
  sourcePath: string,
  sourceSize: number,
  remoteFilePath: string,
  existingFiles: FileInfo[],
  plannedRemoteNames: string[]
) => {
  const existingFile = existingFiles.find((file) => file.name === fileName)
  const queuedConflict = plannedRemoteNames.includes(fileName)
  if (!existingFile && !queuedConflict) {
    return {
      action: 'overwrite' as TransferConflictAction,
      remotePath: remoteFilePath,
      resumeFromExisting: false
    }
  }

  const targetType = queuedConflict
    ? 'queued'
    : existingFile?.type === 'directory'
      ? 'directory'
      : 'file'
  const targetSize = existingFile?.type === 'file' ? existingFile.size : undefined
  const canOverwrite = targetType === 'file'
  const canResume = canOverwrite && targetSize !== undefined && targetSize > 0 && targetSize < sourceSize

  const choice = await showTransferConflictDialog({
    direction: 'upload',
    fileName,
    sourcePath,
    targetPath: remoteFilePath,
    sourceSize,
    targetSize,
    targetType,
    canOverwrite,
    canResume,
    existingNames: [...existingFiles.map((file) => file.name), ...plannedRemoteNames],
    caseSensitive: true
  })

  if (choice.action === 'skip') {
    return { action: choice.action, remotePath: remoteFilePath, resumeFromExisting: false }
  }

  if (choice.action === 'rename' && choice.fileName) {
    return {
      action: choice.action,
      remotePath: replacePathFileName(remoteFilePath, choice.fileName).replace(/\/+/g, '/'),
      resumeFromExisting: false
    }
  }

  return {
    action: choice.action,
    remotePath: remoteFilePath,
    resumeFromExisting: choice.action === 'resume'
  }
}

const resolveDownloadConflict = async (
  file: FileInfo,
  localFilePath: string,
  existingLocalNames: string[],
  plannedLocalNames: string[]
) => {
  const existingFile = localFiles.value.find(
    (item) => item.name.toLocaleLowerCase() === file.name.toLocaleLowerCase()
  )
  const queuedConflict = plannedLocalNames.some(
    (name) => name.toLocaleLowerCase() === file.name.toLocaleLowerCase()
  )
  if (!existingFile && !queuedConflict) {
    return {
      action: 'overwrite' as TransferConflictAction,
      localPath: localFilePath,
      resumeFromExisting: false
    }
  }

  const targetType = queuedConflict
    ? 'queued'
    : existingFile?.type === 'directory'
      ? 'directory'
      : 'file'
  const targetSize = existingFile?.type === 'file' ? existingFile.size : undefined
  const canOverwrite = targetType === 'file'
  const canResume = canOverwrite && targetSize !== undefined && targetSize > 0 && targetSize < file.size

  const choice = await showTransferConflictDialog({
    direction: 'download',
    fileName: file.name,
    sourcePath: file.path,
    targetPath: localFilePath,
    sourceSize: file.size,
    targetSize,
    targetType,
    canOverwrite,
    canResume,
    existingNames: [...existingLocalNames, ...plannedLocalNames],
    caseSensitive: false
  })

  if (choice.action === 'skip') {
    return { action: choice.action, localPath: localFilePath, resumeFromExisting: false }
  }

  if (choice.action === 'rename' && choice.fileName) {
    return {
      action: choice.action,
      localPath: replacePathFileName(localFilePath, choice.fileName),
      resumeFromExisting: false
    }
  }

  return {
    action: choice.action,
    localPath: localFilePath,
    resumeFromExisting: choice.action === 'resume'
  }
}

const goBackRemote = () => {
  const parts = remotePath.value.split('/').filter((p) => p)
  parts.pop()
  remotePath.value = '/' + parts.join('/')
  remotePathInput.value = remotePath.value
  loadRemoteDirectory()
}

const navigateToRemotePathInput = async () => {
  const inputPath = remotePathInput.value.trim()
  if (!inputPath) return

  remotePath.value = normalizeRemotePath(inputPath)
  await loadRemoteDirectory()
}

const refreshRemoteDirectory = async () => {
  console.log('[SFTP] Refreshing remote directory:', remotePath.value)
  await loadRemoteDirectory()
  console.log('[SFTP] Remote directory refreshed, files:', remoteFiles.value.length)
}

const createRemoteFolder = async () => {
  if (!newRemoteFolderName.value.trim() || !currentSession.value) return

  try {
    const newPath = `${remotePath.value}/${newRemoteFolderName.value}`.replace(/\/+/g, '/')
    const result = await window.electronAPI.sftp.createDirectory(currentSession.value.id, newPath)

    if (result.success) {
      ElMessage.success('文件夹创建成功')
      showCreateRemoteFolderDialog.value = false
      newRemoteFolderName.value = ''
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`创建失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`创建失败: ${error.message}`)
  }
}

// 处理新建命令
const handleCreateCommand = (command: string) => {
  if (command === 'folder') {
    showCreateRemoteFolderDialog.value = true
  } else if (command === 'file') {
    showCreateRemoteFileDialog.value = true
  }
}

// 新建远程文件
const createRemoteFile = async () => {
  if (!newRemoteFileName.value.trim() || !currentSession.value) return

  try {
    const newPath = `${remotePath.value}/${newRemoteFileName.value}`.replace(/\/+/g, '/')
    const result = await window.electronAPI.sftp.createFile(currentSession.value.id, newPath)

    if (result.success) {
      ElMessage.success('文件创建成功')
      showCreateRemoteFileDialog.value = false
      newRemoteFileName.value = ''
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`创建失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`创建失败: ${error.message}`)
  }
}

const handleRemoteSelectionChange = (selection: FileInfo[]) => {
  selectedRemoteFiles.value = selection
}

// 远程文件单击 - 仅选择
const handleRemoteClick = (_row: FileInfo) => {
  // 单击只是选择，不做任何操作
  // 选择逻辑由 VirtualTable 的 selectable 属性处理
}

// 远程文件双击 - 打开文件夹
const handleRemoteDoubleClick = (row: FileInfo) => {
  if (row.type === 'directory') {
    remotePath.value = row.path
    loadRemoteDirectory(true)
  }
}

const handleRemoteContextMenu = async (row: FileInfo, _column: any, event: MouseEvent) => {
  event.preventDefault()

  if (!currentSession.value) return

  // 检查是否有多选
  const hasMultipleSelection = selectedRemoteFiles.value.length > 1

  let menuItems: any[] = []

  if (hasMultipleSelection) {
    // 多选菜单
    menuItems = [
      { label: `下载 ${selectedRemoteFiles.value.length} 个文件`, action: 'download-multiple' },
      { label: `压缩 ${selectedRemoteFiles.value.length} 个项目`, action: 'compress-multiple' },
      { label: `删除 ${selectedRemoteFiles.value.length} 个项目`, action: 'delete-multiple' }
    ]
  } else {
    // 单选菜单 - 检查是否是压缩文件
    const ext = row.name.toLowerCase()
    const isArchive =
      ext.endsWith('.zip') ||
      ext.endsWith('.tar') ||
      ext.endsWith('.tar.gz') ||
      ext.endsWith('.tgz') ||
      ext.endsWith('.gz')

    menuItems =
      row.type === 'directory'
        ? [
            { label: '打开', action: 'open' },
            { label: '压缩', action: 'compress' },
            { label: '重命名', action: 'rename' },
            { label: '移动', action: 'move' },
            { label: '复制', action: 'copy' },
            { label: '权限', action: 'permissions' },
            { label: '删除', action: 'delete' }
          ]
        : isArchive
          ? [
              { label: '预览', action: 'preview' },
              { label: '下载', action: 'download' },
              { label: '解压到当前目录', action: 'extract' },
              { label: '解压到...', action: 'extract-to' },
              { label: '重命名', action: 'rename' },
              { label: '移动', action: 'move' },
              { label: '复制', action: 'copy' },
              { label: '权限', action: 'permissions' },
              { label: '删除', action: 'delete' }
            ]
          : [
              { label: '预览', action: 'preview' },
              { label: '下载', action: 'download' },
              { label: '编辑', action: 'edit' },
              { label: '压缩', action: 'compress' },
              { label: '重命名', action: 'rename' },
              { label: '移动', action: 'move' },
              { label: '复制', action: 'copy' },
              { label: '权限', action: 'permissions' },
              { label: '删除', action: 'delete' }
            ]
  }

  try {
    const result = await window.electronAPI.dialog.showContextMenu(menuItems)

    if (result === 'open' && row.type === 'directory') {
      remotePath.value = row.path
      await loadRemoteDirectory()
    } else if (result === 'preview') {
      previewFile.value = row
      showPreview.value = true
    } else if (result === 'edit') {
      previewFile.value = row
      showPreview.value = true
      // 预览组件会自动切换到编辑模式
    } else if (result === 'download' || result === 'download-multiple') {
      if (result === 'download') {
        selectedRemoteFiles.value = [row]
      }
      await downloadSelected()
    } else if (result === 'rename') {
      renamingFile.value = { file: row, isRemote: true }
      renameValue.value = row.name
      showRenameDialog.value = true
    } else if (result === 'move') {
      movingFile.value = row
      moveTargetPath.value = remotePath.value
      showMoveDialog.value = true
    } else if (result === 'copy') {
      copyingFile.value = row
      copyTargetPath.value = remotePath.value
      showCopyDialog.value = true
    } else if (result === 'permissions') {
      editingPermissions.value = row
      // 将八进制权限转换为复选框状态
      const perms = row.permissions || 0o644
      permissionBits.value = {
        ownerRead: !!(perms & 0o400),
        ownerWrite: !!(perms & 0o200),
        ownerExecute: !!(perms & 0o100),
        groupRead: !!(perms & 0o040),
        groupWrite: !!(perms & 0o020),
        groupExecute: !!(perms & 0o010),
        otherRead: !!(perms & 0o004),
        otherWrite: !!(perms & 0o002),
        otherExecute: !!(perms & 0o001)
      }
      showPermissionsDialog.value = true
    } else if (result === 'delete') {
      await deleteRemoteFile(row)
    } else if (result === 'delete-multiple') {
      await deleteRemoteFilesMultiple()
    } else if (result === 'compress') {
      await compressRemoteFile(row)
    } else if (result === 'compress-multiple') {
      await compressRemoteFilesMultiple()
    } else if (result === 'extract') {
      await extractRemoteFile(row, remotePath.value)
    } else if (result === 'extract-to') {
      await extractRemoteFileTo(row)
    }
  } catch (error) {
    // 用户取消
  }
}

const deleteRemoteFile = async (file: FileInfo) => {
  if (!currentSession.value) return

  try {
    await confirmDeleteIfNeeded(`确定要删除 "${file.name}" 吗？`)

    const result = await window.electronAPI.sftp.deleteFile(currentSession.value.id, file.path)

    if (result.success) {
      ElMessage.success('删除成功')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`删除失败: ${result.error}`)
    }
  } catch (error) {
    // 用户取消
  }
}

const deleteRemoteFilesMultiple = async () => {
  if (!currentSession.value || selectedRemoteFiles.value.length === 0) return

  try {
    await confirmDeleteIfNeeded(
      `确定要删除选中的 ${selectedRemoteFiles.value.length} 个项目吗？`,
      '批量删除'
    )

    // 分离文件和目录
    const files = selectedRemoteFiles.value.filter((f) => f.type !== 'directory')
    const directories = selectedRemoteFiles.value.filter((f) => f.type === 'directory')

    let successCount = 0
    let failCount = 0

    // 批量删除文件
    if (files.length > 0) {
      const filePaths = files.map((f) => f.path)
      const result = await window.electronAPI.sftp.deleteFiles(currentSession.value.id, filePaths)

      if (result.success && result.results) {
        successCount += result.results.success.length
        failCount += result.results.failed.length
      } else {
        failCount += files.length
      }
    }

    // 批量删除目录
    if (directories.length > 0) {
      const dirPaths = directories.map((d) => d.path)
      const result = await window.electronAPI.sftp.deleteDirectories(
        currentSession.value.id,
        dirPaths
      )

      if (result.success && result.results) {
        successCount += result.results.success.length
        failCount += result.results.failed.length
      } else {
        failCount += directories.length
      }
    }

    // 显示结果
    if (successCount > 0) {
      ElMessage.success(`成功删除 ${successCount} 个项目`)
    }
    if (failCount > 0) {
      ElMessage.error(`${failCount} 个项目删除失败`)
    }

    await loadRemoteDirectory()
  } catch (error) {
    // 用户取消
  }
}

const confirmRename = async () => {
  if (!renameValue.value.trim() || !renamingFile.value) return

  try {
    if (renamingFile.value.isRemote) {
      if (!currentSession.value) return

      const oldPath = renamingFile.value.file.path
      const newPath = oldPath.replace(/[^/]+$/, renameValue.value)

      const result = await window.electronAPI.sftp.renameFile(
        currentSession.value.id,
        oldPath,
        newPath
      )

      if (result.success) {
        ElMessage.success('重命名成功')
        await loadRemoteDirectory()
      } else {
        ElMessage.error(`重命名失败: ${result.error}`)
      }
    } else {
      const oldPath = renamingFile.value.file.path
      const parts = oldPath.split('\\')
      parts[parts.length - 1] = renameValue.value
      const newPath = parts.join('\\')

      const result = await window.electronAPI.fs.rename(oldPath, newPath)

      if (result.success) {
        ElMessage.success('重命名成功')
        await loadLocalDirectory()
      } else {
        ElMessage.error(`重命名失败: ${result.error}`)
      }
    }

    showRenameDialog.value = false
    renamingFile.value = null
    renameValue.value = ''
  } catch (error: any) {
    ElMessage.error(`重命名失败: ${error.message}`)
  }
}

// 移动文件
const confirmMove = async () => {
  if (!moveTargetPath.value.trim() || !movingFile.value || !currentSession.value) return

  try {
    const sourcePath = movingFile.value.path
    const targetPath = moveTargetPath.value.endsWith('/')
      ? moveTargetPath.value + movingFile.value.name
      : moveTargetPath.value + '/' + movingFile.value.name

    const result = await window.electronAPI.sftp.renameFile(
      currentSession.value.id,
      sourcePath,
      targetPath
    )

    if (result.success) {
      ElMessage.success('移动成功')
      await loadRemoteDirectory()
      showMoveDialog.value = false
      movingFile.value = null
    } else {
      ElMessage.error(`移动失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`移动失败: ${error.message}`)
  }
}

// 复制文件
const confirmCopy = async () => {
  if (!copyTargetPath.value.trim() || !copyingFile.value || !currentSession.value) return

  try {
    const sourcePath = copyingFile.value.path
    const targetPath = copyTargetPath.value.endsWith('/')
      ? copyTargetPath.value + copyingFile.value.name
      : copyTargetPath.value + '/' + copyingFile.value.name

    ElMessage.info('正在复制文件...')

    // 使用 SFTP 的复制功能（通过读取和写入实现）
    const result = await window.electronAPI.sftp.copyFile(
      currentSession.value.id,
      sourcePath,
      targetPath
    )

    if (result.success) {
      ElMessage.success('复制成功')
      await loadRemoteDirectory()
      showCopyDialog.value = false
      copyingFile.value = null
    } else {
      ElMessage.error(`复制失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`复制失败: ${error.message}`)
  }
}

// 修改权限
const confirmPermissions = async () => {
  if (!editingPermissions.value || !currentSession.value) return

  try {
    const filePath = editingPermissions.value.path

    // 从复选框计算权限值
    const owner =
      (permissionBits.value.ownerRead ? 4 : 0) +
      (permissionBits.value.ownerWrite ? 2 : 0) +
      (permissionBits.value.ownerExecute ? 1 : 0)
    const group =
      (permissionBits.value.groupRead ? 4 : 0) +
      (permissionBits.value.groupWrite ? 2 : 0) +
      (permissionBits.value.groupExecute ? 1 : 0)
    const other =
      (permissionBits.value.otherRead ? 4 : 0) +
      (permissionBits.value.otherWrite ? 2 : 0) +
      (permissionBits.value.otherExecute ? 1 : 0)

    const mode = parseInt(`${owner}${group}${other}`, 8)

    const result = await window.electronAPI.sftp.chmod(currentSession.value.id, filePath, mode)

    if (result.success) {
      ElMessage.success('权限修改成功')
      await loadRemoteDirectory()
      showPermissionsDialog.value = false
      editingPermissions.value = null
    } else {
      ElMessage.error(formatSftpOperationError('权限修改', result.error, filePath))
    }
  } catch (error: any) {
    const filePath = editingPermissions.value?.path || ''
    ElMessage.error(
      formatSftpOperationError('权限修改', error.message, filePath)
    )
  }
}

// 传输操作
// 处理文件拖拽上传
const handleFilesDrop = async (files: File[], targetPath: string) => {
  if (!currentSession.value) {
    ElMessage.warning('请先连接到远程服务器')
    return
  }

  if (files.length === 0) return

  ElMessage.info(`准备上传 ${files.length} 个文件...`)

  const uploadBasePath = targetPath && targetPath !== '.' ? targetPath : remotePath.value
  const existingFiles = await getRemoteDirectoryFiles(uploadBasePath)
  const plannedRemoteNames: string[] = []
  const uploadPlans: UploadTransferPlan[] = []
  let skippedCount = 0

  for (const file of files) {
    const localFilePath = file.path || file.name
    const initialRemotePath = `${uploadBasePath}/${file.name}`.replace(/\/+/g, '/')
    const conflict = await resolveUploadConflict(
      file.name,
      localFilePath,
      file.size || 0,
      initialRemotePath,
      existingFiles,
      plannedRemoteNames
    )

    if (conflict.action === 'skip') {
      skippedCount += 1
      continue
    }

    const transferId = Date.now().toString() + Math.random()
    const remoteName = conflict.remotePath.split('/').pop() || file.name
    plannedRemoteNames.push(remoteName)

    uploadPlans.push({
      name: remoteName,
      localPath: localFilePath,
      remotePath: conflict.remotePath,
      taskId: transferId,
      total: file.size || 0,
      resumeFromExisting: conflict.resumeFromExisting
    })
  }

  if (uploadPlans.length === 0) {
    if (skippedCount > 0) ElMessage.info(`已跳过 ${skippedCount} 个文件`)
    return
  }

  for (const plan of uploadPlans) {
    transfers.value.push({
      id: plan.taskId,
      name: plan.name,
      type: 'upload',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      transferred: 0,
      total: plan.total,
      lastProgressAt: Date.now(),
      stalled: false,
      targetPath: plan.remotePath,
      localPath: plan.localPath,
      remotePath: plan.remotePath,
      priority: 3,
      startTime: new Date()
    })
  }

  const transferIds = uploadPlans.map((plan) => plan.taskId)
  const uploadFiles = uploadPlans.map((plan) => ({
    localPath: plan.localPath,
    remotePath: plan.remotePath,
    taskId: plan.taskId,
    resumeFromExisting: plan.resumeFromExisting
  }))

  try {
    const result = await window.electronAPI.sftp.uploadFiles(currentSession.value.id, uploadFiles)

    if (result.success) {
      applyTransferBatchResults(
        result.results,
        uploadFiles.map((file) => ({ path: file.localPath, transferId: file.taskId })),
        '上传'
      )
      if (skippedCount > 0) ElMessage.info(`已跳过 ${skippedCount} 个文件`)
    } else {
      markTransfersFailedByIds(transferIds, result.error)
      ElMessage.error(`上传失败: ${result.error}`)
    }
  } catch (error: any) {
    markTransfersFailedByIds(transferIds, error.message)
    ElMessage.error(`上传失败: ${error.message}`)
  }

  await loadRemoteDirectory()
}

const uploadSelected = async () => {
  if (selectedLocalFiles.value.length === 0 || !currentSession.value) return

  // 过滤掉文件夹
  const filesToUpload = selectedLocalFiles.value.filter((f) => f.type !== 'directory')

  if (filesToUpload.length === 0) {
    ElMessage.warning('请选择文件进行上传（暂不支持文件夹）')
    return
  }

  // 跳过的文件夹
  const skippedFolders = selectedLocalFiles.value.filter((f) => f.type === 'directory')
  if (skippedFolders.length > 0) {
    ElMessage.warning(`已跳过 ${skippedFolders.length} 个文件夹`)
  }

  const existingFiles = await getRemoteDirectoryFiles(remotePath.value)
  const plannedRemoteNames: string[] = []
  const uploadPlans: UploadTransferPlan[] = []
  let skippedCount = skippedFolders.length

  for (const file of filesToUpload) {
    const initialRemotePath = `${remotePath.value}/${file.name}`.replace(/\/+/g, '/')
    const conflict = await resolveUploadConflict(
      file.name,
      file.path,
      file.size || 0,
      initialRemotePath,
      existingFiles,
      plannedRemoteNames
    )

    if (conflict.action === 'skip') {
      skippedCount += 1
      continue
    }

    const transferId = Date.now().toString() + Math.random()
    const remoteName = conflict.remotePath.split('/').pop() || file.name
    plannedRemoteNames.push(remoteName)

    uploadPlans.push({
      name: remoteName,
      localPath: file.path,
      remotePath: conflict.remotePath,
      taskId: transferId,
      total: file.size || 0,
      resumeFromExisting: conflict.resumeFromExisting
    })
  }

  if (uploadPlans.length === 0) {
    if (skippedCount > 0) ElMessage.info(`已跳过 ${skippedCount} 个项目`)
    return
  }

  for (const plan of uploadPlans) {
    transfers.value.push({
      id: plan.taskId,
      name: plan.name,
      type: 'upload',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      transferred: 0,
      total: plan.total,
      lastProgressAt: Date.now(),
      stalled: false,
      targetPath: plan.remotePath,
      localPath: plan.localPath,
      remotePath: plan.remotePath,
      priority: 3,
      startTime: new Date()
    })
  }

  // 准备批量上传的文件列表（携带前端生成的 taskId）
  const transferIds = uploadPlans.map((plan) => plan.taskId)
  const files = uploadPlans.map((plan) => ({
    localPath: plan.localPath,
    remotePath: plan.remotePath,
    taskId: plan.taskId,
    resumeFromExisting: plan.resumeFromExisting
  }))

  try {
    // 使用批量上传 API
    const result = await window.electronAPI.sftp.uploadFiles(currentSession.value.id, files)

    if (result.success) {
      applyTransferBatchResults(
        result.results,
        files.map((file) => ({ path: file.localPath, transferId: file.taskId })),
        '上传'
      )
      if (skippedCount > skippedFolders.length) {
        ElMessage.info(`已跳过 ${skippedCount - skippedFolders.length} 个同名文件`)
      }
    } else {
      // 全部失败
      markTransfersFailedByIds(transferIds, result.error)
      ElMessage.error(`批量上传失败: ${result.error}`)
    }
  } catch (error: any) {
    // 异常情况
    markTransfersFailedByIds(transferIds, error.message)
    ElMessage.error(`上传失败: ${error.message || '未知错误'}`)
  }

  await loadRemoteDirectory()
}

const downloadSelected = async () => {
  if (selectedRemoteFiles.value.length === 0 || !currentSession.value) return

  // 过滤掉文件夹
  const filesToDownload = selectedRemoteFiles.value.filter((f) => f.type !== 'directory')

  if (filesToDownload.length === 0) {
    ElMessage.warning('请选择文件进行下载（暂不支持文件夹）')
    return
  }

  // 跳过的文件夹
  const skippedFolders = selectedRemoteFiles.value.filter((f) => f.type === 'directory')
  if (skippedFolders.length > 0) {
    ElMessage.warning(`已跳过 ${skippedFolders.length} 个文件夹`)
  }

  const separator = localPath.value.endsWith('\\') ? '' : '\\'

  const existingLocalNames = localFiles.value.map((file) => file.name)
  const plannedLocalNames: string[] = []
  const downloadPlans: DownloadTransferPlan[] = []
  let skippedCount = skippedFolders.length

  for (const file of filesToDownload) {
    const localFilePath = localPath.value + separator + file.name
    const conflict = await resolveDownloadConflict(
      file,
      localFilePath,
      existingLocalNames,
      plannedLocalNames
    )

    if (conflict.action === 'skip') {
      skippedCount += 1
      continue
    }

    const transferId = Date.now().toString() + Math.random()
    const localName = conflict.localPath.split(/[/\\]/).pop() || file.name
    plannedLocalNames.push(localName)

    downloadPlans.push({
      name: localName,
      remotePath: file.path,
      localPath: conflict.localPath,
      taskId: transferId,
      total: file.size || 0,
      resumeFromExisting: conflict.resumeFromExisting
    })
  }

  if (downloadPlans.length === 0) {
    if (skippedCount > 0) ElMessage.info(`已跳过 ${skippedCount} 个项目`)
    return
  }

  // 为每个文件创建传输记录
  for (const plan of downloadPlans) {
    transfers.value.push({
      id: plan.taskId,
      name: plan.name,
      type: 'download',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      transferred: 0,
      total: plan.total,
      lastProgressAt: Date.now(),
      stalled: false,
      targetPath: plan.localPath,
      localPath: plan.localPath,
      remotePath: plan.remotePath,
      priority: 3,
      startTime: new Date()
    })
  }

  // 准备批量下载的文件列表（携带前端生成的 taskId）
  const transferIds = downloadPlans.map((plan) => plan.taskId)
  const files = downloadPlans.map((plan) => ({
    remotePath: plan.remotePath,
    localPath: plan.localPath,
    taskId: plan.taskId,
    resumeFromExisting: plan.resumeFromExisting
  }))

  try {
    // 使用批量下载 API
    const result = await window.electronAPI.sftp.downloadFiles(currentSession.value.id, files)

    if (result.success) {
      applyTransferBatchResults(
        result.results,
        files.map((file) => ({ path: file.remotePath, transferId: file.taskId })),
        '下载'
      )
      if (skippedCount > skippedFolders.length) {
        ElMessage.info(`已跳过 ${skippedCount - skippedFolders.length} 个同名文件`)
      }
    } else {
      // 全部失败
      markTransfersFailedByIds(transferIds, result.error)
      ElMessage.error(`批量下载失败: ${result.error}`)
    }
  } catch (error: any) {
    // 异常情况
    markTransfersFailedByIds(transferIds, error.message)
    ElMessage.error(`下载失败: ${error.message || '未知错误'}`)
  }

  await loadLocalDirectory()
}

// 处理预览对话框中的下载
const handlePreviewDownload = async (file: FileInfo) => {
  if (!currentSession.value) return

  selectedRemoteFiles.value = [file]
  await downloadSelected()
}

const clearCompleted = () => {
  // 将已完成的传输添加到历史记录
  const completedTransfers = transfers.value.filter(
    (t) => t.status === 'completed' || t.status === 'failed'
  )
  completedTransfers.forEach((transfer) => {
    addToHistory(transfer)
  })

  // 从当前列表中移除
  transfers.value = transfers.value.filter((t) => t.status !== 'completed' && t.status !== 'failed')
}

const clearAll = () => {
  transfers.value = []
}

// 加载未完成的传输
const loadIncompleteTransfers = async () => {
  try {
    const result = await window.electronAPI.sftp.getIncompleteTransfers(currentSession.value?.id)
    if (result.success && result.data) {
      incompleteTransfers.value = result.data
    }
  } catch (error: any) {
    console.error('Failed to load incomplete transfers:', error)
  }
}

// 暂停传输
const pauseTransfer = async (transferId: string) => {
  try {
    const result = await window.electronAPI.sftp.pauseTransfer(transferId)
    if (result.success) {
      const transfer = transfers.value.find((t) => t.id === transferId)
      if (transfer) {
        markTransferPaused(transfer)
        ElMessage.success('传输已暂停')
      }
    } else {
      ElMessage.error(`暂停失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`暂停失败: ${error.message}`)
  }
}

// 恢复传输
const resumeTransfer = async (transferId: string) => {
  if (!currentSession.value) return
  const transfer = transfers.value.find((t) => t.id === transferId)

  try {
    const result = await window.electronAPI.sftp.resumeTransfer(currentSession.value.id, transferId)
    if (result.success) {
      if (transfer) {
        transfer.status = 'active'
        transfer.lastProgressAt = Date.now()
        transfer.stalled = false
        transfer.speed = 0
        transfer.eta = 0
        ElMessage.success('传输已恢复')
      }
    } else {
      if (transfer) {
        markTransferPaused(transfer)
      }
      ElMessage.error(`恢复失败: ${result.error}`)
    }
  } catch (error: any) {
    if (transfer) {
      markTransferPaused(transfer)
    }
    ElMessage.error(`恢复失败: ${error.message}`)
  }
}

// 取消传输
const cancelTransfer = async (transferId: string) => {
  try {
    const transfer = transfers.value.find((t) => t.id === transferId)

    const result = await window.electronAPI.sftp.cancelTask(transferId)
    if (result.success) {
      if (transfer) {
        transfer.status = 'cancelled'
        transfer.endTime = new Date()
        addToHistory(transfer)
      }
      transfers.value = transfers.value.filter((t) => t.id !== transferId)
      ElMessage.success('传输已取消')
    } else {
      ElMessage.error(`取消失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`取消失败: ${error.message}`)
  }
}

// 重试传输
const retryTransfer = async (transferId: string) => {
  const transfer = transfers.value.find((t) => t.id === transferId)
  if (!transfer || !currentSession.value) return

  transfer.status = 'active'
  transfer.progress = 0
  transfer.transferred = 0
  transfer.speed = 0
  transfer.eta = 0
  transfer.lastProgressAt = Date.now()
  transfer.stalled = false
  transfer.startTime = new Date() // 重新开始计时

  try {
    let result
    if (transfer.type === 'upload' && transfer.localPath) {
      result = await window.electronAPI.sftp.uploadFile(
        currentSession.value.id,
        transfer.localPath,
        transfer.remotePath || transfer.targetPath
      )
    } else if (transfer.type === 'download' && transfer.remotePath) {
      result = await window.electronAPI.sftp.downloadFile(
        currentSession.value.id,
        transfer.remotePath,
        transfer.localPath || transfer.targetPath
      )
    }

    if (result?.success) {
      transfer.status = 'completed'
      transfer.progress = 100
      transfer.transferred = transfer.total || transfer.transferred
      transfer.endTime = new Date()
      addToHistory(transfer)
      ElMessage.success('传输成功')
    } else {
      transfer.status = 'failed'
      transfer.endTime = new Date()
      addToHistory(transfer)
      ElMessage.error(`传输失败: ${result?.error}`)
    }
  } catch (error: any) {
    transfer.status = 'failed'
    transfer.endTime = new Date()
    addToHistory(transfer)
    ElMessage.error(`传输失败: ${error.message}`)
  }
}

// 暂停所有传输
const pauseAllTransfers = async () => {
  const activeTransfersList = transfers.value.filter((t) => t.status === 'active')
  for (const transfer of activeTransfersList) {
    await pauseTransfer(transfer.id)
  }
}

// 恢复未完成的传输
const resumeIncompleteTransfer = async (record: TransferRecord) => {
  if (!currentSession.value) {
    ElMessage.warning('请先连接到服务器')
    return
  }

  const transferId = getTransferRecordId(record)
  if (!transferId) {
    ElMessage.error('传输记录缺少 ID，无法恢复')
    return
  }

  // 添加到当前传输列表
  transfers.value.push({
    id: transferId,
    name: getFileName(record.remotePath),
    type: record.type,
    status: 'active',
    progress: normalizeProgressPercentage(
      calculateProgressPercentage(record.transferred, record.totalSize)
    ),
    speed: 0,
    eta: 0,
    transferred: normalizeByteCount(record.transferred),
    total: normalizeByteCount(record.totalSize),
    lastProgressAt: Date.now(),
    stalled: false,
    targetPath: record.type === 'upload' ? record.remotePath : record.localPath,
    localPath: record.localPath,
    remotePath: record.remotePath
  })

  // 切换到当前传输标签
  activeQueueTab.value = 'current'

  try {
    const result = await window.electronAPI.sftp.resumeTransfer(currentSession.value.id, transferId)

    const transfer = transfers.value.find((t) => t.id === transferId)
    if (transfer) {
      if (result.success) {
        transfer.status = 'active'
        transfer.lastProgressAt = Date.now()
        transfer.stalled = false
        ElMessage.success('传输已恢复')
        await loadIncompleteTransfers()
      } else {
        markTransferFailed(transfer, result.error)
        ElMessage.error(`传输失败: ${result.error}`)
      }
    }
  } catch (error: any) {
    const transfer = transfers.value.find((t) => t.id === transferId)
    if (transfer) {
      markTransferFailed(transfer, error.message)
    }
    ElMessage.error(`传输失败: ${error.message}`)
  }
}

// 删除传输记录
const deleteTransferRecord = async (taskId: string) => {
  try {
    await ElMessageBox.confirm('确定要删除此传输记录吗？', '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.sftp.deleteTransferRecord(taskId)
    if (result.success) {
      ElMessage.success('记录已删除')
      await loadIncompleteTransfers()
    } else {
      ElMessage.error(`删除失败: ${result.error}`)
    }
  } catch (error) {
    // 用户取消
  }
}

// 清理已完成的记录
const cleanupCompletedRecords = async () => {
  try {
    const result = await window.electronAPI.sftp.cleanupCompletedRecords()
    if (result.success) {
      ElMessage.success('已清理完成的记录')
      await loadIncompleteTransfers()
    } else {
      ElMessage.error(`清理失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`清理失败: ${error.message}`)
  }
}

// 获取文件名
const getFileName = (path: string) => {
  return path.split('/').pop() || path
}

// 优先级调整
const increasePriority = (transferId: string) => {
  const transfer = transfers.value.find((t) => t.id === transferId)
  if (transfer) {
    transfer.priority = Math.min((transfer.priority || 3) + 1, 5)
    // 重新排序传输队列
    sortTransfersByPriority()
  }
}

const decreasePriority = (transferId: string) => {
  const transfer = transfers.value.find((t) => t.id === transferId)
  if (transfer) {
    transfer.priority = Math.max((transfer.priority || 3) - 1, 1)
    // 重新排序传输队列
    sortTransfersByPriority()
  }
}

const sortTransfersByPriority = () => {
  transfers.value.sort((a, b) => {
    // 优先级高的排前面
    const priorityA = a.priority || 3
    const priorityB = b.priority || 3
    if (priorityA !== priorityB) {
      return priorityB - priorityA
    }
    // 优先级相同，按创建时间排序
    return (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0)
  })
}

// 传输历史记录
const addToHistory = (transfer: Transfer) => {
  if (
    transfer.status === 'completed' ||
    transfer.status === 'failed' ||
    transfer.status === 'cancelled'
  ) {
    // 尝试获取文件大小
    let fileSize = transfer.total || transfer.transferred || 0
    if (transfer.type === 'upload' && transfer.localPath) {
      // 对于上传，从本地文件获取大小
      const localFile = localFiles.value.find((f) => f.path === transfer.localPath)
      if (localFile) {
        fileSize = localFile.size
      }
    } else if (transfer.type === 'download' && transfer.remotePath) {
      // 对于下载，从远程文件获取大小
      const remoteFile = remoteFiles.value.find((f) => f.path === transfer.remotePath)
      if (remoteFile) {
        fileSize = remoteFile.size
      }
    }

    const historyItem: TransferHistoryItem = {
      id: transfer.id,
      name: transfer.name,
      type: transfer.type,
      status: transfer.status,
      size: fileSize,
      startTime: transfer.startTime || new Date(),
      endTime: transfer.endTime || new Date(),
      duration:
        (transfer.endTime?.getTime() || Date.now()) - (transfer.startTime?.getTime() || Date.now()),
      localPath: transfer.localPath || (transfer.type === 'download' ? transfer.targetPath : ''),
      remotePath: transfer.remotePath || (transfer.type === 'upload' ? transfer.targetPath : ''),
      error:
        transfer.status === 'failed'
          ? '传输失败'
          : transfer.status === 'cancelled'
            ? '已取消'
            : undefined
    }

    transferHistory.value.unshift(historyItem)

    // 只保留最近100条历史记录
    if (transferHistory.value.length > 100) {
      transferHistory.value = transferHistory.value.slice(0, 100)
    }

    // 保存到 localStorage
    saveTransferHistory()
  }
}

const saveTransferHistory = () => {
  try {
    localStorage.setItem('sftp-transfer-history', JSON.stringify(transferHistory.value))
  } catch (error) {
    console.error('Failed to save transfer history:', error)
  }
}

const loadTransferHistory = () => {
  try {
    const saved = localStorage.getItem('sftp-transfer-history')
    if (saved) {
      const parsed = JSON.parse(saved)
      transferHistory.value = parsed.map((item: any) => ({
        ...item,
        startTime: new Date(item.startTime),
        endTime: new Date(item.endTime)
      }))
    }
  } catch (error) {
    console.error('Failed to load transfer history:', error)
  }
}

const clearHistory = async () => {
  try {
    await ElMessageBox.confirm('确定要清空传输历史吗？', '确认清空', {
      type: 'warning'
    })

    transferHistory.value = []
    localStorage.removeItem('sftp-transfer-history')
    ElMessage.success('历史记录已清空')
  } catch (error) {
    // 用户取消
  }
}

const exportHistory = async () => {
  try {
    if (transferHistory.value.length === 0) {
      ElMessage.warning('没有历史记录可导出')
      return
    }

    const result = await window.electronAPI.dialog.saveFile({
      defaultPath: `transfer-history-${Date.now()}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result) {
      const data = JSON.stringify(transferHistory.value, null, 2)

      // 使用 fs API 写入文件
      const writeResult = await window.electronAPI.fs.writeFile(result, data)

      if (writeResult.success) {
        ElMessage.success(`历史记录已导出到: ${result}`)
      } else {
        ElMessage.error(`导出失败: ${writeResult.error}`)
      }
    }
  } catch (error: any) {
    ElMessage.error(`导出失败: ${error.message}`)
  }
}

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  const hours = Math.floor(minutes / 60)
  return `${hours}小时${minutes % 60}分`
}

const formatHistoryTime = (date: Date): string => {
  if (!date) return '-'
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 格式化函数
const formatSize = ({ size }: { size: number }) => {
  return formatBytesLocale(size)
}

const formatTime = ({ modifyTime }: { modifyTime: Date }) => {
  if (!modifyTime) return '-'
  const d = modifyTime instanceof Date ? modifyTime : new Date(modifyTime)
  if (isNaN(d.getTime())) return '-'
  return formatDateTime(d)
}

const formatPermissions = (permissions: number | undefined) => {
  if (permissions === undefined) return '-'
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  const owner = perms[(permissions >> 6) & 7]
  const group = perms[(permissions >> 3) & 7]
  const other = perms[permissions & 7]
  return owner + group + other
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    pending: '等待中',
    active: '传输中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败'
  }
  return map[status] || status
}

const getTransferStatusText = (transfer: Transfer) => {
  if (transfer.status === 'active' && transfer.stalled) {
    return '等待服务器响应'
  }
  return getStatusText(transfer.status)
}

const formatSpeed = (speed: number) => {
  return `${formatSize({ size: normalizeByteCount(speed) })}/s`
}

const normalizeByteCount = (value: unknown, fallback = 0) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return fallback
  return numeric
}

const normalizeDurationSeconds = (value: unknown) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return numeric
}

const calculateProgressPercentage = (transferred: number, total: number) => {
  if (!total) return 0
  return (transferred / total) * 100
}

const normalizeProgressPercentage = (value: unknown) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  const clamped = Math.min(100, Math.max(0, numeric))
  return Number(clamped.toFixed(2))
}

const formatProgressText = (percentage: number) => {
  const normalized = normalizeProgressPercentage(percentage)
  return `${normalized.toFixed(2)}%`
}

const formatTransferAmount = (transfer: Transfer) => {
  const transferred = formatSize({ size: transfer.transferred })
  if (!transfer.total) return transferred
  return `${transferred} / ${formatSize({ size: transfer.total })}`
}

const formatEta = (seconds: number) => {
  const safeSeconds = Math.ceil(normalizeDurationSeconds(seconds))
  if (safeSeconds <= 0) return '-'
  if (safeSeconds < 60) return `${safeSeconds}秒`
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  if (minutes < 60) return `${minutes}分${remainingSeconds ? `${remainingSeconds}秒` : ''}`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}小时${remainingMinutes ? `${remainingMinutes}分` : ''}`
}

// ==================== 压缩/解压功能 ====================

// 本地文件压缩
const compressLocalFile = async (file: FileInfo) => {
  try {
    const { value: archiveName } = await ElMessageBox.prompt('请输入压缩文件名', '压缩文件', {
      inputValue: `${file.name}.zip`,
      inputPattern: /^.+\.(zip|tar|tar\.gz|tgz)$/,
      inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz)'
    })

    if (!archiveName) return

    const archivePath = `${localPath.value}/${archiveName}`.replace(/\\/g, '/')

    ElMessage.info('正在压缩...')

    const result = await window.electronAPI.fs.compress(file.path, archivePath)

    if (result.success) {
      ElMessage.success('压缩完成')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 本地多文件压缩
const compressLocalFilesMultiple = async () => {
  if (selectedLocalFiles.value.length === 0) return

  try {
    const { value: archiveName } = await ElMessageBox.prompt(
      `将压缩 ${selectedLocalFiles.value.length} 个项目`,
      '批量压缩',
      {
        inputValue: 'archive.zip',
        inputPattern: /^.+\.(zip|tar|tar\.gz|tgz)$/,
        inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz)'
      }
    )

    if (!archiveName) return

    const archivePath = `${localPath.value}/${archiveName}`.replace(/\\/g, '/')
    const filePaths = selectedLocalFiles.value.map((f) => f.path)

    ElMessage.info('正在压缩...')

    const result = await window.electronAPI.fs.compressMultiple(filePaths, archivePath)

    if (result.success) {
      ElMessage.success('压缩完成')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 本地文件解压
const extractLocalFile = async (file: FileInfo, targetDir: string) => {
  try {
    ElMessage.info('正在解压...')

    const result = await window.electronAPI.fs.extract(file.path, targetDir)

    if (result.success) {
      ElMessage.success('解压完成')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`解压失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`解压失败: ${error.message || error}`)
  }
}

// 本地文件解压到指定目录
const extractLocalFileTo = async (file: FileInfo) => {
  try {
    const result = await window.electronAPI.dialog.openDirectory({ properties: ['openDirectory'] })
    if (!result) return

    await extractLocalFile(file, result as string)
  } catch (error: any) {
    ElMessage.error(`解压失败: ${error.message || error}`)
  }
}

// 远程文件压缩
const compressRemoteFile = async (file: FileInfo) => {
  if (!currentSession.value) return

  try {
    const { value: archiveName } = await ElMessageBox.prompt('请输入压缩文件名', '压缩文件', {
      inputValue: `${file.name}.tar.gz`,
      inputPattern: /^.+\.(zip|tar|tar\.gz|tgz|gz)$/,
      inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz, .gz)'
    })

    if (!archiveName) return

    const archivePath = `${remotePath.value}/${archiveName}`.replace(/\/+/g, '/')

    ElMessage.info('正在压缩...')

    const result = await window.electronAPI.sftp.compress(
      currentSession.value.id,
      file.path,
      archivePath
    )

    if (result.success) {
      ElMessage.success('压缩完成')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 远程多文件压缩
const compressRemoteFilesMultiple = async () => {
  if (!currentSession.value || selectedRemoteFiles.value.length === 0) return

  try {
    const { value: archiveName } = await ElMessageBox.prompt(
      `将压缩 ${selectedRemoteFiles.value.length} 个项目`,
      '批量压缩',
      {
        inputValue: 'archive.tar.gz',
        inputPattern: /^.+\.(zip|tar|tar\.gz|tgz|gz)$/,
        inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz, .gz)'
      }
    )

    if (!archiveName) return

    const archivePath = `${remotePath.value}/${archiveName}`.replace(/\/+/g, '/')
    const filePaths = selectedRemoteFiles.value.map((f) => f.path)

    ElMessage.info('正在压缩...')

    const result = await window.electronAPI.sftp.compressMultiple(
      currentSession.value.id,
      filePaths,
      archivePath
    )

    if (result.success) {
      ElMessage.success('压缩完成')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 远程文件解压
const extractRemoteFile = async (file: FileInfo, targetDir: string) => {
  if (!currentSession.value) return

  try {
    ElMessage.info('正在解压...')

    const result = await window.electronAPI.sftp.extract(
      currentSession.value.id,
      file.path,
      targetDir
    )

    if (result.success) {
      ElMessage.success('解压完成')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`解压失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`解压失败: ${error.message || error}`)
  }
}

// 远程文件解压到指定目录
const extractRemoteFileTo = async (file: FileInfo) => {
  if (!currentSession.value) return

  try {
    const { value: targetDir } = await ElMessageBox.prompt('请输入解压目标目录', '解压到', {
      inputValue: remotePath.value,
      inputPattern: /^\/.*$/,
      inputErrorMessage: '请输入有效的目录路径'
    })

    if (!targetDir) return

    await extractRemoteFile(file, targetDir)
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`解压失败: ${error.message || error}`)
    }
  }
}
</script>

<style scoped>
.sftp-panel {
  height: 100%;
  width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg, rgba(var(--primary-color-rgb), 0.04), transparent 150px),
    var(--bg-main);
  font-family: var(--font-sans);
  overflow: hidden;
}

.dual-panel {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 56px minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  position: relative;
  padding: 14px 16px 16px;
}

.file-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  min-width: 0;
}

.browser-header {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 12px;
  background:
    linear-gradient(180deg, rgba(var(--primary-color-rgb), 0.04), transparent 72px),
    var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.header-title .help-icon {
  font-size: 14px;
  color: var(--text-tertiary);
  cursor: help;
  transition: color 0.2s;
}

.header-title .help-icon:hover {
  color: var(--primary-color);
}

.browser-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--text-primary);
}

.drive-selector {
  width: 100%;
}

.session-selector {
  width: 100%;
}

.connected-session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  padding: 6px 8px 6px 10px;
  background: rgba(var(--primary-color-rgb), 0.08);
  border: 1px solid rgba(var(--primary-color-rgb), 0.22);
  border-radius: var(--radius-sm);
}

.path-input {
  width: 100%;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.path-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Path Navigator */
.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-primary);
  font-weight: 600;
}

.session-info span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connected-icon {
  color: var(--success-color);
  font-size: var(--text-lg);
  flex-shrink: 0;
}

.session-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-host {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.transfer-controls {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  z-index: 10;
  padding: 0;
}

.transfer-controls::before {
  content: '';
  width: 1px;
  flex: 1;
  min-height: 44px;
  background: linear-gradient(180deg, transparent, var(--border-color), transparent);
}

.transfer-controls::after {
  content: '';
  width: 1px;
  flex: 1;
  min-height: 44px;
  background: linear-gradient(180deg, transparent, var(--border-color), transparent);
}

.transfer-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-md);
}

.transfer-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  filter: grayscale(0.3);
}

.transfer-btn .el-icon {
  font-size: 20px;
  color: white;
}

.upload-btn {
  background: var(--primary-color);
}

.upload-btn:hover:not(:disabled) {
  background: var(--primary-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}

.download-btn {
  background: var(--success-color);
}

.download-btn:hover:not(:disabled) {
  background: #16a34a;
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}

.file-list {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
  background: var(--bg-secondary);
}

.file-list :deep(.virtual-table) {
  position: relative;
  border: none;
  border-radius: 0;
  background: var(--bg-secondary);
}

.file-list :deep(.table-header) {
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.file-list :deep(.table-header-cell) {
  padding: 10px 14px;
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--text-secondary);
}

.file-list :deep(.table-body) {
  padding: 6px 0 8px;
  box-sizing: border-box;
}

.file-list :deep(.table-row) {
  height: 100%;
  min-height: 40px;
  align-items: center;
  box-sizing: border-box;
  border-bottom: 1px solid var(--border-light);
}

.file-list :deep(.table-row:hover),
.file-list :deep(.table-row.hover) {
  background: rgba(var(--primary-color-rgb), 0.06);
}

.file-list :deep(.table-row.selected) {
  background: rgba(var(--primary-color-rgb), 0.12) !important;
  border-left: 0;
  box-shadow: inset 3px 0 0 var(--primary-color);
}

.file-list :deep(.table-row.selected:hover) {
  background: rgba(var(--primary-color-rgb), 0.16) !important;
}

.file-list :deep(.table-cell) {
  padding: 0 14px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  min-width: 0;
}

.file-list :deep(.table-empty) {
  position: absolute;
  inset: 41px 0 0;
  pointer-events: none;
  color: var(--text-tertiary);
}

.file-list :deep(.el-table) {
  --el-table-header-bg-color: var(--bg-main);
  --el-table-row-hover-bg-color: rgba(255, 255, 255, 0.04);
  --el-table-border-color: transparent;
  --el-table-text-color: var(--text-secondary);
  --el-table-header-text-color: var(--text-secondary);
  background-color: transparent;
  font-size: var(--text-sm);
}

.file-list :deep(.el-table tr) {
  transition: background-color 0.1s;
}

.file-list :deep(.el-table th.el-table__cell) {
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
  text-transform: uppercase;
  font-size: var(--text-xs);
}

.file-list :deep(.el-table td.el-table__cell) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  padding: 6px 0;
}

.file-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
  color: var(--text-primary);
  transition: color 0.2s;
  min-width: 0;
}

.file-name-cell span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-list :deep(.el-table__row:hover) .file-name-cell {
  color: var(--primary-color);
}

/* Icons */
.file-icon {
  color: var(--primary-color);
  flex-shrink: 0;
}

.transfer-queue-entry {
  position: absolute;
  right: 28px;
  bottom: 26px;
  z-index: 40;
}

.queue-entry-button {
  min-width: 112px;
  height: 34px;
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-lg);
  gap: 6px;
}

.queue-entry-button:not(.el-button--primary) {
  background: var(--bg-elevated) !important;
  border-color: var(--border-medium) !important;
}

.queue-entry-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--error-color);
  color: #fff;
  font-size: var(--text-xs);
  line-height: 18px;
  font-weight: 700;
}

:deep(.transfer-queue-dialog .el-dialog__body) {
  padding: 0;
}

/* Transfer Queue */
.transfer-queue {
  height: min(620px, 70vh);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.queue-header {
  height: 40px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.queue-tabs {
  flex: 1;
}

.queue-tabs :deep(.el-tabs__header) {
  margin: 0;
  border: none;
}

.queue-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.queue-tabs :deep(.el-tabs__item) {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding: 0 16px;
  height: 40px;
  line-height: 40px;
}

.queue-tabs :deep(.el-tabs__item.is-active) {
  color: var(--primary-color);
}

.queue-actions {
  display: flex;
  gap: 8px;
}

.queue-list {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.transfer-item {
  display: flex;
  flex-direction: column;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-light);
  gap: 8px;
  font-size: var(--text-sm);
}

.transfer-item:last-child {
  border-bottom: none;
}

.incomplete-item {
  background: rgba(255, 193, 7, 0.05);
}

.transfer-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.transfer-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.transfer-name {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transfer-path {
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-xs);
}

.transfer-meta {
  display: flex;
  gap: 16px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.transfer-status {
  min-width: 120px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.transfer-speed,
.transfer-progress-meta {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: 400;
}

.transfer-progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}

.transfer-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.status-text.active {
  color: var(--primary-color);
}
.status-text.paused {
  color: var(--warning-color);
}
.status-text.completed {
  color: var(--success-color);
}
.status-text.failed {
  color: var(--error-color);
}

/* Empty States */
.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.empty-state .el-icon {
  color: var(--text-disabled);
}

.empty-state p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.directory-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-tertiary);
}

.directory-empty .el-icon {
  color: var(--text-disabled);
}

.directory-empty p {
  margin: 0;
  font-size: var(--text-sm);
}

.error-state {
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: var(--error-color);
  opacity: 1;
}

.error-state p {
  max-width: 520px;
  margin: 0;
  line-height: 1.6;
  word-break: break-word;
}

/* Button & Input Overrides for "Tightness" */
:deep(.el-button--small) {
  padding: 6px 11px;
  font-weight: 500;
  border-radius: var(--radius-sm);
}

:deep(.el-input__wrapper) {
  min-height: 32px;
  box-shadow: none !important;
  border: 1px solid var(--border-color);
  background-color: var(--bg-tertiary) !important;
  border-radius: var(--radius-sm);
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease;
}

:deep(.el-input__wrapper:hover),
:deep(.el-input__wrapper.is-focus) {
  border-color: rgba(var(--primary-color-rgb), 0.45);
  background-color: var(--bg-elevated) !important;
}

:deep(.el-select .el-input__wrapper) {
  background-color: var(--bg-tertiary) !important;
}

:deep(.el-select-dropdown__item) {
  font-size: var(--text-sm);
}

/* Scrollbar Polish */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg-main);
}
::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

/* 权限编辑器样式 */
.permissions-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.permission-group {
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
}

.permission-group h4 {
  margin: 0 0 12px 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.permission-checkboxes {
  display: flex;
  gap: 16px;
}

.permission-octal {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-medium);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-base);
}

.octal-value {
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--primary-color);
}
</style>
