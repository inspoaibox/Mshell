# MShell Docs

这是 MShell 的静态 GitHub Pages 介绍页面，用于展示当前产品定位、核心功能、客户端形态、截图、下载入口和快速开始说明。

当前页面对应产品版本：`v0.2.11`

## 文件结构

- `index.html`：主介绍页，包含首屏、核心功能、懒人脚本、同步安全、客户端、截图、下载和快速开始。
- `styles.css`：页面视觉、布局、响应式和截图预览样式。
- `script.js`：导航菜单、平滑滚动、终端演示、截图放大和外链安全处理。
- `logo.png` / `favicon.png`：品牌图标。
- `upgrade-v0.2.11.md`：本次升级说明与功能修复摘要。
- `mcp-readonly.md`：本机 Agent / MCP 只读接入说明与安全边界。
- `security-manual.md`：完整安全产品使用说明书，包含 MCP 接入、凭据、备份、同步、日志和事件响应。
- `screenshots/`：当前页面实际引用的产品截图。
- `mshell截图/`：中文命名的原始截图备份。
- `releases/`：可选的离线发布包目录。

## 页面介绍重点

### 产品定位

MShell 是面向开发者、站长和运维人员的 SSH 服务器管理工作台，不只是一个终端窗口。页面文案需要强调：

- SSH 会话、终端、SFTP、命令片段、懒人脚本、SSH 密钥、同步备份整合到一个工作流。
- Windows 桌面端负责完整管理和重度操作。
- Android 移动端负责外出、临时连接和应急维护。
- 数据通过加密备份、GitHub Gist 或 GitLab Snippet 进行迁移和同步。

### Windows 桌面端

桌面端重点展示：

- SSH / RDP / VNC 会话管理。
- 多标签终端、垂直分屏、四宫格分屏。
- SFTP 上传、下载、队列、同名处理、权限设置、在线预览和编辑。
- 命令片段、快捷命令、命令历史、智能补全和命令智能开关。
- 懒人脚本，包括环境初始化、SSH 加固、防火墙端口、常用工具安装、用户管理、磁盘排查等。
- SSH 密钥管理、脚本联动、公钥部署、密码登录开启和关闭。
- 多套外观风格、终端背景图、透明度设置。
- 会话锁、审计日志、系统日志、备份恢复和远程同步。
- 本机 Agent / MCP 只读接入：仅允许读取当前已连接的 SSH 会话、目录和有限大小的文本文件。
- 完整安全使用说明：见 `security-manual.md`，以当前代码实现和限制为准。

### Android 客户端

Android 端重点展示：

- SSH 会话新增、编辑、删除和分类。
- 移动端终端连接和应急命令执行。
- 命令片段分类、复制和在当前终端中执行。
- SSH 密钥新增、编辑和本地文件导入。
- 桌面端备份 JSON、`.mshell` 加密备份和同步数据导入。
- GitHub Gist / GitLab Snippet 远程同步配置。
- PIN 和系统生物识别安全锁。

## 本地预览

可以直接用浏览器打开：

```text
docs/index.html
```

也可以启动一个静态服务器：

```bash
cd docs
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000
```

## 更新版本与下载

版本号需要同步修改：

- `package.json` 中的 `version`。
- `docs/index.html` 中的 hero 版本。
- `docs/index.html` 中 Windows 下载卡片版本。
- `docs/index.html` 中 Android 下载卡片版本。
- `docs/index.html` footer 版本。
- `docs/README.md` 当前页面对应版本。
- `docs/upgrade-v0.2.11.md` 中的升级标题和版本说明。

当前下载入口：

```text
https://github.com/inspoaibox/Mshell/releases
```

发布新版本后需要确认 GitHub Releases 中存在对应 Windows 安装包和 Android APK。

## 更新截图

截图目录：

```text
docs/screenshots/
```

当前页面使用：

- `main.png`
- `terminal.png`
- `sftp.png`
- `snippets.png`
- `autocomplete.png`
- `monitor.png`
- `split-vertical.png`
- `split-quad.png`

建议截图保持 16:9 或接近桌面端真实窗口比例。替换截图时尽量保持文件名不变，这样无需修改 HTML。

## 文案维护原则

- 只写当前客户端已经支持或即将随当前版本发布的能力。
- 桌面端和 Android 端能力要区分清楚，避免让用户误以为两端完全一致。
- 同步和备份必须强调加密密码需要妥善保存，密码丢失无法解密备份数据。
- Android 远程同步说明应同时提到 URL、Token 和同步加密密码。
- 涉及安全能力时，优先说明会话锁、PIN、生物识别、Token 最小权限和加密备份。
- 懒人脚本涉及 SSH 端口、密码登录、防火墙和密钥登录时，需要强调运行前确认目标终端和操作风险。
- 使用许可文案保持一致：支持个人与企业内部使用；商业售卖、SaaS 化分发或二次商业发行需先获得授权。

## 部署

该目录是纯静态页面，可以部署到任意静态站点服务：

- GitHub Pages
- Netlify
- Vercel
- Nginx / Apache / IIS
- 对象存储静态站点

如果部署到子路径，当前页面使用相对路径引用 CSS、JS、图片，通常无需额外配置。

## 维护检查清单

- [ ] 更新版本号。
- [ ] 检查 Windows 安装包下载入口。
- [ ] 检查 Android APK 发布入口。
- [ ] 检查页面截图是否与当前 UI 一致。
- [ ] 检查功能介绍是否与当前客户端一致。
- [ ] 检查同步、备份、安全说明是否准确。
- [ ] 在桌面和手机浏览器中预览页面。
- [ ] 运行 `rg "旧版本号|上一版本号" docs` 或按实际旧版本号搜索，确认没有版本残留。
