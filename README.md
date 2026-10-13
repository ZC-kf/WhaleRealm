# 鲸域 · WhaleRealm

WhaleRealm 是 Windows 上的 DeepSeek Harness（DSH）实例管理器。目标是让官方网页版、官方桌面版与社区桌面版各自拥有独立的数据目录、浏览器配置、端口、锁和进程生命周期，创建、停止或删除一个实例时不影响其它实例。

本仓库处于发布前验收阶段。**源码已上传不等于三个运行体均已完成验收，也不等于安装包已可正式分发。**

## 当前状态（2026-10-11）

| 实例类型 | 当前证据与限制 |
| --- | --- |
| 官方网页版 | 固定 @deepseek-ai/dsh@0.2.0-rc.2；已有 A/B 独立浏览器宿主、数据及停止隔离记录。真实回收站清除仍需验证；模拟清除通过不能替代该证据。 |
| 社区桌面版 | 0.21.0 的 r3 构建已记录双实例与三实例共运行通过。清单仍引用构建机本地 ZIP，尚不能供其它电脑下载；还需修复移除启动鉴权的补丁。 |
| 官方桌面版 | 0.1.7-alpha.1 已构建 r7 候选。此前验收有 3 项 HTTP 持续在线检查失败，未进入认证清单；创建入口继续拒绝未认证版本。 |

[桌面运行体清单](manifests/isolated-runtimes.json) 的认证绑定具体源码、补丁和产物摘要，不代表任意上游版本可安全隔离。历史 manifests/final-acceptance.json 不是当前发行版验收结论。剩余事项见 [发布收尾清单](docs/release-readiness.md)。

## 隔离方式

- 每实例私有 runtime、数据、工作区、缓存、日志、浏览器 profile 和端口；旧实例保留已有显式路径，不自动迁移。
- 官方 Web 在独立 Electron 宿主中运行，关闭窗口与停止整个实例分别处理。
- Windows Job 管理实例进程树，停止操作基于本实例所有权，不按进程名或端口批量终止。
- 新建实例使用同卷暂存目录、完整性校验和所有权记录；失败或取消按本任务归属回滚。
- 桌面实例仅部署受信的免安装运行体，禁止执行普通第三方安装器。

这些机制用于避免正常使用中的实例冲突，不能替代操作系统安全边界或运行体自身的请求鉴权。

## 开发与验证

当前目标为 Windows x64。Hub 使用 Electron、React、TypeScript、Vite；桌面适配涉及上游 Electron 和 Rust/Tauri。开发依赖以 hub/package-lock.json 为准。

```powershell
Set-Location hub
npm ci
npm run dev
```

```powershell
# 在 hub 目录内
npm run build
npm test
npm run package:portable
npm run package:win

# 返回仓库根目录后核对声明和发行体
Set-Location ..
node scripts/generate-third-party-notices.mjs --check
node scripts/verify-isolated-release.mjs
```

打包生成文件不代表验收通过。运行体构建说明与源码锁位于 runtime-sources/；构建缓存、实例数据和本机验收材料不随源码仓库分发。不要执行本机交接目录内的旧推送脚本来覆盖新的源码修改。

## 文档与目录

- [快速开始](hub/docs/zh-CN/quick-start.md)、[实例指南](hub/docs/zh-CN/instance-guide.md)、[故障排查](hub/docs/zh-CN/troubleshooting.md)
- hub/：Hub 主进程、界面、测试与内置文档。
- runtime-sources/：运行体源码锁、隔离补丁及构建说明。
- manifests/：准入清单与来源记录；历史验收文件须按版本解读。
- scripts/：构建、声明生成与验证工具。

## 许可与素材

Hub 自有代码采用 **GPL-3.0-or-later**，完整文本见 [LICENSE](LICENSE)。第三方组件保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [来源清单](manifests/source-provenance.json)。社区桌面上游附有禁止商业化二次开发的额外条款，不能仅标注为纯 MIT 或由 Hub 的 GPL 声明覆盖。

五个内置图片由项目作者确认自行制作或已获分发授权；这是作者声明，不表示独立审查了逐项第三方授权文件。

Copyright (C) 2026 凛枫 (Linfeng)。分发时保留版权及署名信息。
