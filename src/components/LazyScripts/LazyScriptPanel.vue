<template>
  <div class="lazy-script-shell">
    <div class="lazy-script-panel">
      <aside class="script-sidebar">
      <div class="sidebar-top">
        <div>
          <h2>懒人脚本</h2>
          <p>{{ scripts.length }} 个脚本</p>
        </div>
        <el-tooltip content="新增脚本" placement="bottom">
          <el-button type="primary" :icon="Plus" circle @click="openEditor()" />
        </el-tooltip>
      </div>

      <el-input
        v-model="searchQuery"
        class="script-search"
        :prefix-icon="Search"
        placeholder="搜索脚本、文件名、标签"
        clearable
      />

      <div class="category-list">
        <button
          v-for="category in categoryItems"
          :key="category.key"
          type="button"
          class="category-item"
          :class="{ active: selectedCategory === category.key }"
          @click="selectedCategory = category.key"
        >
          <span>{{ category.label }}</span>
          <strong>{{ category.count }}</strong>
        </button>
      </div>

      <div class="script-actions">
        <el-tooltip content="使用详情" placement="top">
          <el-button class="usage-guide-button" :icon="QuestionFilled" @click="showUsageGuide = true">
            使用详情
          </el-button>
        </el-tooltip>
        <el-tooltip content="导入脚本库" placement="top">
          <el-button :icon="Upload" @click="importScripts" />
        </el-tooltip>
        <el-tooltip content="导出脚本库" placement="top">
          <el-button :icon="Download" @click="exportScripts" />
        </el-tooltip>
        <el-tooltip content="刷新" placement="top">
          <el-button :icon="Refresh" @click="loadScripts" />
        </el-tooltip>
      </div>
      </aside>

      <section class="script-list">
      <el-scrollbar>
        <button
          v-for="script in filteredScripts"
          :key="script.id"
          type="button"
          class="script-item"
          :class="{ active: selectedScript?.id === script.id }"
          @click="selectScript(script)"
        >
          <div class="script-item-main">
            <span class="script-name">{{ script.name }}</span>
            <span class="script-file-name">{{ script.fileName }}</span>
            <span class="script-desc">{{ script.description || script.content }}</span>
          </div>
          <div class="script-item-meta">
            <el-tag size="small" :type="riskTagType(script.riskLevel)" effect="plain">
              {{ riskLabel(script.riskLevel) }}
            </el-tag>
            <span>{{ script.usageCount }}</span>
          </div>
        </button>

        <el-empty
          v-if="!loading && filteredScripts.length === 0"
          description="暂无匹配脚本"
          :image-size="96"
        />
      </el-scrollbar>
      </section>

      <main class="script-detail">
      <div v-if="selectedScript" class="detail-shell">
        <header class="detail-header">
          <div class="detail-title">
            <div class="title-icon">
              <el-icon><MagicStick /></el-icon>
            </div>
            <div class="detail-title-content">
              <h3>{{ selectedScript.name }}</h3>
              <p>{{ selectedScript.description || '没有描述' }}</p>
            </div>
          </div>

          <div class="detail-actions">
            <el-tooltip content="编辑" placement="bottom">
              <el-button :icon="Edit" circle @click="openEditor(selectedScript)" />
            </el-tooltip>
            <el-tooltip content="删除" placement="bottom">
              <el-button
                class="detail-delete-button"
                :icon="Delete"
                circle
                type="danger"
                plain
                @click="deleteScript(selectedScript)"
              />
            </el-tooltip>
          </div>
        </header>

        <div class="detail-meta">
          <el-tag effect="plain">{{ selectedScript.category || '未分类' }}</el-tag>
          <el-tag effect="plain" type="info">{{ activeScriptFileName }}</el-tag>
          <el-tag effect="plain" :type="riskTagType(selectedScript.riskLevel)">
            {{ riskLabel(selectedScript.riskLevel) }}
          </el-tag>
          <el-tag effect="plain" type="info">{{ typeLabel(selectedScript.type) }}</el-tag>
          <el-tag
            v-for="tag in selectedScript.tags"
            :key="tag"
            effect="plain"
            type="info"
          >
            {{ tag }}
          </el-tag>
        </div>

        <section v-if="!isCommandScript" class="script-file-section">
          <div class="script-file-info">
            <span>远程路径</span>
            <code>{{ remoteScriptPath }}</code>
          </div>
          <div class="script-file-info">
            <span>运行命令</span>
            <code>{{ runCommand }}</code>
          </div>
        </section>

        <section v-if="showSshKeyHelper" class="ssh-key-helper-section">
          <div class="section-title">
            <span>SSH 密钥辅助</span>
            <small>生成或选择密钥后自动填入公钥变量</small>
          </div>
          <div class="ssh-key-helper-row">
            <el-select
              v-model="selectedSshKeyId"
              class="ssh-key-select"
              placeholder="选择已有 SSH 密钥"
              filterable
              clearable
              :loading="sshKeysLoading"
              @focus="loadSshKeys"
              @change="applySelectedPublicKey"
            >
              <el-option
                v-for="key in sshKeys"
                :key="key.id"
                :label="`${key.name} (${key.type.toUpperCase()})`"
                :value="key.id"
              >
                <div class="ssh-key-option">
                  <span>{{ key.name }}</span>
                  <small>{{ key.type.toUpperCase() }} · {{ key.fingerprint }}</small>
                </div>
              </el-option>
            </el-select>
            <el-tooltip content="刷新 SSH 密钥列表" placement="top">
              <el-button :icon="Refresh" :loading="sshKeysLoading" @click="loadSshKeys">
                <span class="ssh-key-action-text">刷新</span>
              </el-button>
            </el-tooltip>
            <el-tooltip content="手动添加 SSH 密钥并填入公钥" placement="top">
              <el-button :icon="Plus" @click="openManualKeyDialog">
                <span class="ssh-key-action-text">手动添加</span>
              </el-button>
            </el-tooltip>
            <el-tooltip content="生成 SSH 密钥并填入公钥" placement="top">
              <el-button type="primary" :icon="MagicStick" @click="openGenerateKeyDialog">
                <span class="ssh-key-action-text">生成并填入</span>
              </el-button>
            </el-tooltip>
          </div>
          <p v-if="selectedSshKey" class="ssh-key-helper-note">
            已选择：{{ selectedSshKey.name }}，公钥会写入脚本变量 public_key。
          </p>
        </section>

        <section v-if="selectedScript.variables.length" class="variables-section">
          <div class="section-title">
            <div class="section-title-main">
              <span>变量</span>
              <small>部署前替换到脚本文件内容</small>
            </div>
            <el-button
              v-if="showFirewallPortGuideButton"
              class="variable-help-button"
              :icon="QuestionFilled"
              size="small"
              @click="showFirewallPortGuide = true"
            >
              填写规则
            </el-button>
          </div>
          <div v-if="showFirewallPortGuideButton" class="firewall-port-presets">
            <div class="firewall-port-presets-head">
              <span>常用端口</span>
              <small>点击后只填入端口和协议，来源 IP/IP 段保持不变</small>
            </div>
            <div class="firewall-port-preset-list">
              <button
                v-for="preset in firewallPortPresets"
                :key="preset.title"
                type="button"
                class="firewall-port-preset"
                @click="applyFirewallPortPreset(preset)"
              >
                <span>{{ preset.title }}</span>
                <code>{{ preset.ports }} / {{ preset.protocol.join('+') }}</code>
              </button>
            </div>
          </div>
          <div v-if="showReplaceSshKeyHelper" class="authorized-key-helper">
            <div class="authorized-key-helper-main">
              <span>旧公钥选择</span>
              <small>
                {{ selectedAuthorizedKeySummary }}
              </small>
            </div>
            <el-button
              :icon="Refresh"
              :loading="authorizedKeysLoading"
              @click="loadRemoteAuthorizedKeys"
            >
              读取远程公钥列表
            </el-button>
          </div>
          <div class="variable-grid">
            <div
              v-for="variable in selectedScript.variables"
              :key="variable.name"
              class="variable-field"
              :class="{ 'variable-field-wide': variable.type === 'multiselect' }"
            >
              <span>
                {{ variable.label || variable.name }}
                <em v-if="variable.required">*</em>
              </span>
              <el-select
                v-if="variable.type === 'select'"
                v-model="executionValues[variable.name]"
                placeholder="请选择"
              >
                <template v-if="hasGroupedVariableOptions(variable)">
                  <el-option-group
                    v-for="group in groupedVariableOptions(variable)"
                    :key="group.label"
                    :label="group.label"
                  >
                    <el-option
                      v-for="option in group.options"
                      :key="option.raw"
                      :label="option.label"
                      :value="option.value"
                    />
                  </el-option-group>
                </template>
                <template v-else>
                  <el-option
                    v-for="option in parsedVariableOptions(variable)"
                    :key="option.raw"
                    :label="option.label"
                    :value="option.value"
                  />
                </template>
              </el-select>
              <div v-else-if="variable.type === 'multiselect'" class="variable-check-panel">
                <el-checkbox-group
                  :model-value="getMultiSelectValue(variable.name)"
                  @update:model-value="setMultiSelectValue(variable.name, $event)"
                >
                  <div v-if="hasGroupedVariableOptions(variable)" class="variable-check-groups">
                    <section
                      v-for="group in groupedVariableOptions(variable)"
                      :key="group.label"
                      class="variable-check-group"
                    >
                      <div class="variable-check-group-title">{{ group.label }}</div>
                      <div class="variable-check-list">
                        <el-checkbox
                          v-for="option in group.options"
                          :key="option.raw"
                          :value="option.value"
                          border
                        >
                          {{ option.label }}
                        </el-checkbox>
                      </div>
                    </section>
                  </div>
                  <div v-else class="variable-check-list">
                    <el-checkbox
                      v-for="option in parsedVariableOptions(variable)"
                      :key="option.raw"
                      :value="option.value"
                      border
                    >
                      {{ option.label }}
                    </el-checkbox>
                  </div>
                </el-checkbox-group>
              </div>
              <el-input-number
                v-else-if="variable.type === 'number'"
                v-model="numberExecutionValues[variable.name]"
                controls-position="right"
                @change="syncNumberVariable(variable.name)"
              />
              <el-input
                v-else
                v-model="executionValues[variable.name]"
                :type="variable.type === 'password' ? 'password' : variable.type === 'textarea' ? 'textarea' : 'text'"
                :rows="variable.type === 'textarea' ? 4 : undefined"
                :show-password="variable.type === 'password'"
              />
            </div>
          </div>
        </section>

        <section class="preview-section">
          <div class="section-title">
            <span>{{ isCommandScript ? '命令预览' : '脚本文件预览' }}</span>
            <small>{{ isCommandScript ? '单条命令将直接发送到终端' : activeTerminalText }}</small>
          </div>
          <pre class="script-preview"><code>{{ renderedContent }}</code></pre>
        </section>

        <footer class="run-bar">
          <div class="run-hint">
            默认动作：{{ runModeLabel(selectedScript.runMode, selectedScript.type) }}
          </div>
          <div class="run-actions">
            <el-tooltip :content="isCommandScript ? '复制命令' : '复制运行命令'" placement="top">
              <el-button :icon="DocumentCopy" @click="copyRunCommand">
                <span class="run-action-text">{{ isCommandScript ? '复制命令' : '复制运行命令' }}</span>
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="!isCommandScript" content="复制部署命令" placement="top">
              <el-button :icon="DocumentCopy" @click="copyDeployCommand">
                <span class="run-action-text">复制部署命令</span>
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="!isCommandScript" content="部署到终端" placement="top">
              <el-button
                :icon="Promotion"
                :disabled="!hasActiveTerminal || executingScript"
                :loading="executingScript"
                @click="deployScript"
              >
                <span class="run-action-text">部署到终端</span>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="isCommandScript ? '运行命令' : '运行脚本'" placement="top">
              <el-button
                type="primary"
                :icon="VideoPlay"
                :disabled="!hasActiveTerminal || executingScript"
                :loading="executingScript"
                @click="runScript"
              >
                <span class="run-action-text">{{ isCommandScript ? '运行命令' : '运行脚本' }}</span>
              </el-button>
            </el-tooltip>
          </div>
        </footer>
      </div>

      <el-empty v-else description="请选择或新建一个脚本" :image-size="128">
        <el-button type="primary" :icon="Plus" @click="openEditor()">新增脚本</el-button>
      </el-empty>
      </main>
    </div>

    <el-dialog
      v-model="showEditor"
      :title="editingScriptId ? '编辑懒人脚本' : '新增懒人脚本'"
      width="760px"
      class="lazy-script-dialog"
      destroy-on-close
    >
      <el-form label-position="top" class="script-form">
        <div class="form-grid three">
          <el-form-item label="脚本名称" required>
            <el-input v-model="scriptForm.name" placeholder="例如：修改 SSH 端口" />
          </el-form-item>
          <el-form-item label="脚本文件名" required>
            <el-input v-model="scriptForm.fileName" placeholder="例如：2.sh 或 init-ssh.sh" />
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="scriptForm.category" placeholder="例如：SSH 加固" />
          </el-form-item>
        </div>

        <el-form-item label="描述">
          <el-input v-model="scriptForm.description" placeholder="简短说明脚本用途" />
        </el-form-item>

        <div class="form-grid three">
          <el-form-item label="脚本类型">
            <el-select v-model="scriptForm.type">
              <el-option label="单条命令" value="command" />
              <el-option label="Shell 脚本" value="shell" />
              <el-option label="操作步骤" value="steps" />
            </el-select>
          </el-form-item>
          <el-form-item label="风险级别">
            <el-select v-model="scriptForm.riskLevel">
              <el-option label="低风险" value="low" />
              <el-option label="中风险" value="medium" />
              <el-option label="高风险" value="high" />
            </el-select>
          </el-form-item>
          <el-form-item label="默认动作">
            <el-select v-model="scriptForm.runMode">
              <el-option label="复制运行命令" value="copy" />
              <el-option label="部署到终端" value="paste" />
              <el-option label="运行脚本" value="execute" />
            </el-select>
          </el-form-item>
        </div>

        <el-form-item label="标签">
          <el-input v-model="scriptForm.tagsText" placeholder="多个标签用逗号分隔" />
        </el-form-item>

        <el-form-item label="脚本内容" required>
          <el-input
            v-model="scriptForm.content"
            type="textarea"
            :rows="12"
            placeholder="写入远程脚本文件的内容，支持 {{变量名}} 或 ${变量名}"
          />
        </el-form-item>

        <div class="variable-editor-head">
          <div>
            <h4>变量配置</h4>
            <p>变量名只能使用字母、数字和下划线，且不能以数字开头。</p>
          </div>
          <div>
            <el-button :icon="MagicStick" @click="detectVariables">识别变量</el-button>
            <el-button type="primary" plain :icon="Plus" @click="addVariable">添加变量</el-button>
          </div>
        </div>

        <div class="variable-editor">
          <div
            v-for="(variable, index) in scriptForm.variables"
            :key="`${variable.name}-${index}`"
            class="variable-row"
          >
            <el-input v-model="variable.name" placeholder="变量名" />
            <el-input v-model="variable.label" placeholder="显示名称" />
            <el-select v-model="variable.type">
              <el-option label="文本" value="text" />
              <el-option label="数字" value="number" />
              <el-option label="密码" value="password" />
              <el-option label="多行文本" value="textarea" />
              <el-option label="选项" value="select" />
              <el-option label="多选" value="multiselect" />
            </el-select>
            <el-input v-model="variable.defaultValue" placeholder="默认值" />
            <el-input
              v-if="variable.type === 'select' || variable.type === 'multiselect'"
              v-model="variable.optionsText"
              placeholder="选项，逗号分隔"
            />
            <el-checkbox v-model="variable.required">必填</el-checkbox>
            <el-button :icon="Delete" text type="danger" @click="removeVariable(index)" />
          </div>
          <el-empty
            v-if="scriptForm.variables.length === 0"
            description="暂无变量"
            :image-size="72"
          />
        </div>
      </el-form>

      <template #footer>
        <el-button @click="showEditor = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveScript">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showGenerateKeyDialog"
      title="生成 SSH 密钥并填入公钥"
      width="520px"
      class="lazy-script-key-dialog"
      destroy-on-close
    >
      <el-form label-position="top" class="script-form">
        <el-form-item label="密钥名称" required>
          <el-input v-model="generateKeyForm.name" placeholder="例如：server-admin-key" />
        </el-form-item>
        <div class="form-grid two">
          <el-form-item label="密钥类型">
            <el-select v-model="generateKeyForm.type">
              <el-option label="RSA" value="rsa" />
              <el-option label="ED25519" value="ed25519" />
              <el-option label="ECDSA" value="ecdsa" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="generateKeyForm.type !== 'ed25519'" label="密钥长度">
            <el-select v-model="generateKeyForm.bits">
              <el-option
                v-for="bits in availableKeyBits"
                :key="bits"
                :label="`${bits} 位`"
                :value="bits"
              />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="私钥密码">
          <el-input
            v-model="generateKeyForm.passphrase"
            type="password"
            show-password
            placeholder="可选，留空则不加密私钥"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="generateKeyForm.comment" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerateKeyDialog = false">取消</el-button>
        <el-button type="primary" :loading="generatingKey" @click="generateAndFillKey">
          生成并填入
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showManualKeyDialog"
      title="手动添加 SSH 密钥并填入公钥"
      width="720px"
      class="lazy-script-key-dialog"
      destroy-on-close
    >
      <el-form label-position="top" class="script-form">
        <el-form-item label="密钥名称" required>
          <el-input v-model="manualKeyForm.name" placeholder="例如：existing-server-key" />
        </el-form-item>
        <el-form-item label="私钥内容" required>
          <el-input
            v-model="manualKeyForm.privateKey"
            type="textarea"
            :rows="8"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </el-form-item>
        <el-form-item label="公钥内容">
          <el-input
            v-model="manualKeyForm.publicKey"
            type="textarea"
            :rows="3"
            placeholder="ssh-rsa AAAA...，留空会尝试根据私钥生成"
          />
        </el-form-item>
        <div class="form-grid two">
          <el-form-item label="私钥密码">
            <el-input
              v-model="manualKeyForm.passphrase"
              type="password"
              show-password
              placeholder="私钥有密码时填写"
            />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="manualKeyForm.comment" placeholder="可选" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showManualKeyDialog = false">取消</el-button>
        <el-button type="primary" :loading="addingKey" @click="addManualKeyAndFill">
          添加并填入
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showAuthorizedKeyDialog"
      title="选择要替换的旧公钥"
      width="840px"
      class="lazy-script-authorized-key-dialog"
    >
      <div class="authorized-key-dialog">
        <p>
          从远程用户 <strong>{{ stringifyExecutionValue(executionValues.username) || 'root' }}</strong>
          的 <code>authorized_keys</code> 中选择要删除的旧公钥。选择“只新增”会保留所有旧公钥。
        </p>

        <el-radio-group v-model="selectedAuthorizedKeyIndex" class="authorized-key-radio-list">
          <el-radio border label="0" class="authorized-key-radio">
            <div class="authorized-key-option">
              <strong>只新增新公钥</strong>
              <small>不删除任何已有公钥，旧公钥仍然可以继续登录。</small>
            </div>
          </el-radio>

          <el-radio
            v-for="entry in remoteAuthorizedKeys"
            :key="entry.index"
            border
            :label="String(entry.index)"
            class="authorized-key-radio"
          >
            <div class="authorized-key-option">
              <strong>#{{ entry.index }} · {{ entry.type }}</strong>
              <code>{{ entry.keyPreview }}</code>
              <small>{{ entry.comment || '无备注' }}</small>
            </div>
          </el-radio>
        </el-radio-group>

        <el-empty
          v-if="!remoteAuthorizedKeys.length"
          description="该用户 authorized_keys 中暂未检测到有效 SSH 公钥"
          :image-size="88"
        />
      </div>

      <template #footer>
        <el-button @click="showAuthorizedKeyDialog = false">取消</el-button>
        <el-button type="primary" @click="applySelectedAuthorizedKey">
          应用选择
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showUsageGuide"
      title="懒人脚本使用详情"
      width="820px"
      class="lazy-script-guide-dialog"
    >
      <div class="usage-guide">
        <section class="guide-section">
          <h3>脚本是什么</h3>
          <p>
            懒人脚本用于保存常用的 Shell 脚本或单条命令。Shell 脚本会先部署到远程主机
            <code>~/.mshell/scripts</code>，再通过 <code>bash 脚本文件</code> 运行。
          </p>
        </section>

        <section class="guide-section">
          <h3>脚本类型</h3>
          <div class="guide-grid">
            <div>
              <strong>单条命令</strong>
              <p>适合一行即可完成的命令，运行时直接发送到终端。</p>
            </div>
            <div>
              <strong>Shell 脚本</strong>
              <p>适合多行逻辑，会按文件名部署为远程脚本后运行。</p>
            </div>
            <div>
              <strong>操作步骤</strong>
              <p>适合记录人工操作流程，仍按脚本文本保存和引用。</p>
            </div>
          </div>
        </section>

        <section class="guide-section">
          <h3>变量用法</h3>
          <p>
            脚本内容支持 <code v-pre>{{变量名}}</code> 和 <code>${变量名}</code> 两种占位符。
            变量名只能使用字母、数字和下划线，且不能以数字开头。
          </p>
          <pre><code v-pre>NEW_PORT="{{ssh_port}}"
