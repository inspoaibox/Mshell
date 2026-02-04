# RDP/VNC 支持 - 技术设计文档

## 概述

MShell 远程桌面支持：
- **RDP**: 通过调用系统 mstsc.exe 实现（外部窗口）
- **VNC**: 通过 noVNC + WebSocket 代理实现（内嵌标签页）

## 架构

### RDP 架构
```
┌─────────────────────────────────────────────────────────────┐
│  MShell (Electron)                                          │
│  ├── SessionForm.vue (RDP 配置)                             │
│  ├── SessionList.vue (点击启动 RDP)                         │
│  └── RDPManager.ts (生成 .rdp 文件，调用 mstsc)             │
└─────────────────────────────────────────────────────────────┘
         ↓ spawn
┌─────────────────────────────────────────────────────────────┐
│  mstsc.exe (独立窗口)                                        │
└─────────────────────────────────────────────────────────────┘
```

### VNC 架构
```
┌─────────────────────────────────────────────────────────────┐
│  MShell 标签页                                               │
│  ├── VNCTab.vue (noVNC 渲染)                                │
│  └── noVNC Canvas                                           │
└─────────────────────────────────────────────────────────────┘
         ↓ WebSocket (ws://127.0.0.1:随机端口)
┌─────────────────────────────────────────────────────────────┐
│  VNCManager.ts (WebSocket → TCP 代理)                       │
│  本地监听 → 转发到远程 VNC 服务器                            │
└─────────────────────────────────────────────────────────────┘
         ↓ TCP
┌─────────────────────────────────────────────────────────────┐
│  远程 VNC 服务器 (端口 5900)                                 │
└─────────────────────────────────────────────────────────────┘
```

## 数据模型

```typescript
type SessionType = 'ssh' | 'rdp' | 'vnc'

interface RDPOptions {
  width?: number
  height?: number
  fullscreen?: boolean
  multimon?: boolean
  admin?: boolean
  drives?: boolean
  printers?: boolean
  clipboard?: boolean
  audio?: 'local' | 'remote' | 'none'
}

interface VNCOptions {
  viewOnly?: boolean
  quality?: number        // 0-9
  compression?: number    // 0-9
  localCursor?: boolean
  sharedConnection?: boolean
}
```

## 文件清单

| 文件 | 说明 |
|------|------|
| `src/types/session.ts` | SessionType, RDPOptions, VNCOptions |
| `electron/managers/RDPManager.ts` | RDP 连接管理，生成 .rdp 文件 |
| `electron/managers/VNCManager.ts` | VNC WebSocket 代理 |
| `electron/ipc/rdp-handlers.ts` | RDP IPC 处理 |
| `electron/ipc/vnc-handlers.ts` | VNC IPC 处理 |
| `electron/preload.ts` | rdp/vnc API |
| `src/components/VNC/VNCTab.vue` | VNC 标签页组件 |
| `src/components/Session/SessionForm.vue` | 支持 SSH/RDP/VNC |
| `src/components/Session/SessionList.vue` | 显示类型标签 |
| `src/App.vue` | 根据类型渲染不同组件 |

## VNC 功能

- 内嵌标签页显示（和 SSH 终端一样）
- 自动缩放适应窗口
- 全屏模式
- 剪贴板同步
- 发送 Ctrl+Alt+Del
- 图像质量/压缩级别调节
- 只读模式
- 共享连接

## 安全考虑

1. WebSocket 代理只监听 127.0.0.1
2. 每个连接使用随机端口
3. 连接断开后自动清理代理
