# MShell 本机 Agent / MCP 安全接入

MShell 可以向本机运行的 Codex、Claude 等支持 MCP 的 Agent 提供当前 SSH 会话、远程文件和命令能力。读取和查询默认可用；写文件或执行修改命令由“设置 - Agent 接入 - 允许写入与修改”独立控制。该开关默认关闭，服务只监听 `127.0.0.1`，不会暴露给局域网或公网。

## 启用方式

1. 在 MShell 的“设置 - Agent 接入”中打开“启用 MCP 服务”。
2. 保持需要读取的 SSH 会话处于已连接状态。
3. 使用页面中的“复制 Codex 配置”或“复制 Claude 配置”按钮，写入对应客户端配置。
4. 配置字段、工具清单、写入规则和故障处理可直接点击该页面右上角的“使用详情”查看。

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

## 数据库查询

`query_database` 不需要开启“允许写入与修改”。它通过已连接的 SSH 会话查询数据库，可读取账号有权限访问的业务表、日志表、系统目录和表结构，不维护业务表白名单。

当用户没有明确给出数据库类型、容器或主机、数据库名和数据库用户时，Agent 必须先调用 `discover_database_targets`。该工具只读取数据库客户端、容器名称和镜像、应用容器、发布端口、非秘密数据库用户名，以及能够安全枚举的数据库名称；不会返回密码或完整容器环境变量。

发现结果包含 `targets`、`applications` 和 `requiresSelection`。同一服务器存在多个数据库、站点或应用时，Agent 必须把候选项交给用户确认业务目标，再把选中目标的 `engine`、`container`、`database` 和 `username` 原样用于 `query_database`。不能根据活动连接、名称相似、列表顺序、默认数据库或端口自行判断目标。发现工具只能提供候选关系，不能证明某个网站必然使用某个数据库。

支持 `engine=mysql`、`mariadb`、`postgresql`、`sqlite`，以及通过可选的 `container` 参数在 Docker 容器内运行客户端。其他数据库引擎尚未接入，不能用此工具执行任意数据库 Shell。

前提：

- 远程 Linux 主机或目标容器内安装对应的 `mysql`、`mariadb`、`psql` 或 `sqlite3` 客户端，以及 GNU `timeout`。容器模式在容器内部执行超时控制。
- MySQL 需要 5.7.8+，MariaDB 需要 10.1+，psql 需要支持 `--csv`，SQLite CLI 需要支持 `-safe` 和 `-readonly`。复杂 SQL 还需要相应数据库版本支持。
- 使用数据库只读账号，在远程提前配置 `.my.cnf`、`.pgpass` 或 peer/socket 认证。容器模式的认证配置也必须在容器中可用；不要把密码放进工具参数、SQL 或连接 URL。
- PostgreSQL 容器的 `username` 和 `database` 必须与容器初始化时的账号和数据库一致，不要默认使用 `postgres/postgres`。容器内通过本地 socket 已能认证时不需要 `.pgpass`；从宿主机通过 TCP 连接且服务端要求密码时才需要非交互凭据。
- 服务端只读事务、SQL 校验不能代替数据库最小权限配置。自定义类型、视图、外部表和函数扩展的行为由数据库服务器控制，不应使用超级用户作为查询账号。

参数：

| 参数 | 含义 |
| --- | --- |
| `connectionId` | 已确认的 SSH 会话 ID |
| `engine` | `mysql`、`mariadb`、`postgresql`、`sqlite` |
| `database` | 数据库名称；SQLite 使用远程绝对文件路径，不接受 URI |
| `query` | 单条 SQL，最多 20000 个字符 |
| `host`、`port`、`username` | 可选连接参数，SQLite 不使用这些参数 |
| `container` | 可选 Docker 容器名或 ID |
| `maxRows` | SELECT 返回行数上限，默认 200，最大 2000 |
| `timeoutMs` | 默认 20000，最大 120000 毫秒 |

示例：

```text
1. 调用 discover_database_targets(connectionId)。
2. 列出候选的应用容器和业务数据库，让用户确认要查询的网站或程序。
3. 使用用户确认目标返回的准确参数调用 query_database。
4. 查询使用稳定的 ORDER BY 和 LIMIT/OFFSET，不读取无关数据库。
```

支持单条 `SELECT`、查询型 `WITH`、关联、聚合、子查询及常用只读函数。MySQL/MariaDB 还支持可解析的 `SHOW TABLES`、`SHOW COLUMNS`、`SHOW CREATE TABLE`、`DESCRIBE`。也可查询 `information_schema`、PostgreSQL 系统目录和 `sqlite_master` 了解表结构。SQL 方言仍受解析器支持范围限制。

查询入口始终拒绝多条 SQL、修改语句、写锁、`SELECT INTO`、文件输出、客户端转义命令及未确认为只读的函数。即使写入开关已打开，`query_database` 仍是只读；需要修改时使用受开关控制的 `execute_command`。

返回 `output`、`format`（MySQL/MariaDB 为 TSV，其他为 CSV）、`maxRows`、`outputBytes` 和 `truncated`。SELECT 在数据库侧限制行数；元数据查询的 `maxRows` 为 null，受字节上限控制。`truncated` 仅表示输出超过 64 KiB 被截断，不表示已读完所有数据库记录。继续查询请提供稳定的 `ORDER BY` 和 `LIMIT/OFFSET`；关联查询建议明确列名并为重复列起别名。底层捕获超过 256 KiB 时中止查询。