TARGET_USER="${username}"
echo "将 SSH 端口修改为 $NEW_PORT"</code></pre>
        </section>

        <section class="guide-section">
          <h3>变量配置</h3>
          <ul>
            <li><strong>变量名</strong>：必须和脚本里的占位符一致，例如 <code>ssh_port</code>。</li>
            <li><strong>显示名称</strong>：展示给用户看的输入项名称，例如 <code>SSH 端口</code>。</li>
            <li><strong>类型</strong>：支持文本、数字、密码、多行文本、选项和多选。</li>
            <li><strong>选项</strong>：选项/多选可用逗号分隔；需要分类显示时写成 <code>value|分类|显示名称</code>，分类只作为标题，不能被勾选。</li>
            <li><strong>默认值</strong>：打开脚本时自动填入，可按需修改。</li>
            <li><strong>必填</strong>：运行前会检查，避免空变量直接写进脚本。</li>
          </ul>
        </section>

        <section class="guide-section">
          <h3>按钮区别</h3>
          <div class="guide-grid">
            <div>
              <strong>复制运行命令</strong>
              <p>复制 <code>bash ~/.mshell/scripts/xxx.sh</code>，适合手动粘贴执行。</p>
            </div>
            <div>
              <strong>复制部署命令</strong>
              <p>复制完整部署脚本，会创建远程文件并写入内容。</p>
            </div>
            <div>
              <strong>部署到终端</strong>
              <p>在后台只同步脚本文件，不改动当前终端的提示符和输入行。</p>
            </div>
            <div>
              <strong>运行脚本</strong>
              <p>先同步文件，再切换到目标终端运行；输出结束后恢复真实 Shell 提示符和输入焦点。</p>
            </div>
          </div>
        </section>

        <section class="guide-section">
          <h3>推荐模板</h3>
          <pre><code v-pre>set -e
