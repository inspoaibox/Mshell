# MShell v0.2.13 升级说明

本次版本为本机 Agent / MCP 增加受限 SSH 查询命令能力。Agent 可以在用户明确指定的已连接会话中执行单条查询命令，并读取返回结果，但不能借此修改远程文件或服务器配置。

## 新增功能

- 新增 `execute_readonly_command` MCP 工具。
- 工具返回实际执行的命令、标准输出、完整输出字节数和截断状态，供 Agent 直接分析。
- 支持常见系统、进程、磁盘、网络、服务、日志、Docker 和防火墙状态查询。
- 查询使用独立 SSH exec 通道，不会把命令写入用户当前终端输入区。

## 安全限制

- 每次只允许一条白名单查询命令。
- 禁止管道、重定向、命令串、Shell 展开、脚本解释器、`sudo` 和修改类子命令。
- `systemctl restart`、`docker stop`、`iptables -F`、`find -delete` 等操作会被拒绝。
- 默认超时 10 秒，最大 20 秒。
- 返回给 Agent 的输出最多 64 KiB，底层捕获上限为 256 KiB。
- 所有成功和失败的 MCP 工具调用继续写入审计日志。

## 使用示例

```text
先调用 list_ssh_sessions，并让我确认目标 connectionId。
确认后调用 execute_readonly_command 执行 df -h，读取 output 并总结磁盘使用情况。
不要修改文件，不要执行其他命令。
```

## 文档入口

- [本机 Agent / MCP 只读接入](mcp-readonly.md)
- [安全产品使用说明书](security-manual.md)

## 版本信息

- 版本号：`v0.2.13`
- 对应页面：`docs/index.html`