SQL 通过 SSH 标准输入传递，不放入进程命令行。审计只记录 SQL 哈希、长度、引擎和结果大小，不记录 SQL 原文或查询数据。数据库客户端原始错误可能含 SQL 和敏感信息，因此不会直接返回或写入审计。

查询失败会返回 `errorCode`、中文 `message`、`guidance` 和 `retryable`，用于区分数据库用户不存在、数据库不存在、认证失败、客户端缺失、容器不可用、连接失败、查询超时、权限不足等情况。返回内容和审计均不包含原始数据库错误、SQL 原文或凭据。

系统及容器日志仍可使用 `execute_readonly_command`，例如 `journalctl -n 100 --no-pager`、`docker logs --tail 100 app`、`tail -n 100 /var/log/mysql/error.log`。

## 写文件和执行修改命令

写入能力分为两个工具：

| 工具                | 作用                                            |
| ------------------- | ----------------------------------------------- |
| `write_remote_file` | 通过 SFTP 创建或完整覆盖一个 UTF-8 文本文件。   |
| `execute_command`   | 执行可能修改服务器的 SSH 命令，并返回命令输出。 |

两个工具都受 MShell 本机设置中的“允许写入与修改”开关控制。关闭时，服务端会拒绝操作并记录失败审计；开启后，Agent 无需为每次调用重复提供写入参数，可以连续完成当前任务。

写文件示例：

```text
使用 connectionId="这里填写已确认的 ID"。
“允许写入与修改”已经开启。
调用 write_remote_file，filePath 使用 /etc/example.conf，写入我要求的完整内容。
```

执行修改命令示例：

```text
使用 connectionId="这里填写已确认的 ID"。
“允许写入与修改”已经开启。
调用 execute_command 执行 systemctl restart nginx。
读取返回的 output 并告诉我执行结果，不要执行其他命令。
```

写入限制：

- `write_remote_file` 每次最多写入 `1 MiB` UTF-8 文本，目标已存在时会完整覆盖，不是局部补丁。
- `execute_command` 最长 `8000` 个字符，默认超时 `20` 秒，最大 `120` 秒。
- 修改命令返回给 Agent 的输出最多 `64 KiB`，底层捕获上限为 `2 MiB`。
- 修改命令不经过查询白名单，可以执行删除、覆盖、安装、重启等高风险操作。
- 超时或客户端断开不能保证远程进程已经回滚；执行前必须准备备份和恢复路径。
- 写入开关会保存在本机，重启 MShell 后仍保持上次状态；任务完成后建议关闭。
- 写入开关不是第二个密码或人工审批机制。开启期间，任何持有 MCP Token 的客户端都可以调用写入工具。

## 服务端点

- 默认端点：`http://127.0.0.1:47821/mcp`
- 认证方式：`Authorization: Bearer <MCP 令牌>`
- 令牌：由 MShell 生成，可在“设置 - Agent 接入”中复制或重新生成。

## 可用工具

| 工具                        | 作用                                       |
| --------------------------- | ------------------------------------------ |
| `list_ssh_sessions`         | 仅列出当前确实处于已连接状态的 SSH 会话。  |
| `get_ssh_connection_status` | 读取一个已连接 SSH 会话的安全状态信息。    |
| `list_remote_files`         | 通过该会话的 SFTP 列出一个远程目录。       |
| `read_remote_file`          | 通过 SFTP 读取一个 UTF-8 文本文件。        |
| `execute_readonly_command`  | 执行单条白名单查询命令并返回命令和输出。   |
| `discover_database_targets` | 发现数据库与应用候选目标，要求多目标确认。 |
| `query_database`            | 查询数据库数据、表结构及日志表，支持 Docker 容器。 |
| `write_remote_file`         | 开启写入开关后创建或完整覆盖远程文本文件。 |
| `execute_command`           | 开启写入开关后执行可能修改服务器的命令。   |

## 约束与安全边界

- Agent 只能使用 MShell 当前已连接的 SSH 会话；断开或重连期间的会话不会被列出或读取。
- 默认只提供读取和白名单查询；写文件或执行修改命令必须先开启本机写入开关。
- 不返回密码、私钥、代理凭据或 Electron IPC 接口。
- 单次目录列表最多返回 `2000` 项；单个远程文件最多读取 `1 MiB`。
- 每次 Agent 工具调用都会写入 MShell 的审计日志。
- SSH 自动重连后，MShell 会按当前 SSH 客户端重建 SFTP 通道，避免使用旧连接遗留的通道。
- MCP 服务当前运行在 MShell Windows 桌面端；Android 端不能作为 MCP HTTP 服务端。
- MCP 端点只监听本机 `127.0.0.1`。不要通过端口转发、反向代理、内网穿透或防火墙把 `47821` 暴露给其他设备。
- MCP 令牌不是 SSH 密码，也不是同步加密密码；三者必须分别保管。
- 读取配置文件、日志和代码仍可能暴露业务数据。只允许 Agent 读取完成当前任务所需的最小路径。
- 查询命令的输出也可能包含进程参数、环境、日志、IP、容器配置或其他敏感信息，使用前必须确认查询范围。
- 写入开关不是额外身份认证。MCP Token 泄露时，应视为远程服务器写入能力同时泄露并立即轮换 Token。

该能力适合让 Agent 做状态检查、阅读配置、分析日志，以及在写入开关开启后连续完成修改任务。高风险变更仍应准备备份和回滚方式，任务完成后应关闭写入开关。