TARGET_USER="{{username}}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限执行该脚本。"
  exit 1
fi

echo "当前用户: $TARGET_USER"</code></pre>
        </section>

        <section class="guide-section">
          <h3>注意事项</h3>
          <ul>
            <li>高风险脚本建议先备份配置，再执行修改。</li>
            <li>修改 SSH、防火墙、用户权限前，建议保留当前连接并另开窗口测试。</li>
            <li>脚本文件名建议统一使用英文、数字和短横线，例如 <code>init-ssh.sh</code>。</li>
            <li>变量替换只是文本替换，脚本里仍要自行处理引号和参数安全。</li>
            <li>脚本运行超过 10 分钟时会停止等待完成标记，但不会强制终止远程进程，请返回目标终端检查。</li>
          </ul>
        </section>
      </div>

      <template #footer>
        <el-button type="primary" @click="showUsageGuide = false">知道了</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showFirewallPortGuide"
      title="放行防火墙端口填写说明"
      width="760px"
      class="lazy-script-firewall-guide-dialog"
    >
      <div class="firewall-guide">
        <section class="guide-section">
          <h3>填写格式</h3>
          <div class="firewall-guide-grid">
            <div>
              <strong>端口</strong>
              <p>支持单个或多个端口，例如 <code>22</code>、<code>22,80,443</code>。填写 <code>*</code>、<code>any</code> 或 <code>all</code> 表示全部端口。</p>
            </div>
            <div>
              <strong>协议</strong>
              <p>可以勾选 <code>tcp</code>、<code>udp</code>，也可以两个同时勾选。</p>
            </div>
            <div>
              <strong>来源 IP/IP 段</strong>
              <p>支持 <code>any</code>、单个 IP、多个 IP、CIDR 段。多个来源可用逗号、空格或换行分隔。</p>
            </div>
          </div>
        </section>

        <section class="guide-section">
          <h3>风险提醒</h3>
          <ul>
            <li><code>来源=any</code> 表示任意来源，适合公开 Web 服务，但不建议用于管理端口。</li>
            <li><code>端口=*</code> 会放行全部端口，建议只配合明确的来源 IP/IP 段使用。</li>
            <li>云服务器还可能有安全组，脚本只能修改系统内防火墙，安全组仍需在云平台放行。</li>
          </ul>
        </section>
      </div>

      <template #footer>
        <el-button @click="showFirewallPortGuide = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showTargetTerminalDialog"
      title="确认目标终端"
      width="560px"
      class="lazy-script-target-dialog"
      :close-on-click-modal="false"
      @closed="cancelTargetTerminalSelection"
    >
      <div class="target-terminal-panel">
        <div class="target-terminal-summary">
          <span>即将{{ targetTerminalActionText }}</span>
          <strong>{{ selectedScript?.name || '未命名脚本' }}</strong>
        </div>

        <el-form label-position="top">
          <el-form-item label="目标终端">
            <el-select
              v-model="selectedTargetTerminalId"
              class="target-terminal-select"
              placeholder="请选择要运行的 SSH 终端"
              filterable
            >
              <el-option
                v-for="tab in sshTerminalTabs"
                :key="tab.id"
                :label="formatTerminalLabel(tab)"
                :value="tab.id"
              >
                <div class="target-terminal-option">
                  <span>{{ tab.name || `${tab.session.username}@${tab.session.host}` }}</span>
                  <small>{{ formatTerminalMeta(tab) }}</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
        </el-form>

        <div v-if="selectedTargetTerminal" class="target-terminal-card">
          <span>{{ selectedTargetTerminal.name || selectedTargetTerminal.session.name }}</span>
          <code>{{ formatTerminalMeta(selectedTargetTerminal) }}</code>
        </div>
        <p v-if="targetTerminalIntent === 'run'" class="target-terminal-hint">
          运行前请确认目标终端停留在可输入命令的 Shell 提示符；脚本输出将在该终端实时显示。
        </p>
      </div>

      <template #footer>
        <el-button @click="cancelTargetTerminalSelection">取消</el-button>
        <el-button type="primary" @click="confirmTargetTerminalSelection">
          确认{{ targetTerminalActionText }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Delete,
  DocumentCopy,
  Download,
  Edit,
  MagicStick,
  Plus,
  Promotion,
  QuestionFilled,
  Refresh,
  Search,
  Upload,
  VideoPlay
} from '@element-plus/icons-vue'
import { useAppStore, type Tab } from '@/stores/app'
import { terminalManager } from '@/utils/terminal-manager'
import { buildTerminalExecutePayload } from '@/utils/terminal-command-execution'
import {
  appendScriptOutputBuffer,
  buildInteractiveScriptCommand,
  createScriptRunToken,
  findScriptCompletion
} from '@/utils/terminal-script-execution'

type LazyScriptType = 'command' | 'shell' | 'steps'
type LazyScriptRunMode = 'copy' | 'paste' | 'execute'
type LazyScriptRiskLevel = 'low' | 'medium' | 'high'
type LazyScriptVariableType = 'text' | 'number' | 'password' | 'textarea' | 'select' | 'multiselect'
type SSHKeyType = 'rsa' | 'ed25519' | 'ecdsa'
type ExecutionValue = string | string[]

interface LazyScriptVariable {
  name: string
  label: string
  type: LazyScriptVariableType
  defaultValue?: string
  required?: boolean
  options?: string[]
}

interface LazyScript {
  id: string
  name: string
  fileName: string
  description: string
  category: string
  tags: string[]
  type: LazyScriptType
  content: string
  variables: LazyScriptVariable[]
  riskLevel: LazyScriptRiskLevel
  runMode: LazyScriptRunMode
  usageCount: number
  createdAt: string
  updatedAt: string
}

interface EditableVariable extends LazyScriptVariable {
  optionsText?: string
}

interface VariableOptionItem {
  raw: string
  value: string
  label: string
  group: string
}

interface FirewallPortPreset {
  title: string
  description: string
  ports: string
  protocol: string[]
}

interface AuthorizedKeyEntry {
  index: number
  type: string
  key: string
  keyPreview: string
  comment: string
  line: string
}

interface SSHKey {
  id: string
  name: string
  type: SSHKeyType
  bits?: number
  publicKey: string
  fingerprint: string
  comment?: string
  protected?: boolean
  createdAt?: string
}

const appStore = useAppStore()
const scripts = ref<LazyScript[]>([])
const selectedScript = ref<LazyScript | null>(null)
const selectedCategory = ref('__all__')
const searchQuery = ref('')
const loading = ref(false)
const saving = ref(false)
const executingScript = ref(false)
const showEditor = ref(false)
const showUsageGuide = ref(false)
const showFirewallPortGuide = ref(false)
const showTargetTerminalDialog = ref(false)
const editingScriptId = ref('')
const sshKeys = ref<SSHKey[]>([])
const sshKeysLoading = ref(false)
const selectedSshKeyId = ref('')
const showGenerateKeyDialog = ref(false)
const showManualKeyDialog = ref(false)
const showAuthorizedKeyDialog = ref(false)
const generatingKey = ref(false)
const addingKey = ref(false)
const authorizedKeysLoading = ref(false)
const remoteAuthorizedKeys = ref<AuthorizedKeyEntry[]>([])
const selectedAuthorizedKeyIndex = ref('0')
const executionValues = reactive<Record<string, ExecutionValue>>({})
const numberExecutionValues = reactive<Record<string, number | undefined>>({})

const scriptForm = reactive({
  name: '',
  fileName: '',
  description: '',
  category: '',
  tagsText: '',
  type: 'shell' as LazyScriptType,
  content: '',
  variables: [] as EditableVariable[],
  riskLevel: 'medium' as LazyScriptRiskLevel,
  runMode: 'paste' as LazyScriptRunMode
})

const generateKeyForm = reactive({
  name: '',
  type: 'rsa' as SSHKeyType,
  bits: 4096,
  passphrase: '',
  comment: ''
})

const manualKeyForm = reactive({
  name: '',
  privateKey: '',
  publicKey: '',
  passphrase: '',
  comment: ''
})

type TargetTerminalIntent = 'deploy' | 'run' | 'send-command' | 'read-authorized-keys'

const selectedTargetTerminalId = ref('')
const targetTerminalIntent = ref<TargetTerminalIntent>('run')
let resolveTargetTerminalSelection: ((terminalId: string | null) => void) | null = null

const sshTerminalTabs = computed(() => appStore.tabs.filter(isSshTerminalTab))
const hasActiveTerminal = computed(() => sshTerminalTabs.value.length > 0)
const isCommandScript = computed(() => selectedScript.value?.type === 'command')
const activeTerminalText = computed(() => {
  const tab = sshTerminalTabs.value.find((item) => item.id === appStore.activeTab)
  if (!tab) return '未选择终端'
  return `当前终端：${formatTerminalMeta(tab)}`
})
const selectedTargetTerminal = computed(
  () => sshTerminalTabs.value.find((tab) => tab.id === selectedTargetTerminalId.value) || null
)
const targetTerminalActionText = computed(() => {
  const labels: Record<TargetTerminalIntent, string> = {
    deploy: '部署到终端',
    run: '运行脚本',
    'send-command': '发送命令',
    'read-authorized-keys': '读取公钥列表'
  }
  return labels[targetTerminalIntent.value]
})

