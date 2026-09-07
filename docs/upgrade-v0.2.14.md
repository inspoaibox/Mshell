# MShell v0.2.14 升级说明

本次版本在现有 MCP 会话读取、文件读取和受限查询基础上，增加逐次显式授权的远程文本写入与修改命令执行能力。

## 新增工具

### write_remote_file

- 通过 SFTP 创建或完整覆盖一个 UTF-8 文本文件。
- 每次调用最多写入 1 MiB。
- 必须在本次工具调用中传入 `allowWrite=true`。
- 返回目标路径、写入字节数和完成状态。

### execute_command

- 执行可能修改服务器状态的 SSH 命令。
- 必须在本次工具调用中传入 `allowWrite=true`。
- 返回实际命令、标准输出、完整输出字节数和截断状态，供 Agent 读取。
- 命令最长 8000 个字符，默认超时 20 秒，最大 120 秒。

## 授权边界

- 缺少 `allowWrite` 或传入 `false` 时，MShell 会拒绝写入并记录失败审计。
- `allowWrite=true` 只作用于当前一次调用，不会永久开启写入权限。
- 该参数用于防止默认误调用，不是第二个密码或人工审批机制。
- 任何持有 MCP Token 的客户端都可能提交该参数，因此必须继续严格保护和及时轮换 MCP Token。
- 修改命令不会经过查询白名单，可以执行删除、覆盖、安装、服务重启和防火墙调整等高风险操作。

## 使用示例

```text
使用我确认的 connectionId。
调用 execute_command 执行 systemctl restart nginx，allowWrite=true。
返回命令输出，不要执行其他操作。
```

```text
先读取 /etc/example.conf 并展示修改前后的差异。
等待我确认后，调用 write_remote_file 写入完整新内容，allowWrite=true。
```

## 版本信息

- 版本号：`v0.2.14`
- 对应页面：`docs/index.html`
