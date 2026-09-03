# MShell 本机 Agent / MCP 只读接入

MShell 可以向本机运行的 Codex、Claude 等支持 MCP 的 Agent 提供当前 SSH 会话的只读信息。该功能默认关闭，服务只监听 `127.0.0.1`，不会暴露给局域网或公网。

## 启用方式

1. 在 MShell 的“设置 - Agent 接入”中打开“启用 MCP 服务”。
2. 保持需要读取的 SSH 会话处于已连接状态。
3. 使用页面中的“复制 Codex 配置”或“复制 Claude 配置”按钮，写入对应客户端配置。

Codex 使用环境变量传递 Bearer 令牌。复制的内容包含 PowerShell 会话变量和 `config.toml` 配置：先在启动 Codex 的同一 PowerShell 窗口设置 `MSHELL_MCP_TOKEN`，再启动 Codex。令牌重新生成后，需要更新环境变量并重启 Agent。

## 服务端点

- 默认端点：`http://127.0.0.1:47821/mcp`
- 认证方式：`Authorization: Bearer <MCP 令牌>`
- 令牌：由 MShell 生成，可在“设置 - Agent 接入”中复制或重新生成。

## 可用工具

| 工具                        | 作用                                      |
| --------------------------- | ----------------------------------------- |
| `list_ssh_sessions`         | 仅列出当前确实处于已连接状态的 SSH 会话。 |
| `get_ssh_connection_status` | 读取一个已连接 SSH 会话的安全状态信息。   |
| `list_remote_files`         | 通过该会话的 SFTP 列出一个远程目录。      |
| `read_remote_file`          | 通过 SFTP 读取一个 UTF-8 文本文件。       |

## 约束与安全边界

- Agent 只能使用 MShell 当前已连接的 SSH 会话；断开或重连期间的会话不会被列出或读取。
- 不提供 SSH 命令执行、终端输入、文件上传、文件修改、删除或权限修改。
- 不返回密码、私钥、代理凭据或 Electron IPC 接口。
- 单次目录列表最多返回 `2000` 项；单个远程文件最多读取 `1 MiB`。
- 每次 Agent 工具调用都会写入 MShell 的审计日志。
- SSH 自动重连后，MShell 会按当前 SSH 客户端重建只读 SFTP 通道，避免使用旧连接遗留的通道。

该能力适合让 Agent 做状态检查、阅读配置或分析日志。需要改变服务器状态的操作仍应由用户在 MShell 终端中明确执行。
