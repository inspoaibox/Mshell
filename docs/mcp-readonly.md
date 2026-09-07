# MShell 本机 Agent / MCP 只读接入

MShell 可以向本机运行的 Codex、Claude 等支持 MCP 的 Agent 提供当前 SSH 会话、远程文件和受限查询命令能力。查询命令的结果会直接返回给 Agent，但不允许任意 Shell、文件写入或修改类操作。该功能默认关闭，服务只监听 `127.0.0.1`，不会暴露给局域网或公网。

## 启用方式

1. 在 MShell 的“设置 - Agent 接入”中打开“启用 MCP 服务”。
2. 保持需要读取的 SSH 会话处于已连接状态。
3. 使用页面中的“复制 Codex 配置”或“复制 Claude 配置”按钮，写入对应客户端配置。

Codex 可以使用直接 `Authorization` 标头或 Bearer 令牌环境变量认证。MShell 的“复制 Codex 配置”按钮提供的是 PowerShell 会话变量和 `config.toml` 的环境变量配置；令牌重新生成后，需要更新配置并重启 Agent。

## 在 Codex 图形界面中添加

在 Codex 的“连接至自定义 MCP”页面，选择“流式 HTTP”（Streamable HTTP），不要选择“STDIO”。MShell 已经作为本机 HTTP 服务运行，不需要 Codex 再启动一个命令行进程。

按以下内容填写：

| 字段                | 推荐的直接标头模式                  |
| ------------------- | ----------------------------------- |
| 名称                | `MShell`，也可以使用其他名称        |
| 类型                | `流式 HTTP`                         |
| URL / 服务端点      | `http://127.0.0.1:47821/mcp`        |
| Bearer 令牌环境变量 | 留空                                |
| 标头键              | `Authorization`                     |
| 标头值              | `Bearer <MShell 中复制的 MCP 令牌>` |

标头值必须包含开头的 `Bearer` 和一个空格。只填写令牌本身会被 MShell 按 `401 Unauthorized` 拒绝。例如，填写 `abc123` 是错误的，填写 `Bearer abc123` 才是正确格式。

也可以选择环境变量模式，但不要与直接标头模式混用：

1. 在启动 Codex 的环境中，将 `MSHELL_MCP_TOKEN` 的值设置为 MShell 中复制的令牌。
2. 在 Codex 的“Bearer 令牌环境变量”字段中填写 `MSHELL_MCP_TOKEN`，这里填写的是变量名称，不是令牌内容。
3. 删除 `Authorization` 标头，避免两个认证来源产生冲突。

填写完成后保存，完全退出并重新打开 Codex，再新建任务加载 MCP 工具。

以下内容不适用于 MShell：

- 不要把 `http://127.0.0.1:47821/mcp` 填到“启动命令”或“参数”中。
- 不要填写 `npx`、`node`、`python` 等启动命令。
- 不需要填写 STDIO 参数、工作目录或本地脚本路径。

## 使用 Codex CLI 添加

在启动 Codex 的同一个 PowerShell 窗口中执行：

```powershell
$env:MSHELL_MCP_TOKEN = '<从 MShell 复制的令牌>'
codex mcp add mshell --url http://127.0.0.1:47821/mcp --bearer-token-env-var MSHELL_MCP_TOKEN
codex mcp list
```

检查或移除已有配置：

```powershell
codex mcp get mshell
codex mcp remove mshell
```

也可以手动写入 `~/.codex/config.toml`：

```toml
[mcp_servers.mshell]
url = "http://127.0.0.1:47821/mcp"
bearer_token_env_var = "MSHELL_MCP_TOKEN"
```

PowerShell 环境变量只对当前窗口及其子进程有效。若 Codex 是从开始菜单或其他图形启动器打开的，它可能不会继承该变量；此时应从同一个 PowerShell 窗口启动 Codex，或在 Codex 图形界面中配置请求头。

## STDIO 与流式 HTTP 的区别

| 类型      | 谁启动服务                                     | 典型配置                           | MShell 是否使用 |
| --------- | ---------------------------------------------- | ---------------------------------- | --------------- |
| STDIO     | Codex 启动本地命令并通过标准输入输出通信       | 启动命令、参数、环境变量、工作目录 | 否              |
| 流式 HTTP | MShell 自己运行 HTTP 服务，Codex 通过 URL 访问 | URL、Authorization 请求头          | 是              |

