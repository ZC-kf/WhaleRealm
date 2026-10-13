# 鲸域 · WhaleRealm

**Windows 上的 DeepSeek Harness 多实例管理器。**

[English](README.en.md) · [下载 / Downloads](https://github.com/ZC-kf/WhaleRealm/releases/latest) · [使用指南](hub/docs/zh-CN/quick-start.md) · [问题反馈](https://github.com/ZC-kf/WhaleRealm/issues)

鲸域让每个 DSH 实例拥有自己的运行体、数据目录、工作区、浏览器配置、端口和进程树。新建、停止、重启或删除实例时，按实例所有权操作，避免覆盖其它 DSH 安装和数据。

## 下载与开始

适用于 **Windows 10/11 x64**。

| 下载文件 | 用途 |
| --- | --- |
| [WhaleRealm-1.0.0-setup.exe](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/WhaleRealm-1.0.0-setup.exe) | 安装版，适合多数用户；可选择安装目录 |
| [WhaleRealm-1.0.0-x64.zip](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/WhaleRealm-1.0.0-x64.zip) | 免安装版；解压到可写目录后启动 WhaleRealm.exe |
| [WhaleRealm-1.0.0-source.zip](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/WhaleRealm-1.0.0-source.zip) | 本版本源码与文档 |
| [SHA256SUMS.txt](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/SHA256SUMS.txt) | 下载文件的 SHA-256 校验清单 |

安装或解压后，打开鲸域 → **新建实例** → 选择类型、名称与空目录 → 创建 → 启动。首次社区实例部署需要解压随包运行体；官方 Web 首次创建需要网络下载。

## 1.0.0 支持范围

| 类型 | 状态 |
| --- | --- |
| 社区桌面版 0.21.0（托管 r5） | 已认证，随安装版与免安装版内置；创建无需另行下载运行体 |
| 官方网页版 @deepseek-ai/dsh 0.2.0-rc.2 | 支持按需部署；每实例使用独立 Electron 浏览器宿主 |
| 官方桌面版 | 尚未认证；创建入口拒绝未认证产物，不会执行普通上游安装器 |

认证针对具体版本与产物摘要，不保证任意上游版本。官方桌面候选此前有 HTTP 持续在线检查未通过，未以环境豁免代替认证。详见 [发布状态](docs/release-readiness.md)。

## 实例隔离与功能

- 每实例独立数据、工作区、缓存、日志、浏览器 profile、端口和锁。
- Windows Job 管理所属进程树；停止 A 不按进程名批量结束 B。
- 同卷暂存创建、摘要校验、所有权回滚及未完成任务恢复。
- 实例扫描与收录、镜像快照、托盘管理、9 种界面语言。
- 保留已有实例的显式路径，不自动迁移旧安装或个人凭据。

隔离用于防止正常使用中的实例冲突，不是对本机恶意程序的安全沙箱。

## 更新方式

程序会检查本仓库的最新正式 Release，并提供更新提示；也可在 **设置 → 关于** 手动检查。**1.0.0 不执行无人值守静默安装。** 点击更新打开 GitHub 发行页，下载安装包后先停止实例并退出鲸域，再运行安装器。免安装版解压至新的程序目录，保留原实例数据位置。

更新地址固定为 ZC-kf/WhaleRealm；没有新的正式 Release 时不会虚构新版本。不需要配置 latest.yml；本项目使用自己的 GitHub Release 检查通道。

## 开发与构建

技术：Electron、React、TypeScript、Vite；运行体适配涉及 Electron 与 Rust/Tauri。依赖锁位于 hub/package-lock.json。

```powershell
cd hub
npm ci
npm run dev
# 验证
npm run build
npm test
```

打包前须准备清单中完全一致的托管运行体。社区 r5 归档位于发行 ZIP 的 resources/runtimes/ 中，复制到 hub/package.json 中 extraResources 指定的位置后，运行 npm run package:win 或 npm run package:portable。源码仓库不提交大体积二进制与实例数据。

```powershell
# 仓库根目录
node scripts/generate-third-party-notices.mjs --check
node scripts/verify-isolated-release.mjs
```

## 文档与参与

[快速开始](hub/docs/zh-CN/quick-start.md) · [实例指南](hub/docs/zh-CN/instance-guide.md) · [故障排查](hub/docs/zh-CN/troubleshooting.md) · [贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md)

## 许可

Hub 自有代码采用 [GPL-3.0-or-later](LICENSE)。第三方组件保留自身许可，参见 [第三方声明](THIRD_PARTY_NOTICES.md)、[Hub 依赖许可索引](hub/licenses/third-party-index.json) 与 [来源记录](manifests/source-provenance.json)。

**社区桌面运行体上游附有禁止商业化二次开发的额外条款，不能按纯 MIT 或 Hub 的 GPL 声明理解。** 使用或再分发该组件前请阅读其完整条款。内置图片按作者确认的分发授权保留。

Copyright (C) 2026 凛枫 (Linfeng)。