const activeScriptFileName = computed(() =>
  normalizeScriptFileName(selectedScript.value?.fileName || selectedScript.value?.name || 'script.sh')
)
const remoteScriptsDir = '~/.mshell/scripts'
const scriptExecutionTimeoutMs = 10 * 60 * 1000
const clearCurrentTerminalLine = '\x15\x0b'
const remoteScriptPath = computed(() => `${remoteScriptsDir}/${activeScriptFileName.value}`)
const quotedRemoteScriptPath = computed(
  () => `${remoteScriptsDir}/${shellQuotePathSegment(activeScriptFileName.value)}`
)
const runCommand = computed(() => `bash ${quotedRemoteScriptPath.value}`)
const publicKeyVariable = computed(() =>
  selectedScript.value?.variables.find((variable) => variable.name === 'public_key') || null
)
const showSshKeyHelper = computed(() => Boolean(publicKeyVariable.value))
const selectedSshKey = computed(
  () => sshKeys.value.find((key) => key.id === selectedSshKeyId.value) || null
)
const isReplaceSshPublicKeyScript = computed(() => {
  const script = selectedScript.value
  if (!script) return false
  return (
    normalizeScriptFileName(script.fileName) === 'replace-ssh-public-key.sh' ||
    script.name === '替换 SSH 公钥'
  )
})
const showReplaceSshKeyHelper = computed(() => isReplaceSshPublicKeyScript.value)
const selectedAuthorizedKeyEntry = computed(() =>
  remoteAuthorizedKeys.value.find((entry) => String(entry.index) === selectedAuthorizedKeyIndex.value) || null
)
const selectedAuthorizedKeySummary = computed(() => {
  const oldPublicKey = stringifyExecutionValue(executionValues.old_public_key).trim()
  if (oldPublicKey) {
    const matched = remoteAuthorizedKeys.value.find((entry) => entry.line.trim() === oldPublicKey)
    return matched
      ? `将删除 #${matched.index} ${matched.type} ${matched.comment || '无备注'}`
      : '已填写旧公钥，将按公钥内容精确删除'
  }

  const index = Number(stringifyExecutionValue(executionValues.delete_key_index) || '0')
  if (Number.isInteger(index) && index > 0) {
    const matched = remoteAuthorizedKeys.value.find((entry) => entry.index === index)
    return matched
      ? `将删除 #${matched.index} ${matched.type} ${matched.comment || '无备注'}`
      : `将按序号 ${index} 删除远程公钥`
  }

  return '当前为只新增模式，不会删除已有公钥'
})
const availableKeyBits = computed(() =>
  generateKeyForm.type === 'ecdsa' ? [256, 384, 521] : [2048, 3072, 4096]
)
const showFirewallPortGuideButton = computed(() => {
  const script = selectedScript.value
  if (!script) return false
  const variableNames = new Set(script.variables.map((variable) => variable.name))
  return (
    script.fileName === 'allow-firewall-port.sh' ||
    script.name === '放行防火墙端口' ||
    (variableNames.has('ports') && variableNames.has('protocol') && variableNames.has('sources'))
  )
})

const firewallPortPresets: FirewallPortPreset[] = [
  {
    title: 'Web + SSH',
    description: 'SSH、HTTP、HTTPS',
    ports: '22,80,443',
    protocol: ['tcp']
  },
  {
    title: 'SSH',
    description: '远程登录',
    ports: '22',
    protocol: ['tcp']
  },
  {
    title: 'Web',
    description: 'HTTP、HTTPS',
    ports: '80,443',
    protocol: ['tcp']
  },
  {
    title: 'DNS',
    description: 'TCP/UDP 53',
    ports: '53',
    protocol: ['tcp', 'udp']
  },
  {
    title: '邮件',
    description: 'SMTP/IMAP/POP3',
    ports: '25,465,587,110,995,143,993',
    protocol: ['tcp']
  },
  {
    title: '数据库',
    description: 'MySQL/PostgreSQL/Redis',
    ports: '3306,5432,6379',
    protocol: ['tcp']
  },
  {
    title: '面板',
    description: '常见运维面板',
    ports: '8888,8080,8443',
    protocol: ['tcp']
  },
  {
    title: '全部端口',
    description: '需配合明确来源',
    ports: '*',
    protocol: ['tcp', 'udp']
  }
]

const categoryItems = computed(() => {
  const counts = new Map<string, number>()
  scripts.value.forEach((script) => {
    const category = script.category.trim() || '__uncategorized'
    counts.set(category, (counts.get(category) || 0) + 1)
  })

  const items = [
    { key: '__all__', label: '全部脚本', count: scripts.value.length },
    ...Array.from(counts.entries()).map(([key, count]) => ({
      key,
      label: key === '__uncategorized' ? '未分类' : key,
      count
    }))
  ]

  return items
})

const filteredScripts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return scripts.value.filter((script) => {
    const category = script.category.trim() || '__uncategorized'
    const matchesCategory = selectedCategory.value === '__all__' || selectedCategory.value === category
    const matchesQuery =
      !query ||
      [script.name, script.fileName, script.description, script.category, script.content, script.tags.join(' ')]
        .join('\n')
        .toLowerCase()
        .includes(query)

    return matchesCategory && matchesQuery
  })
})

const renderedContent = computed(() => {
  if (!selectedScript.value) return ''
  let result = selectedScript.value.content
  Object.entries(executionValues).forEach(([name, value]) => {
    const escaped = escapeRegExp(name)
    const normalizedValue = stringifyExecutionValue(value)
    result = result.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), normalizedValue)
    result = result.replace(new RegExp(`\\$\\{${escaped}\\}`, 'g'), normalizedValue)
  })
  return result
})

watch(selectedScript, (script) => {
  resetExecutionValues(script)
  selectedSshKeyId.value = ''
  remoteAuthorizedKeys.value = []
  selectedAuthorizedKeyIndex.value = '0'
  showAuthorizedKeyDialog.value = false
  if (!showFirewallPortGuideButton.value) {
    showFirewallPortGuide.value = false
  }
  if (script?.variables.some((variable) => variable.name === 'public_key')) {
    loadSshKeys(false)
  }
})

watch(
  () => generateKeyForm.type,
  (type) => {
    if (type === 'rsa' && ![2048, 3072, 4096].includes(generateKeyForm.bits)) {
      generateKeyForm.bits = 4096
    } else if (type === 'ecdsa' && ![256, 384, 521].includes(generateKeyForm.bits)) {
      generateKeyForm.bits = 256
    }
  }
)

watch(filteredScripts, (nextScripts) => {
  if (
    !selectedScript.value ||
    !nextScripts.some((script) => script.id === selectedScript.value?.id)
  ) {
    selectedScript.value = nextScripts[0] || null
  }
})

onMounted(() => {
  loadScripts()
})

const loadScripts = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.lazyScript.getAll()
    if (result.success) {
      scripts.value = (result.data || []).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      if (!selectedScript.value || !scripts.value.some((script) => script.id === selectedScript.value?.id)) {
        selectedScript.value = scripts.value[0] || null
      } else {
        selectedScript.value =
          scripts.value.find((script) => script.id === selectedScript.value?.id) || null
      }
    } else {
      ElMessage.error(result.error || '加载懒人脚本失败')
    }
  } catch (error: any) {
    ElMessage.error('加载懒人脚本失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const selectScript = (script: LazyScript) => {
  selectedScript.value = script
}

const resetExecutionValues = (script: LazyScript | null) => {
  Object.keys(executionValues).forEach((key) => delete executionValues[key])
  Object.keys(numberExecutionValues).forEach((key) => delete numberExecutionValues[key])

  script?.variables.forEach((variable) => {
    const value = variable.defaultValue || ''
    executionValues[variable.name] =
      variable.type === 'multiselect' ? parseMultiSelectDefault(value) : value
    if (variable.type === 'number') {
      const numberValue = Number(value)
      numberExecutionValues[variable.name] = Number.isFinite(numberValue) ? numberValue : undefined
    }
  })
}

const syncNumberVariable = (name: string) => {
  const value = numberExecutionValues[name]
  executionValues[name] = value === undefined || value === null ? '' : String(value)
}

const applyFirewallPortPreset = (preset: FirewallPortPreset) => {
  executionValues.ports = preset.ports
  executionValues.protocol = [...preset.protocol]
  ElMessage.success('已填入常用端口，来源 IP/IP 段请按实际情况确认')
}

const loadRemoteAuthorizedKeys = async () => {
  if (!isReplaceSshPublicKeyScript.value || authorizedKeysLoading.value) return
  if (!validateTerminalReady()) return

  const username = stringifyExecutionValue(executionValues.username).trim() || 'root'
  const targetTerminalId = await requestTargetTerminal('read-authorized-keys')
  if (!targetTerminalId) return

  authorizedKeysLoading.value = true
  try {
    const result = await window.electronAPI.ssh.executeCommand(
      targetTerminalId,
      buildListAuthorizedKeysCommand(username),
      15000
    )

    if (!result.success) {
      ElMessage.error(result.error || '读取远程公钥列表失败')
      return
    }

    const output = result.data || ''
    const remoteError = parseRemoteAuthorizedKeysError(output)
    if (remoteError) {
      ElMessage.error(remoteError)
      return
    }

    remoteAuthorizedKeys.value = parseRemoteAuthorizedKeys(output)
    selectedAuthorizedKeyIndex.value = getCurrentDeleteKeyIndex()
    if (
      selectedAuthorizedKeyIndex.value !== '0' &&
      !remoteAuthorizedKeys.value.some((entry) => String(entry.index) === selectedAuthorizedKeyIndex.value)
    ) {
      selectedAuthorizedKeyIndex.value = '0'
    }

    showAuthorizedKeyDialog.value = true
    if (!remoteAuthorizedKeys.value.length) {
      ElMessage.warning('该用户 authorized_keys 中暂未检测到有效 SSH 公钥')
    }
  } catch (error: any) {
    ElMessage.error('读取远程公钥列表失败: ' + error.message)
  } finally {
    authorizedKeysLoading.value = false
  }
}

const buildListAuthorizedKeysCommand = (username: string) =>
  [
    `TARGET_USER=${shellQuote(username)}`,
    'USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"',
    'if [ -z "$USER_HOME" ]; then printf "__MSHELL_ERROR__\\t用户不存在: %s\\n" "$TARGET_USER"; exit 0; fi',
    'AUTHORIZED_KEYS="$USER_HOME/.ssh/authorized_keys"',
    'if [ ! -f "$AUTHORIZED_KEYS" ]; then printf "__MSHELL_EMPTY__\\n"; exit 0; fi',
    `awk '
      function key_comment(start,    i, value) {
        value = ""
        for (i = start; i <= NF; i++) {
          value = value (value ? " " : "") $i
        }
        return value
      }
      {
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-[^[:space:]]+|sk-ssh-[^[:space:]]+|sk-ecdsa-[^[:space:]]+)$/ && i < NF) {
            key_count += 1
            comment = key_comment(i + 2)
            gsub(/\\t/, " ", comment)
            line = $0
            gsub(/\\t/, " ", line)
            printf "__MSHELL_KEY__\\t%d\\t%s\\t%s\\t%s\\t%s\\n", key_count, $i, $(i + 1), comment, line
            break
          }
        }
      }
    ' "$AUTHORIZED_KEYS"`
  ].join('\n')

const parseRemoteAuthorizedKeysError = (output: string) => {
  const line = output
    .split(/\r?\n/)
    .find((item) => item.startsWith('__MSHELL_ERROR__\t'))
  return line ? line.split('\t').slice(1).join('\t') || '读取远程公钥列表失败' : ''
}

const parseRemoteAuthorizedKeys = (output: string): AuthorizedKeyEntry[] =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('__MSHELL_KEY__\t'))
    .map((line) => {
      const parts = line.split('\t')
      const index = Number(parts[1])
      const type = parts[2] || ''
      const key = parts[3] || ''
      const comment = parts[4] || ''
      const fallbackLine = `${type} ${key}${comment ? ` ${comment}` : ''}`.trim()
      return {
        index,
        type,
        key,
        keyPreview: formatPublicKeyPreview(key),
        comment,
        line: parts.slice(5).join('\t').trim() || fallbackLine
      }
    })
    .filter((entry) => Number.isInteger(entry.index) && entry.index > 0 && entry.type && entry.key)