只有在接入另一个明确提供 STDIO 入口的 MCP 服务器时，才填写“启动命令”和“参数”。把 MShell 当作 STDIO 添加会导致连接失败。

## 首次验证流程

配置完成后，按“列出会话、确认连接、读取文件或执行查询”的顺序验证：

1. 确认 MShell MCP 服务为“运行中”，并且至少有一个 SSH 会话状态为“已连接”。
2. 在 Codex 中先发送：

   ```text
   请调用 list_ssh_sessions，列出当前已连接的 SSH 会话。
   不要执行命令，不要修改文件。
   只返回 connectionId、主机、端口、用户名和会话名称。
   ```

3. 从返回结果中确认目标服务器，并明确指定一个 `connectionId`。不要让 Agent 根据主机名、用户名或列表顺序自行猜测。
4. 再发送：

   ```text
   使用 connectionId="这里填写已确认的 ID"。
   不要执行命令，不要修改文件。
   请读取 /etc/os-release，只告诉我文件是否存在，不要输出文件内容。
   ```

5. 读取目录时使用 `list_remote_files`；读取文本时使用 `read_remote_file`。当前没有单独的文件存在性工具，判断文件是否存在会通过读取结果完成。

## 执行查询命令

确认 `connectionId` 后，可以让 Agent 调用 `execute_readonly_command` 执行一条查询命令，并读取返回结果。例如：

```text
使用 connectionId="这里填写已确认的 ID"。
调用 execute_readonly_command 执行 df -h，并根据返回的 output 总结磁盘使用情况。
不要修改文件，不要执行其他命令。
```

工具返回：

- `command`：实际执行的查询命令。
- `output`：命令标准输出，Agent 可以直接读取和分析。
- `outputBytes`：完整输出的 UTF-8 字节数。
- `truncated`：输出是否因超过上限而被截断。

查询命令规则：

- 每次只能执行一条命令，最长 `2000` 个字符。
- 默认超时 `10` 秒，调用方最多可设置为 `20` 秒。
- 返回给 Agent 的输出最多 `64 KiB`；底层捕获超过 `256 KiB` 时会终止查询并返回错误。
- 支持 `ls`、`df`、`du`、`free`、`ps`、`ss`、`ip`、`systemctl status`、`journalctl`、`docker ps` 等白名单查询。
- 不支持管道、重定向、`;`、`&&`、命令替换、脚本解释器、`sudo` 或不在白名单中的程序。
- `systemctl restart`、`docker stop`、`iptables -F`、`find -delete` 等修改操作会被拒绝。

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
| `execute_readonly_command`  | 执行单条白名单查询命令并返回命令和输出。  |

## 约束与安全边界

- Agent 只能使用 MShell 当前已连接的 SSH 会话；断开或重连期间的会话不会被列出或读取。
- 只提供白名单查询命令，不提供任意 Shell、终端输入、文件上传、文件修改、删除或权限修改。
- 不返回密码、私钥、代理凭据或 Electron IPC 接口。
- 单次目录列表最多返回 `2000` 项；单个远程文件最多读取 `1 MiB`。
- 每次 Agent 工具调用都会写入 MShell 的审计日志。
- SSH 自动重连后，MShell 会按当前 SSH 客户端重建只读 SFTP 通道，避免使用旧连接遗留的通道。
- MCP 服务当前运行在 MShell Windows 桌面端；Android 端不能作为 MCP HTTP 服务端。
- MCP 端点只监听本机 `127.0.0.1`。不要通过端口转发、反向代理、内网穿透或防火墙把 `47821` 暴露给其他设备。
- MCP 令牌不是 SSH 密码，也不是同步加密密码；三者必须分别保管。
- 读取配置文件、日志和代码仍可能暴露业务数据。只允许 Agent 读取完成当前任务所需的最小路径。
- 查询命令的输出也可能包含进程参数、环境、日志、IP、容器配置或其他敏感信息，使用前必须确认查询范围。

该能力适合让 Agent 做状态检查、阅读配置或分析日志。需要改变服务器状态的操作仍应由用户在 MShell 终端中明确执行。
