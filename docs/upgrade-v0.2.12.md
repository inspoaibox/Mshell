# MShell v0.2.12 升级说明

本次版本修复 Windows Electron 主进程中的 MCP Streamable HTTP 运行时兼容问题，并完善 Codex 图形界面的认证配置说明。

## 本次修复

- 修复 Electron 主进程没有暴露全局 Web Crypto 时，MCP SDK 在 `initialize` 阶段报 `ReferenceError: crypto is not defined` 的问题。
- 补齐 MCP 服务的 Web Crypto 兼容对象，恢复 Codex 对 `initialize`、工具发现和工具调用的正常访问。
- 增加 MCP HTTP 初始化、工具列表、Web Crypto 兼容和 Bearer Token 鉴权回归测试。

## Codex 配置说明

- MShell 使用“流式 HTTP”，不是 STDIO。
- 推荐直接标头模式：`Authorization` 的值必须是 `Bearer <MCP 令牌>`，不能只填写令牌。
- Bearer 令牌环境变量和直接 `Authorization` 标头为二选一配置；环境变量字段填写变量名，不填写实际令牌。
- 修改 MCP 配置后，完全退出并重开 Codex，再新建任务加载工具。

## 文档入口

- [安全产品使用说明书](security-manual.md)
- [本机 Agent / MCP 只读接入](mcp-readonly.md)

## 版本信息

- 版本号：`v0.2.12`
- 对应页面：`docs/index.html`
