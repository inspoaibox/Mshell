# MShell - 专业的 SSH 客户端

MShell 是一款现代化、功能丰富的 SSH 客户端，基于 Electron、Vue 3 和 TypeScript 构建。

## 支持客户端

支持客户端： Windows + Android

## ✨ 核心特性

### 🔐 SSH 连接管理
- ✅ 支持密码和私钥认证（RSA、ED25519、ECDSA）
- ✅ 会话分组管理，支持拖拽排序
- ✅ 快速连接功能
- ✅ 会话导入/导出
- ✅ 连接保活和自动重连
- ✅ 多连接并发支持
- ✅ 使用 Windows DPAPI 加密存储凭据

### 💻 终端功能
- ✅ 基于 xterm.js 的全功能终端
- ✅ WebGL 渲染，自动降级到 Canvas/DOM
- ✅ 20+ 内置主题（Dark、Light、Solarized、Monokai、Dracula、Nord、OneDark 等）
- ✅ 可自定义字体、大小、光标样式、渲染类型
- ✅ 复制/粘贴支持（Ctrl+Shift+C/V）
- ✅ 右键菜单快捷操作
- ✅ 全选功能（Ctrl+Shift+A）
- ✅ 自动调整大小和滚动缓冲区
- ✅ 完整的 ANSI 颜色代码支持
- ✅ 分屏模式（水平/垂直分屏）
- ✅ 标签页和分屏模式切换

### 📁 SFTP 文件传输
- ✅ 双面板文件浏览器（本地 + 远程）
- ✅ 文件拖拽上传
- ✅ 批量上传/下载，支持进度跟踪
- ✅ 文件操作（创建、删除、重命名、修改权限）
- ✅ 传输队列管理（暂停、恢复、取消）
- ✅ 未完成传输恢复
- ✅ 传输历史记录
- ✅ 单击选择，双击打开文件夹
- ✅ 右键菜单支持

### 🔧 高级功能
- ✅ **端口转发**: 本地转发、远程转发、动态转发（SOCKS5）
- ✅ **端口转发模板**: 保存常用转发配置
- ✅ **命令片段**: 保存常用命令，支持变量替换
- ✅ **命令历史**: 记录所有执行的命令，支持搜索和收藏
- ✅ **服务器监控**: 实时监控 CPU、内存、磁盘、网络使用情况
- ✅ **任务调度**: 定时执行命令任务
- ✅ **工作流**: 创建多步骤自动化工作流
- ✅ **SSH 密钥管理**: 生成、导入、导出 SSH 密钥
- ✅ **审计日志**: 记录所有操作，支持筛选和导出

### 📊 统计分析
- ✅ 会话使用统计
- ✅ 连接时长统计
- ✅ 流量统计
- ✅ 命令使用频率统计
- ✅ 服务商费用分析
- ✅ 地区分布统计
- ✅ 可自定义显示组件

### 🔒 安全功能
- ✅ **会话锁定**: 密码保护，自动锁定
- ✅ **已知主机验证**: SSH 主机密钥验证
- ✅ **凭据加密**: 使用 Windows DPAPI 加密存储
- ✅ **审计日志**: 完整的操作记录

安全产品使用说明书：[`docs/security-manual.md`](docs/security-manual.md)，包含凭据保护、主机指纹、会话锁、备份同步、日志、MCP 只读接入和事件响应流程。

### 💾 数据管理
- ✅ **备份与恢复**: 加密备份会话、片段和设置
- ✅ **自动备份**: 定时自动备份
- ✅ **崩溃恢复**: 自动恢复会话状态
- ✅ **选择性恢复**: 可选择恢复特定数据

### 🎨 用户界面
- ✅ 现代化深色/浅色主题
- ✅ 多标签页终端管理
- ✅ 侧边栏导航
- ✅ 状态栏显示连接信息
- ✅ 响应式布局
- ✅ 完整的键盘快捷键支持
- ✅ 右键上下文菜单
- ✅ 拖拽排序（会话、标签页）
- ✅ 中英文双语支持

### ⚙️ 系统设置
- ✅ 启动时打开
- ✅ 最小化到托盘
- ✅ 关闭时最小化
- ✅ 主题切换（自动/深色/浅色）
- ✅ 语言切换
- ✅ 终端设置（字体、大小、光标、渲染类型）
- ✅ SSH 设置（超时、保活）
- ✅ SFTP 设置（并发数、隐藏文件）
- ✅ 安全设置（密码保存、主机验证）
- ✅ 快捷键自定义

