# 贡献 / Contributing

感谢帮助改进鲸域。请先阅读 [README](README.md) / [English README](README.en.md)。

- 提交问题时说明 Windows 版本、鲸域版本、实例类型、复现步骤及预期行为。请移除日志中的 token、API key、个人路径与对话内容。
- 修改应保留每实例目录、进程树、端口和锁的隔离；普通第三方安装器不能进入创建流程。
- 提交 PR 前在 hub 目录运行 npm run build 和相关测试。运行体认证需要真实 A/B 证据，单元测试不能替代。
- 第三方代码与资源保留来源、许可全文和必要归属；不要提交实例数据、构建缓存或授权凭据。

Please include your Windows/app versions, runtime type, reproduction steps and expected behavior when reporting a bug. Redact credentials, private paths and conversations from logs.

Preserve per-instance directories, process ownership, ports and locks. Never execute ordinary third-party installers during instance creation. Run the build and relevant tests before opening a PR. Runtime certification requires actual A/B evidence. Preserve third-party provenance and licenses; do not commit user data, build caches or credentials.