const formatPublicKeyPreview = (value: string) =>
  value.length > 36 ? `${value.slice(0, 18)}...${value.slice(-10)}` : value

const getCurrentDeleteKeyIndex = () => {
  const value =
    numberExecutionValues.delete_key_index === undefined ||
    numberExecutionValues.delete_key_index === null
      ? executionValues.delete_key_index
      : numberExecutionValues.delete_key_index
  const index = Number(String(value || '0').trim())
  return Number.isInteger(index) && index > 0 ? String(index) : '0'
}

const applySelectedAuthorizedKey = () => {
  const index = Number(selectedAuthorizedKeyIndex.value || '0')
  if (!Number.isInteger(index) || index < 0) {
    ElMessage.warning('请选择有效的公钥序号')
    return
  }

  if (index === 0) {
    executionValues.old_public_key = ''
    executionValues.delete_key_index = '0'
    numberExecutionValues.delete_key_index = 0
    showAuthorizedKeyDialog.value = false
    ElMessage.success('已设置为只新增新公钥')
    return
  }

  const entry = selectedAuthorizedKeyEntry.value
  if (!entry) {
    ElMessage.warning('请选择要删除的旧公钥')
    return
  }

  executionValues.old_public_key = entry.line
  executionValues.delete_key_index = String(entry.index)
  numberExecutionValues.delete_key_index = entry.index
  showAuthorizedKeyDialog.value = false
  ElMessage.success(`已选择删除 #${entry.index} ${entry.type}`)
}

const loadSshKeys = async (showError: boolean | Event = true) => {
  const shouldShowError = typeof showError === 'boolean' ? showError : true
  if (!window.electronAPI.sshKey?.getAll) return

  sshKeysLoading.value = true
  try {
    const result = await window.electronAPI.sshKey.getAll()
    if (!result.success) {
      if (shouldShowError) ElMessage.error(result.error || '加载 SSH 密钥失败')
      return
    }

    sshKeys.value = (result.data || [])
      .map(normalizeSshKey)
      .filter((key) => Boolean(key.id && key.name))
      .sort((a, b) => {
        const nextTime = new Date(b.createdAt || '').getTime()
        const currentTime = new Date(a.createdAt || '').getTime()
        return (Number.isFinite(nextTime) ? nextTime : 0) - (Number.isFinite(currentTime) ? currentTime : 0)
      })

    if (selectedSshKeyId.value && !sshKeys.value.some((key) => key.id === selectedSshKeyId.value)) {
      selectedSshKeyId.value = ''
    }
  } catch (error: any) {
    if (shouldShowError) {
      ElMessage.error('加载 SSH 密钥失败: ' + error.message)
    }
  } finally {
    sshKeysLoading.value = false
  }
}

const applySelectedPublicKey = (keyId: string) => {
  if (!keyId) return
  const key = sshKeys.value.find((item) => item.id === keyId)
  if (!key) {
    ElMessage.warning('未找到选择的 SSH 密钥')
    return
  }
  fillPublicKeyFromKey(key, '已填入公钥')
}

const openGenerateKeyDialog = () => {
  const host = appStore.currentSession?.host || 'server'
  const safeHost = host.replace(/[^a-zA-Z0-9._-]/g, '-')
  generateKeyForm.name = `mshell-${safeHost}`
  generateKeyForm.type = 'rsa'
  generateKeyForm.bits = 4096
  generateKeyForm.passphrase = ''
  generateKeyForm.comment = `MShell ${host}`
  showGenerateKeyDialog.value = true
}

const openManualKeyDialog = () => {
  const host = appStore.currentSession?.host || 'server'
  const safeHost = host.replace(/[^a-zA-Z0-9._-]/g, '-')
  manualKeyForm.name = `manual-${safeHost}`
  manualKeyForm.privateKey = ''
  manualKeyForm.publicKey = stringifyExecutionValue(executionValues.public_key)
  manualKeyForm.passphrase = ''
  manualKeyForm.comment = ''
  showManualKeyDialog.value = true
}

const generateAndFillKey = async () => {
  if (!generateKeyForm.name.trim()) {
    ElMessage.warning('请输入密钥名称')
    return
  }

  generatingKey.value = true
  try {
    const options = {
      name: generateKeyForm.name.trim(),
      type: generateKeyForm.type,
      bits: generateKeyForm.type === 'ed25519' ? undefined : generateKeyForm.bits,
      passphrase: generateKeyForm.passphrase || undefined,
      comment: generateKeyForm.comment.trim() || undefined
    }
    const result = await window.electronAPI.sshKey?.generate?.(options)
    if (!result?.success || !result.data) {
      ElMessage.error(result?.error || '生成 SSH 密钥失败')
      return
    }

    const key = normalizeSshKey(result.data)
    await loadSshKeys(false)
    selectedSshKeyId.value = key.id
    fillPublicKeyFromKey(key, '密钥已生成并填入公钥')
    showGenerateKeyDialog.value = false
  } catch (error: any) {
    ElMessage.error('生成 SSH 密钥失败: ' + error.message)
  } finally {
    generatingKey.value = false
  }
}

const addManualKeyAndFill = async () => {
  if (!manualKeyForm.name.trim() || !manualKeyForm.privateKey.trim()) {
    ElMessage.warning('请输入密钥名称和私钥内容')
    return
  }

  addingKey.value = true
  try {
    const result = await window.electronAPI.sshKey?.add?.({
      name: manualKeyForm.name.trim(),
      privateKey: manualKeyForm.privateKey,
      publicKey: manualKeyForm.publicKey.trim() || undefined,
      passphrase: manualKeyForm.passphrase || undefined,
      comment: manualKeyForm.comment.trim() || undefined
    })
    if (!result?.success || !result.data) {
      ElMessage.error(result?.error || '添加 SSH 密钥失败')
      return
    }

    const key = normalizeSshKey(result.data)
    await loadSshKeys(false)
    selectedSshKeyId.value = key.id
    fillPublicKeyFromKey(key, '密钥已添加并填入公钥')
    showManualKeyDialog.value = false
  } catch (error: any) {
    ElMessage.error('添加 SSH 密钥失败: ' + error.message)
  } finally {
    addingKey.value = false
  }
}

const fillPublicKeyFromKey = (key: SSHKey, message: string) => {
  if (!isUsablePublicKey(key.publicKey)) {
    ElMessage.warning('该密钥没有可用公钥')
    return
  }
  executionValues.public_key = key.publicKey.trim()
  ElMessage.success(message)
}

const openEditor = (script?: LazyScript) => {
  editingScriptId.value = script?.id || ''
  scriptForm.name = script?.name || ''
  scriptForm.fileName = script?.fileName || normalizeScriptFileName(script?.name || 'script.sh')
  scriptForm.description = script?.description || ''
  scriptForm.category = script?.category || ''
  scriptForm.tagsText = script?.tags.join(', ') || ''
  scriptForm.type = script?.type || 'shell'
  scriptForm.content = script?.content || ''
  scriptForm.variables = (script?.variables || []).map((variable) => ({
    ...variable,
    optionsText: variable.options?.join(', ') || ''
  }))
  scriptForm.riskLevel = script?.riskLevel || 'medium'
  scriptForm.runMode = script?.runMode || 'paste'
  showEditor.value = true
}

const addVariable = (name = '') => {
  scriptForm.variables.push({
    name,
    label: name,
    type: 'text',
    defaultValue: '',
    required: false,
    optionsText: ''
  })
}

const removeVariable = (index: number) => {
  scriptForm.variables.splice(index, 1)
}

const detectVariables = async () => {
  const result = await window.electronAPI.lazyScript.extractVariables(scriptForm.content)
  if (!result.success) {
    ElMessage.error(result.error || '识别变量失败')
    return
  }

  const existingNames = new Set(scriptForm.variables.map((variable) => variable.name))
  const names = result.data || []
  let added = 0
  names.forEach((name) => {
    if (!existingNames.has(name)) {
      addVariable(name)
      existingNames.add(name)
      added++
    }
  })

  ElMessage.success(added > 0 ? `已添加 ${added} 个变量` : '变量已是最新')
}

const saveScript = async () => {
  if (!scriptForm.name.trim()) {
    ElMessage.warning('请输入脚本名称')
    return
  }
  if (!scriptForm.fileName.trim()) {
    ElMessage.warning('请输入脚本文件名')
    return
  }
  if (!scriptForm.content.trim()) {
    ElMessage.warning('请输入脚本内容')
    return
  }

  const invalidVariable = scriptForm.variables.find((variable) => !isValidVariableName(variable.name))
  if (invalidVariable) {
    ElMessage.warning(`变量名不合法：${invalidVariable.name || '(空)'}`)
    return
  }

  const payload = {
    name: scriptForm.name.trim(),
    fileName: normalizeScriptFileName(scriptForm.fileName),
    description: scriptForm.description.trim(),
    category: scriptForm.category.trim(),
    tags: scriptForm.tagsText
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    type: scriptForm.type,
    content: scriptForm.content,
    variables: scriptForm.variables.map((variable) => ({
      name: variable.name.trim(),
      label: variable.label.trim() || variable.name.trim(),
      type: variable.type,
      defaultValue: variable.defaultValue || '',
      required: Boolean(variable.required),
      options:
        variable.type === 'select' || variable.type === 'multiselect'
          ? (variable.optionsText || '')
              .split(/[,，]/)
              .map((option) => option.trim())
              .filter(Boolean)
          : undefined
    })),
    riskLevel: scriptForm.riskLevel,
    runMode: scriptForm.runMode
  }

  saving.value = true
  try {
    const result = editingScriptId.value
      ? await window.electronAPI.lazyScript.update(editingScriptId.value, payload)
      : await window.electronAPI.lazyScript.create(payload)

    if (!result.success) {
      ElMessage.error(result.error || '保存失败')
      return
    }

    const nextSelectedId = editingScriptId.value || result.data?.id
    showEditor.value = false
    await loadScripts()
    selectedScript.value = scripts.value.find((script) => script.id === nextSelectedId) || scripts.value[0] || null
    ElMessage.success('脚本已保存')
  } catch (error: any) {
    ElMessage.error('保存失败: ' + error.message)
  } finally {
    saving.value = false
  }
}