## ⌨️ 键盘快捷键

**会话管理**
- `Ctrl+N` - 新建会话
- `Ctrl+T` - 快速连接
- `Ctrl+F` - 搜索会话

**标签页管理**
- `Ctrl+W` - 关闭当前标签
- `Ctrl+Tab` - 下一个标签
- `Ctrl+Shift+Tab` - 上一个标签
- `Ctrl+1~9` - 切换到指定标签

**终端操作**
- `Ctrl+Shift+C` - 复制
- `Ctrl+Shift+V` - 粘贴
- `Ctrl+Shift+A` - 全选

**其他**
- `Ctrl+,` - 打开设置
- `Ctrl+Alt+L` - 锁定会话

## 🛠️ 技术栈

- **前端框架**: Vue 3 + TypeScript + Vite
- **UI 组件**: Element Plus
- **桌面框架**: Electron
- **移动端框架**: Capacitor Android
- **SSH 库**: ssh2
- **Android SSH 桥**: JSch + Capacitor Plugin
- **终端**: xterm.js + addons
- **状态管理**: Pinia
- **国际化**: vue-i18n
- **构建工具**: Vite + electron-builder

## 📂 项目结构

```
mshell/
├── electron/                    # Electron 主进程
│   ├── main.ts                 # 主入口
│   ├── preload.ts              # 预加载脚本
│   ├── managers/               # 核心管理器
│   │   ├── SessionManager.ts           # 会话管理
│   │   ├── SSHConnectionManager.ts     # SSH 连接管理
│   │   ├── SFTPManager.ts              # SFTP 管理
│   │   ├── PortForwardManager.ts       # 端口转发管理
│   │   ├── SnippetManager.ts           # 命令片段管理
│   │   ├── CommandHistoryManager.ts    # 命令历史管理
│   │   ├── ConnectionStatsManager.ts   # 连接统计管理
│   │   ├── SessionTemplateManager.ts   # 会话模板管理
│   │   ├── BackupManager.ts            # 备份管理
│   │   ├── ServerMonitorManager.ts     # 服务器监控管理
│   │   ├── SSHKeyManager.ts            # SSH 密钥管理
│   │   ├── AuditLogManager.ts          # 审计日志管理
│   │   ├── SessionLockManager.ts       # 会话锁定管理
│   │   ├── TaskSchedulerManager.ts     # 任务调度管理
│   │   └── WorkflowManager.ts          # 工作流管理
│   ├── ipc/                    # IPC 处理器
│   │   ├── ssh-handlers.ts
│   │   ├── sftp-handlers.ts
│   │   ├── session-handlers.ts
│   │   └── ...
│   └── utils/                  # 工具类
│       ├── app-settings.ts
│       ├── crash-recovery.ts
│       ├── known-hosts.ts
│       └── logger.ts
├── src/                        # Vue 应用
│   ├── App.vue                 # 根组件
│   ├── components/             # Vue 组件
│   │   ├── Terminal/           # 终端组件
│   │   ├── Session/            # 会话管理组件
│   │   ├── SFTP/               # SFTP 组件
│   │   ├── PortForward/        # 端口转发组件
│   │   ├── Snippet/            # 命令片段组件
│   │   ├── Statistics/         # 统计分析组件
│   │   ├── Keys/               # SSH 密钥组件
│   │   ├── Audit/              # 审计日志组件
│   │   └── Common/             # 通用组件
│   ├── stores/                 # Pinia 状态管理
│   ├── types/                  # TypeScript 类型定义
│   ├── utils/                  # 工具函数
│   │   ├── terminal-manager.ts
│   │   ├── terminal-themes.ts
│   │   └── keyboard-shortcuts.ts
│   └── i18n/                   # 国际化
│       └── locales/
│           ├── zh-CN.ts
│           └── en-US.ts
├── src/mobile/                  # Android 移动端 Web 入口
│   ├── MobileApp.vue            # 移动端根组件
│   ├── components/              # 移动端设置、导入导出、安全锁组件
│   ├── services/                # 移动端数据、同步、安全和 Android SSH 桥接
│   └── README.md                # 移动端开发与打包说明
├── android/                     # Capacitor Android 原生工程
│   └── app/src/main/java/com/mshell/mobile/
│       ├── AndroidSshBridge.java
│       ├── SecurityBridge.java
│       └── MainActivity.java
└── release/                    # 构建输出
```

## 🚀 开发指南

### 环境要求

- Node.js 18+
- npm 或 yarn

Android 移动端还需要：

- Android Studio
- Android SDK / Build Tools
- JDK 21.x（当前 Android 工程使用 Java 21 编译选项）

当前 Android 工程版本基线：

| 项目 | 要求 |
| --- | --- |
| Node.js | 18+ |
| Capacitor | 8.x |
| Gradle Wrapper | 8.14.3 |
| Android Gradle Plugin | 8.13.0 |
| Android SDK | compileSdk 36 / targetSdk 36 / minSdk 24 |
| Java/JDK | 21.x，推荐使用 Android Studio 自带 JBR 21 |

如果出现 `无效的源发行版：21`，说明当前命令行正在使用 JDK 17 或更低版本。PowerShell 可临时切换到 Android Studio 自带 JDK 21：

```powershell
$env:JAVA_HOME='D:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
java -version
javac -version
```

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

移动端 Web 调试：

```bash
npm run mobile:dev
```

### 构建应用

```bash
npm run build
```

移动端 Web 资源构建：

```bash
npm run mobile:build
```

同步到 Android 原生工程：

```bash
npm run android:sync
```

打开 Android Studio：

```bash
npm run android:open
```

### 测试

```bash
npm test
```

## 📦 打包发布

桌面端使用 electron-builder 打包为 Windows 安装程序（NSIS）。

```bash
npm run build
```

生成的安装包位于 `release/` 目录。

Android 端打包流程：

```bash
npm run android:build
```

该命令会依次执行移动端类型检查、同步 Android 工程、生成调试 APK。调试 APK 通常输出到 `android/app/build/outputs/apk/debug/`。

也可以按目标包类型执行：

```bash
npm run android:build:debug
npm run android:build:release
npm run android:build:bundle
```

发布包需要配置正式签名文件，签名文件不应提交到仓库。需要打开 Android Studio 时执行：

```bash
npm run android:open
```

## 🔐 安全性

- ✅ 使用 Electron safeStorage（Windows DPAPI）加密凭据
- ✅ 内存和日志中不存储明文密码
- ✅ SSH 主机密钥验证
- ✅ 进程间安全 IPC 通信
- ✅ 会话锁定保护
- ✅ 完整的审计日志

## 📝 更新日志

### v0.1.4 (最新)
- ✅ 修复终端字符重复问题
- ✅ 修复分屏数据丢失问题
- ✅ 优化会话列表布局
- ✅ 修复拖拽排序功能
- ✅ 实现托盘最小化功能
- ✅ 实现密码保护启动锁定
- ✅ 完善设置面板功能
- ✅ 修复 SSH 设置未应用问题
- ✅ 实现启动时打开功能
- ✅ 优化命令片段展开/收缩
- ✅ 添加统计分析显示设置
- ✅ 修复 SFTP 右键菜单
- ✅ 改进 SFTP 文件操作（单击选择，双击打开）

### v0.1.3
- ✅ 添加统计分析功能
- ✅ 添加时间范围筛选
- ✅ 修复主题初始化闪烁

### v0.1.2
- ✅ 完善多语言支持
- ✅ 添加拖拽功能
- ✅ 安全性增强

### v0.1.1
- ✅ 初始版本发布

## 📄 许可证

本项目采用自定义非商用许可，详见 [LICENSE](./LICENSE)。

- 允许个人使用、学习、研究和修改。
- 允许企业或组织内部评估、部署和自用。
- 禁止未经授权的商业化销售、转售、收费托管、SaaS 服务、商业集成分发或其他以本项目为基础的营利性使用。

如需商业授权，请联系项目维护者。

## 👥 作者

MShell Team

## 🔗 链接

- GitHub: https://github.com/inspoaibox/Mshell
- Issues: https://github.com/inspoaibox/Mshell/issues

---

**注意**: 本项目仍在积极开发中，部分功能可能还不够完善。欢迎提交 Issue 和 Pull Request！