const deleteScript = async (script: LazyScript) => {
  try {
    await ElMessageBox.confirm(`确定要删除脚本 "${script.name}" 吗？`, '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.lazyScript.delete(script.id)
    if (!result.success) {
      ElMessage.error(result.error || '删除失败')
      return
    }

    selectedScript.value = null
    await loadScripts()
    ElMessage.success('脚本已删除')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败: ' + error.message)
    }
  }
}

const copyDeployCommand = async () => {
  if (!selectedScript.value || !validateRequiredVariables()) return
  if (isCommandScript.value) {
    ElMessage.warning('单条命令无需部署，请复制命令或直接运行')
    return
  }
  await navigator.clipboard.writeText(buildDeployCommand())
  await markUsed()
  ElMessage.success('部署命令已复制')
}

const copyRunCommand = async () => {
  if (!selectedScript.value || !validateRequiredVariables()) return
  await navigator.clipboard.writeText(buildRunCommand())
  await markUsed()
  ElMessage.success(isCommandScript.value ? '命令已复制' : '同步并运行命令已复制')
}

const deployScript = async () => {
  if (!selectedScript.value || !validateTerminalReady() || !validateRequiredVariables() || executingScript.value) return
  if (isCommandScript.value) {
    ElMessage.warning('单条命令无需部署，请直接运行')
    return
  }

  const targetTerminalId = await requestTargetTerminal('deploy')
  if (!targetTerminalId) return

  executingScript.value = true
  try {
    const result = await window.electronAPI.ssh.executeCommand(
      targetTerminalId,
      buildDeployCommand(),
      scriptExecutionTimeoutMs
    )

    if (!result.success) {
      ElMessage.error(result.error || '部署失败')
      return
    }

    await markUsed()
    ElMessage.success(`脚本已静默部署到 ${formatTargetTerminalName(targetTerminalId)}`)
  } finally {
    executingScript.value = false
  }
}

const runScript = async () => {
  const script = selectedScript.value
  if (!script || !validateTerminalReady() || !validateRequiredVariables() || executingScript.value) return

  const targetTerminalId = await requestTargetTerminal(script.type === 'command' ? 'send-command' : 'run')
  if (!targetTerminalId) return

  if (script.riskLevel === 'high') {
    try {
      await ElMessageBox.confirm(
        `这是高风险${script.type === 'command' ? '命令' : '脚本'}，确认${script.type === 'command' ? '运行' : '同步最新脚本并运行'}吗？`,
        '高风险确认',
        {
          type: 'warning'
        }
      )
    } catch {
      return
    }
  }

  if (script.type === 'command') {
    terminalManager.requestScrollToBottom(targetTerminalId)
    const inst = terminalManager.get(targetTerminalId)
    window.electronAPI.ssh.write(
      targetTerminalId,
      buildTerminalExecutePayload(buildRunCommand(), inst?.bracketedPasteEnabled ?? false)
    )
    await markUsed()
    ElMessage.success(`命令已发送到 ${formatTargetTerminalName(targetTerminalId)}`)
    return
  }

  executingScript.value = true
  try {
    const deployResult = await window.electronAPI.ssh.executeCommand(
      targetTerminalId,
      buildDeployCommand(),
      scriptExecutionTimeoutMs
    )
    if (!deployResult.success) {
      ElMessage.error(deployResult.error || '脚本同步失败')
      return
    }

    const exitCode = await runScriptInInteractiveTerminal(targetTerminalId)
    if (exitCode !== 0) {
      ElMessage.error(`脚本执行失败，退出码 ${exitCode}`)
      return
    }

    await markUsed()
    ElMessage.success(`脚本执行完成：${formatTargetTerminalName(targetTerminalId)}`)
    await maybeUpdateActiveSessionPortAfterSuccessfulRun(script, targetTerminalId)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '脚本运行失败')
  } finally {
    executingScript.value = false
  }
}

const runScriptInInteractiveTerminal = async (targetTerminalId: string): Promise<number> => {
  const instance = terminalManager.get(targetTerminalId)
  if (!instance) throw new Error('目标终端尚未初始化，请打开终端后重试')
  if (!instance.echoEnabled) {
    throw new Error('目标终端正在等待密码或其他隐藏输入，请先完成或取消当前操作')
  }

  const token = createScriptRunToken()
  const command = buildInteractiveScriptCommand(quotedRemoteScriptPath.value, token)
  let outputBuffer = ''
  let settled = false
  let unsubscribe: () => void = () => undefined
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const completion = new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      unsubscribe()
    }

    unsubscribe = terminalManager.subscribeOutput(targetTerminalId, (chunk) => {
      if (settled) return
      outputBuffer = appendScriptOutputBuffer(outputBuffer, chunk)
      const status = findScriptCompletion(outputBuffer, token)
      if (status === null) return
      settled = true
      cleanup()
      resolve(status)
    })

    timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(
        new Error(
          `脚本运行超过 ${Math.round(scriptExecutionTimeoutMs / 60000)} 分钟，可能仍在终端中执行，请检查输出。`
        )
      )
    }, scriptExecutionTimeoutMs)
  })

  appStore.activeTab = targetTerminalId
  appStore.setActiveView('sessions')
  await nextTick()
  terminalManager.requestScrollToBottom(targetTerminalId)
  terminalManager.focus(targetTerminalId)
  window.electronAPI.ssh.write(
    targetTerminalId,
    clearCurrentTerminalLine +
      buildTerminalExecutePayload(command, instance.bracketedPasteEnabled)
  )

  try {
    return await completion
  } finally {
    terminalManager.focus(targetTerminalId)
  }
}

const maybeUpdateActiveSessionPortAfterSuccessfulRun = async (
  script: LazyScript,
  targetTerminalId: string
) => {
  if (!isSshPortUpdateScript(script)) return

  const session = getTerminalTab(targetTerminalId)?.session || null
  if (!session || (session.type && session.type !== 'ssh')) return

  const nextPort = parseSshPortVariable()
  if (!nextPort || session.port === nextPort) return

  try {
    await ElMessageBox.confirm(
      `远程 SSH 端口脚本已执行成功。是否将当前会话「${session.name || session.host}」的连接端口从 ${session.port} 更新为 ${nextPort}？当前已建立的连接不会重连，重新连接时使用新端口。`,
      '同步会话端口',
      {
        type: 'warning',
        confirmButtonText: '更新端口',
        cancelButtonText: '暂不更新'
      }
    )
  } catch {
    return
  }

  try {
    const isSavedSession = appStore.sessions.some((item) => item.id === session.id)
    if (isSavedSession) {
      await appStore.updateSession(session.id, { port: nextPort })
    }

    updateOpenTabsSessionPort(session.id, nextPort)
    ElMessage.success(
      isSavedSession
        ? `当前会话连接端口已更新为 ${nextPort}`
        : `当前终端标签连接端口已更新为 ${nextPort}`
    )
  } catch (error: any) {
    ElMessage.error('更新会话端口失败: ' + error.message)
  }
}

const isSshPortUpdateScript = (script: LazyScript) => {
  const fileName = normalizeScriptFileName(script.fileName)
  const scriptName = script.name.trim()
  return (
    fileName === 'change-ssh-port.sh' ||
    fileName === 'enable-ssh-password-login.sh' ||
    scriptName === '修改 SSH 端口并重启' ||
    scriptName === '开启 SSH 密码登录'
  )
}

const parseSshPortVariable = () => {
  const rawPort =
    numberExecutionValues.ssh_port === undefined || numberExecutionValues.ssh_port === null
      ? executionValues.ssh_port
      : numberExecutionValues.ssh_port
  const port = Number(String(rawPort || '').trim())
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

const updateOpenTabsSessionPort = (sessionId: string, port: number) => {
  appStore.tabs.forEach((tab) => {
    if (tab.session.id === sessionId) {
      tab.session = { ...tab.session, port }
    }
  })
}

const requestTargetTerminal = async (intent: TargetTerminalIntent): Promise<string | null> => {
  if (!validateTerminalReady()) return null

  targetTerminalIntent.value = intent
  selectedTargetTerminalId.value = getDefaultTargetTerminalId()

  if (!selectedTargetTerminalId.value) {
    ElMessage.warning('请先打开一个 SSH 终端')
    return null
  }

  showTargetTerminalDialog.value = true
  return new Promise((resolve) => {
    resolveTargetTerminalSelection = resolve
  })
}

const confirmTargetTerminalSelection = () => {
  if (!selectedTargetTerminalId.value || !selectedTargetTerminal.value) {
    ElMessage.warning('请选择目标终端')
    return
  }
  finishTargetTerminalSelection(selectedTargetTerminalId.value)
}

const cancelTargetTerminalSelection = () => {
  finishTargetTerminalSelection(null)
}

const finishTargetTerminalSelection = (terminalId: string | null) => {
  if (!resolveTargetTerminalSelection) return
  const resolve = resolveTargetTerminalSelection
  resolveTargetTerminalSelection = null
  showTargetTerminalDialog.value = false
  resolve(terminalId)
}

const getDefaultTargetTerminalId = () => {
  const activeTerminal = sshTerminalTabs.value.find((tab) => tab.id === appStore.activeTab)
  return activeTerminal?.id || sshTerminalTabs.value[0]?.id || ''
}

const isSshTerminalTab = (tab: Tab) => !tab.session.type || tab.session.type === 'ssh'

const getTerminalTab = (terminalId: string) =>
  appStore.tabs.find((tab) => tab.id === terminalId && isSshTerminalTab(tab)) || null

const formatTerminalLabel = (tab: Tab) =>
  `${tab.name || `${tab.session.username}@${tab.session.host}`} - ${formatTerminalMeta(tab)}`

const formatTerminalMeta = (tab: Tab) =>
  `${tab.session.username}@${tab.session.host}:${tab.session.port || 22}`

const formatTargetTerminalName = (terminalId: string) => {
  const tab = getTerminalTab(terminalId)
  return tab ? formatTerminalMeta(tab) : '目标终端'
}

const markUsed = async () => {
  if (!selectedScript.value) return
  await window.electronAPI.lazyScript.incrementUsage(selectedScript.value.id)
  selectedScript.value.usageCount += 1
}

const validateTerminalReady = () => {
  if (hasActiveTerminal.value) return true
  ElMessage.warning('请先打开一个 SSH 终端')
  return false
}

const validateRequiredVariables = () => {
  const missing = selectedScript.value?.variables.filter(
    (variable) => variable.required && isEmptyExecutionValue(executionValues[variable.name])
  )

  if (missing?.length) {
    ElMessage.warning(`请填写变量：${missing.map((item) => item.label || item.name).join('、')}`)
    return false
  }

  return true
}

const exportScripts = async () => {
  const filePath = await window.electronAPI.dialog.saveFile({
    title: '导出懒人脚本',
    defaultPath: 'lazy-scripts.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!filePath) return

  const result = await window.electronAPI.lazyScript.export(filePath)
  if (result.success) {
    ElMessage.success(`已导出 ${result.data?.count || 0} 个脚本`)
  } else {
    ElMessage.error(result.error || '导出失败')
  }
}

const importScripts = async () => {
  const filePath = await window.electronAPI.dialog.openFile({
    title: '导入懒人脚本',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!filePath) return

  const result = await window.electronAPI.lazyScript.import(filePath)
  if (result.success) {
    await loadScripts()
    ElMessage.success(`导入 ${result.data?.imported || 0} 个，更新 ${result.data?.updated || 0} 个`)
  } else {
    ElMessage.error(result.error || '导入失败')
  }
}

const riskLabel = (risk: LazyScriptRiskLevel) => {
  const labels = { low: '低风险', medium: '中风险', high: '高风险' }
  return labels[risk]
}

const riskTagType = (risk: LazyScriptRiskLevel) => {
  if (risk === 'low') return 'success'
  if (risk === 'high') return 'danger'
  return 'warning'
}

const typeLabel = (type: LazyScriptType) => {
  const labels = { command: '单条命令', shell: 'Shell 脚本', steps: '操作步骤' }
  return labels[type]
}

const runModeLabel = (mode: LazyScriptRunMode, type: LazyScriptType) => {
  const labels =
    type === 'command'
      ? { copy: '复制命令', paste: '发送到终端', execute: '运行命令' }
      : { copy: '复制运行命令', paste: '部署到终端', execute: '运行脚本' }
  return labels[mode]
}

const buildRunCommand = () => {
  if (selectedScript.value?.type === 'command') {
    return renderedContent.value.trim()
  }
  return buildCheckedRunCommand()
}

const buildDeployCommand = () => {
  const content = ensureTrailingNewline(renderedContent.value)
  const delimiter = buildHeredocDelimiter(content)
  return [
    `mkdir -p ${remoteScriptsDir}`,
    `cat > ${quotedRemoteScriptPath.value} <<'${delimiter}'`,
    content.endsWith('\n') ? content.slice(0, -1) : content,
    delimiter,
    `chmod +x ${quotedRemoteScriptPath.value}`,
    `echo "已部署/更新: ${remoteScriptPath.value}"`
  ].join('\n')
}

const buildCheckedRunCommand = (options: { showSyncMessage?: boolean } = {}) => {
  const content = ensureTrailingNewline(renderedContent.value)
  const delimiter = buildHeredocDelimiter(content)
  return [
    '(',
    '  set -e',
    ...(options.showSyncMessage === false
      ? []
      : [`  echo "正在同步最新脚本: ${remoteScriptPath.value}"`]),
    `  mkdir -p ${remoteScriptsDir}`,
    `  cat > ${quotedRemoteScriptPath.value} <<'${delimiter}'`,
    content.endsWith('\n') ? content.slice(0, -1) : content,
    delimiter,
    `  chmod +x ${quotedRemoteScriptPath.value}`,
    `  bash ${quotedRemoteScriptPath.value}`,
    ')'
  ].join('\n')
}

const ensureTrailingNewline = (value: string) => (value.endsWith('\n') ? value : `${value}\n`)
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const stringifyExecutionValue = (value: ExecutionValue | undefined) =>
  Array.isArray(value) ? value.join(' ') : String(value || '')
const isEmptyExecutionValue = (value: ExecutionValue | undefined) =>
  Array.isArray(value) ? value.length === 0 : !String(value || '').trim()
const parseMultiSelectDefault = (value: string) =>
  String(value || '')
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
const parseVariableOption = (option: string): VariableOptionItem => {
  const raw = String(option || '')
  const parts = raw.split('|').map((item) => item.trim())
  if (parts.length >= 3) {
    return {
      raw,
      value: parts[0],
      group: parts[1],
      label: parts.slice(2).join('|') || parts[0]
    }
  }
  if (parts.length === 2) {
    return { raw, value: parts[0], group: '', label: parts[1] || parts[0] }
  }
  return { raw, value: raw.trim(), group: '', label: raw.trim() }
}
const parsedVariableOptions = (variable: LazyScriptVariable) =>
  (variable.options || []).map(parseVariableOption).filter((option) => option.value)
const groupedVariableOptions = (variable: LazyScriptVariable) => {
  const groups = new Map<string, VariableOptionItem[]>()
  parsedVariableOptions(variable).forEach((option) => {
    const label = option.group || '其他'
    groups.set(label, [...(groups.get(label) || []), option])
  })
  return Array.from(groups.entries()).map(([label, options]) => ({ label, options }))
}
const hasGroupedVariableOptions = (variable: LazyScriptVariable) =>
  parsedVariableOptions(variable).some((option) => option.group)
const getMultiSelectValue = (name: string) => {
  const value = executionValues[name]
  return Array.isArray(value) ? value : parseMultiSelectDefault(String(value || ''))
}
const setMultiSelectValue = (name: string, value: unknown) => {
  executionValues[name] = Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : []
}
const isValidVariableName = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())
const buildHeredocDelimiter = (content: string) => {
  let delimiter = 'MSHELL_SCRIPT'
  let index = 1
  while (new RegExp(`^${delimiter}$`, 'm').test(content)) {
    delimiter = `MSHELL_SCRIPT_${index}`
    index++
  }
  return delimiter
}
const normalizeSshKey = (key: any): SSHKey => ({
  id: String(key.id || ''),
  name: String(key.name || ''),
  type: key.type === 'ed25519' || key.type === 'ecdsa' || key.type === 'rsa' ? key.type : 'rsa',
  bits: Number.isFinite(Number(key.bits)) ? Number(key.bits) : undefined,
  publicKey: String(key.publicKey || ''),
  fingerprint: String(key.fingerprint || ''),
  comment: key.comment ? String(key.comment) : undefined,
  protected: Boolean(key.protected),
  createdAt: key.createdAt ? String(key.createdAt) : undefined
})
const isUsablePublicKey = (value: string) => {
  const publicKey = String(value || '').trim()
  return Boolean(
    publicKey &&
      publicKey !== 'Public key not available' &&
      publicKey !== 'Public key not provided'
  )
}
const normalizeScriptFileName = (value: string) => {
  const baseName =
    String(value || 'script')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'script'
  const safeName = baseName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '-')
  return /\.[a-zA-Z0-9]{1,8}$/.test(safeName) ? safeName : `${safeName}.sh`
}
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const shellQuotePathSegment = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
</script>

<style scoped>
.lazy-script-shell {
  container: lazy-panel / inline-size;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.lazy-script-panel {
  display: grid;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  grid-template-columns: 220px minmax(280px, 360px) minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.script-sidebar,
.script-list,
.script-detail {
  min-height: 0;
  min-width: 0;
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}

.script-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px;
  background: var(--bg-secondary);
}

.sidebar-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.sidebar-top h2,
.detail-header h3,
.variable-editor-head h4 {
  margin: 0;
}

.sidebar-top h2 {
  font-size: 18px;
  font-weight: 700;
}

.sidebar-top p,
.detail-title p,
.section-title small,
.variable-editor-head p,
.script-desc,
.run-hint {
  margin: 0;
  color: var(--text-secondary);
}

.script-search {
  flex: 0 0 auto;
}

.category-list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.category-item,
.script-item {
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.category-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.category-item:hover,
.category-item.active {
  border-color: var(--border-medium);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.category-item strong {
  font-size: 12px;
  color: var(--text-tertiary);
}

.script-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.usage-guide-button {
  grid-column: 1 / -1;
  width: 100%;
}

.script-list {
  background: var(--bg-primary);
}

.script-list :deep(.el-scrollbar__view) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}

.script-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  width: 100%;
  min-height: 82px;
  padding: 12px;
  border-color: var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.script-item:hover,
.script-item.active {
  border-color: var(--primary-color);
  background: var(--bg-hover);
}

.script-item-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.script-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-file-name {
  overflow: hidden;
  width: fit-content;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-desc {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.script-item-meta {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  justify-content: space-between;
  color: var(--text-tertiary);
  font-size: 12px;
}

.script-detail {
  container: lazy-detail / inline-size;
  overflow: auto;
  scrollbar-gutter: stable;
  border-right: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--primary-color) 8%, transparent), transparent 220px),
    var(--bg-primary);
}

.detail-shell {
  display: flex;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
}

.detail-header {
  display: grid;
  align-items: center;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
}

.run-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.detail-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.detail-title-content {
  min-width: 0;
}

.title-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--primary-color);
}

.detail-header h3 {
  overflow: hidden;
  font-size: 22px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-title p {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-actions,
.run-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.detail-actions :deep(.el-button) {
  width: 34px;
  height: 34px;
  margin-left: 0;
}

.detail-actions :deep(.detail-delete-button) {
  --el-button-bg-color: color-mix(in srgb, var(--danger-color) 10%, var(--bg-primary));
  --el-button-border-color: color-mix(in srgb, var(--danger-color) 36%, transparent);
  --el-button-text-color: var(--danger-color);
  --el-button-hover-bg-color: color-mix(in srgb, var(--danger-color) 16%, var(--bg-primary));
  --el-button-hover-border-color: var(--danger-color);
  --el-button-hover-text-color: var(--danger-color);
  --el-button-active-bg-color: color-mix(in srgb, var(--danger-color) 20%, var(--bg-primary));
  --el-button-active-border-color: var(--danger-color);
  --el-button-active-text-color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 36%, transparent);
  background: color-mix(in srgb, var(--danger-color) 10%, var(--bg-primary));
  color: var(--danger-color);
}

.detail-actions :deep(.detail-delete-button:hover),
.detail-actions :deep(.detail-delete-button:focus-visible) {
  border-color: var(--danger-color);
  background: color-mix(in srgb, var(--danger-color) 16%, var(--bg-primary));
  color: var(--danger-color);
}

.run-actions {
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.run-actions :deep(.el-button) {
  margin-left: 0;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.script-file-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.script-file-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
}

.script-file-info span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.script-file-info code {
  overflow: auto;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}

.script-file-info code::-webkit-scrollbar {
  height: 4px;
}

.variables-section,
.preview-section,
.ssh-key-helper-section {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
}

.variables-section,
.ssh-key-helper-section {
  flex: 0 0 auto;
  padding: 14px;
}

.ssh-key-helper-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.ssh-key-select {
  min-width: 220px;
  flex: 1 1 260px;
}

.ssh-key-helper-row :deep(.el-button) {
  margin-left: 0;
}

.ssh-key-option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.ssh-key-option span,
.ssh-key-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ssh-key-option small,
.ssh-key-helper-note {
  color: var(--text-secondary);
}

.ssh-key-helper-note {
  margin: 10px 0 0;
  font-size: 12px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-title-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.section-title > span,
.section-title-main > span {
  font-size: 14px;
  font-weight: 700;
}

.section-title > small,
.section-title-main > small {
  color: var(--text-secondary);
}

.variable-help-button {
  flex: 0 0 auto;
}

.firewall-port-presets {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.firewall-port-presets-head {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.firewall-port-presets-head span {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.firewall-port-presets-head small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.firewall-port-preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.firewall-port-preset {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.firewall-port-preset:hover {
  border-color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 9%, var(--bg-secondary));
  color: var(--text-primary);
}

.firewall-port-preset span {
  flex: 0 0 auto;
  font-weight: 700;
}

.firewall-port-preset code {
  overflow: hidden;
  min-width: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.authorized-key-helper {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.authorized-key-helper-main {
  display: flex;
  min-width: 0;
  flex: 1 1 260px;
  flex-direction: column;
  gap: 3px;
}

.authorized-key-helper-main span {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.authorized-key-helper-main small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.authorized-key-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.authorized-key-dialog p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.authorized-key-dialog code {
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.authorized-key-radio-list {
  display: flex;
  width: 100%;
  min-width: 0;
  max-height: min(56vh, 520px);
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}

.authorized-key-radio {
  width: 100%;
  height: auto;
  min-height: 58px;
  margin: 0;
  padding: 10px 12px;
}

.authorized-key-radio :deep(.el-radio__label) {
  min-width: 0;
  flex: 1;
}

.authorized-key-option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  line-height: 1.35;
}

.authorized-key-option strong,
.authorized-key-option code,
.authorized-key-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.authorized-key-option strong {
  color: var(--text-primary);
  font-size: 13px;
}

.authorized-key-option code {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.authorized-key-option small {
  color: var(--text-secondary);
  font-size: 12px;
}

.variable-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.variable-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.variable-field > span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.variable-field em {
  color: var(--danger-color);
  font-style: normal;
}

.variable-field-wide {
  grid-column: 1 / -1;
}

.variable-check-panel {
  width: 100%;
  max-height: 360px;
  box-sizing: border-box;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
}

.variable-check-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.variable-check-group {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
}

.variable-check-group-title {
  padding-top: 6px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.variable-check-list {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  gap: 8px;
}

.variable-check-panel :deep(.el-checkbox) {
  width: auto;
  max-width: 100%;
  height: auto;
  min-height: 32px;
  flex: 0 0 auto;
  box-sizing: border-box;
  margin-right: 0;
  padding: 6px 10px;
  align-items: center;
  border-color: var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-secondary) 86%, transparent);
}

.variable-check-panel :deep(.el-checkbox:hover),
.variable-check-panel :deep(.el-checkbox.is-checked) {
  border-color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 10%, var(--bg-secondary));
}

.variable-check-panel :deep(.el-checkbox__label) {
  overflow: hidden;
  min-width: 0;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@container lazy-detail (max-width: 620px) {
  .variable-check-group {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .variable-check-group-title {
    padding-top: 0;
  }

  .variable-check-list {
    gap: 6px;
  }
}

.preview-section {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  overflow: visible;
  padding: 14px;
}

.script-preview {
  width: 100%;
  height: clamp(170px, 30vh, 340px);
  flex: 0 0 auto;
  box-sizing: border-box;
  min-height: 150px;
  margin: 0;
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--terminal-bg, #101418);
  color: var(--terminal-foreground, #e7eef7);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.run-bar {
  min-width: 0;
  flex: 0 0 auto;
  padding-top: 2px;
}

@container lazy-detail (max-width: 620px) {
  .ssh-key-helper-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) repeat(3, 36px);
    align-items: center;
    gap: 8px;
  }

  .ssh-key-select {
    width: 100%;
    min-width: 0;
  }

  .ssh-key-helper-row :deep(.el-button) {
    width: 36px;
    min-width: 0;
    padding: 0;
  }

  .ssh-key-action-text {
    display: none;
  }

  .run-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .run-hint {
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-actions {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(4, 36px);
    gap: 8px;
    justify-content: end;
  }

  .run-actions :deep(.el-button) {
    width: 36px;
    min-width: 0;
    padding: 0;
  }

  .run-action-text {
    display: none;
  }

  .script-preview {
    height: clamp(140px, 28vh, 260px);
    min-height: 130px;
  }
}

.script-form {
  max-height: 68vh;
  overflow: auto;
  padding-right: 6px;
}

.form-grid {
  display: grid;
  gap: 14px;
}

.form-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.variable-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 4px 0 12px;
}

.variable-editor-head h4 {
  font-size: 14px;
}

.variable-editor-head p {
  margin-top: 4px;
  font-size: 12px;
}

.variable-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.variable-row {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(100px, 1fr) 110px minmax(100px, 1fr) minmax(120px, 1fr) 70px 36px;
  gap: 8px;
  align-items: center;
}

.variable-row > .el-input:nth-of-type(5) {
  grid-column: auto;
}

.usage-guide {
  display: flex;
  max-height: 68vh;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  padding-right: 6px;
}

.guide-section {
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.guide-section h3 {
  margin: 0 0 10px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.guide-section p,
.guide-section li {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.guide-section ul {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding-left: 18px;
}

.guide-section code {
  padding: 2px 5px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.guide-section pre {
  overflow: auto;
  margin: 10px 0 0;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--terminal-bg, #101418);
  color: var(--terminal-foreground, #e7eef7);
}

.guide-section pre code {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
}

.guide-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.guide-grid > div {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
}

.guide-grid strong {
  display: block;
  margin-bottom: 6px;
  color: var(--text-primary);
  font-size: 13px;
}

.firewall-guide {
  display: flex;
  max-height: 68vh;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  padding-right: 6px;
}

.firewall-guide-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.firewall-guide-grid > div {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
}

.firewall-guide-grid strong {
  display: block;
  margin-bottom: 6px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.target-terminal-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.target-terminal-summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.target-terminal-summary span {
  color: var(--text-secondary);
  font-size: 12px;
}

.target-terminal-summary strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-terminal-select {
  width: 100%;
}

.target-terminal-option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.target-terminal-option span {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-terminal-option small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-terminal-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
}

.target-terminal-card span {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-terminal-card code {
  overflow: hidden;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.target-terminal-hint {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
}

@container lazy-detail (max-width: 520px) {
  .detail-header {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .detail-actions {
    justify-content: flex-start;
  }
}

:global(:root.app-appearance-terminal .lazy-script-panel) {
  grid-template-columns: 190px minmax(240px, 330px) minmax(0, 1fr);
}

:global(:root.app-appearance-terminal .script-sidebar),
:global(:root.app-appearance-terminal .script-item),
:global(:root.app-appearance-terminal .script-file-section .script-file-info),
:global(:root.app-appearance-terminal .ssh-key-helper-section),
:global(:root.app-appearance-terminal .variables-section),
:global(:root.app-appearance-terminal .preview-section),
:global(:root.app-appearance-terminal .title-icon) {
  border-radius: var(--radius-sm);
  box-shadow: none;
}

:global(:root.app-appearance-terminal .script-item) {
  min-height: 72px;
}

:global(:root.app-appearance-terminal .run-actions) {
  gap: 6px;
}

:global(:root.app-appearance-terminal .detail-shell) {
  padding: 16px;
}

:global(:root.app-appearance-terminal .detail-header h3) {
  font-size: 19px;
}

:global(:root.app-appearance-minimal .lazy-script-panel) {
  grid-template-columns: 210px minmax(250px, 340px) minmax(0, 1fr);
  font-family: var(--font-mono);
}

:global(:root.app-appearance-minimal .category-item),
:global(:root.app-appearance-minimal .script-item),
:global(:root.app-appearance-minimal .script-file-section .script-file-info),
:global(:root.app-appearance-minimal .ssh-key-helper-section),
:global(:root.app-appearance-minimal .variables-section),
:global(:root.app-appearance-minimal .preview-section),
:global(:root.app-appearance-minimal .title-icon),
:global(:root.app-appearance-minimal .script-preview) {
  border-radius: 0;
}

@media (max-width: 1100px) {
  .lazy-script-panel {
    grid-template-columns: 180px minmax(250px, 330px) minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .lazy-script-panel {
    grid-template-columns: 1fr;
  }

  .script-list {
    display: block;
    max-height: 36vh;
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .detail-header,
  .run-bar,
  .variable-editor-head {
    align-items: stretch;
    flex-direction: column;
  }

  .detail-header {
    grid-template-columns: 1fr;
  }

  .detail-actions {
    justify-content: flex-start;
  }

  .run-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .script-file-section {
    grid-template-columns: 1fr;
  }

  .ssh-key-helper-row {
    align-items: stretch;
    flex-direction: column;
  }

  .ssh-key-select {
    width: 100%;
    min-width: 0;
  }

  .form-grid.two,
  .form-grid.three,
  .guide-grid,
  .firewall-guide-grid,
  .variable-row {
    grid-template-columns: 1fr;
  }
}

@container lazy-panel (max-width: 980px) {
  .lazy-script-panel {
    grid-template-columns: 170px minmax(240px, 310px) minmax(0, 1fr);
  }

  .script-sidebar {
    display: flex;
    padding: 16px 12px;
  }

  .sidebar-top {
    gap: 8px;
  }

  .sidebar-top h2 {
    font-size: 16px;
  }
}

@container lazy-panel (max-width: 860px) {
  .lazy-script-panel {
    grid-template-columns: 150px minmax(220px, 280px) minmax(0, 1fr);
  }

  .script-sidebar {
    padding: 14px 10px;
  }

  .category-item {
    padding: 0 8px;
  }
}

@container lazy-panel (max-width: 760px) {
  .lazy-script-panel {
    height: 100%;
    grid-auto-rows: auto;
    grid-template-columns: 1fr;
    align-content: start;
    overflow: auto;
  }

  .script-sidebar {
    display: flex;
    min-height: auto;
    padding: 16px 14px;
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
    overflow: visible;
  }

  .category-list {
    flex: 0 0 auto;
    max-height: 240px;
  }

  .script-list {
    display: block;
    max-height: min(360px, 38vh);
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
    overflow: visible;
  }

  .script-detail {
    min-height: 520px;
    overflow: visible;
  }

  .detail-shell {
    min-height: auto;
  }

  .detail-header,
  .run-bar,
  .variable-editor-head {
    align-items: stretch;
    flex-direction: column;
  }

  .detail-header {
    grid-template-columns: 1fr;
  }

  .detail-actions {
    justify-content: flex-start;
  }

  .run-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .script-file-section {
    grid-template-columns: 1fr;
  }

  .ssh-key-helper-row {
    align-items: stretch;
    flex-direction: column;
  }

  .ssh-key-select {
    width: 100%;
    min-width: 0;
  }

  .form-grid.two,
  .form-grid.three,
  .guide-grid,
  .firewall-guide-grid,
  .variable-row {
    grid-template-columns: 1fr;
  }
}

@container lazy-panel (max-width: 420px) {
  .script-sidebar {
    padding: 14px 12px;
  }

  .sidebar-top h2 {
    font-size: 16px;
  }

  .category-list {
    max-height: 220px;
  }

  .script-list :deep(.el-scrollbar__view) {
    padding: 12px;
  }
}
</style>
