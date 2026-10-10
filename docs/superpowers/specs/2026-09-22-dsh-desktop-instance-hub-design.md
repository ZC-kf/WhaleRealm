# DSH Desktop Instance Hub 设计规范

## 目标

在 `D:\Dsh-Hub-HIDM` 内构建一个可视化 Hub，统一管理多个官方 DeepSeek Harness Electron Desktop 实例。每个实例必须拥有独立的 DSH 状态根、Electron 用户数据、Desktop profile、工作目录、端口、日志和单实例锁，并能在不触碰当前运行实例的前提下完成版本、插件和 Skill 装配。

## 现状与边界

- 当前官方 Desktop 仍在运行：程序位于 `D:\DSH-Desktop`，Web 服务监听 `127.0.0.1:3080`。
- 当前运行进程的 Electron `userData` 位于 `C:\Users\Lenovo\AppData\Roaming\DeepSeek Harness`；默认 DSH Home 还可能位于 `C:\Users\Lenovo\.dsh`。
- D 盘已有官方源码 `D:\deepseek-harness`、旧版 Desktop 源码审计树 `D:\DSH-Desktop-source-audit`、两个 Desktop 发行目录、`D:\dsh-browser` 和插件/备份资产。
- 本项目不在验收前停止、覆盖、删除当前实例，也不直接改写现用 `C:\Users\Lenovo\.dsh`。
- 原 D 盘目录先保留为回滚源；整理动作只允许复制、建立受控链接或生成迁移清单。

## 方案

### Hub 外壳

以 `rirko/dsh-melody-launcher` 的 Electron + React + TypeScript 结构为 UI 参考和工程底座，但不继承其单一 `RuntimeController` 语义。Hub 主进程持有实例注册表、状态机、进程树和所有写操作；渲染层只通过 IPC 请求操作并订阅状态事件。

### 官方 Desktop Runner

从官方 `deepseek-ai/deepseek-harness/apps/desktop` 源码构建一个可由 Hub 调度的 runner。runner 接受实例上下文（实例 ID、路径根、端口、版本/资源根），在 Electron ready 之前完成用户数据路径与环境设置，再执行官方 Desktop Host 生命周期。

官方代码的固定单实例逻辑和固定 `profiles/desktop` 路径保留其行为语义，但改为读取实例上下文：

- `app.setPath('userData', <instance>/electron-user-data)`
- `DSH_HOME=<instance>/dsh-home`
- Desktop profile 位于 `<instance>/dsh-home/profiles/desktop`
- 单实例锁包含实例 ID；不同实例不得竞争同一个锁
- Host 监听 `<instance>` 分配的 loopback 端口

### 集中目录

```text
D:\Dsh-Hub-HIDM\
├── hub/                         # Hub 源码、构建产物和配置
├── runner/                      # 官方 Desktop runner 源码/构建脚本
├── upstream/                    # 官方源码镜像与版本元数据
├── runtimes/                    # 每个官方 Desktop/DSH 版本的构建资源
├── instances/                   # 实例状态根
│   └── <instance-id>/
│       ├── instance.json
│       ├── dsh-home/
│       ├── electron-user-data/
│       ├── workspace/
│       ├── logs/
│       └── runtime-links/
├── shared/
│   ├── skills/                  # 只读技能源；实例按 manifest 复制/链接
│   ├── plugins/                 # 可复用插件本体缓存
│   └── pnpm-store/
├── imports/                     # D 盘旧资产的只读迁移副本
├── backups/                     # 每次迁移/切换的可回滚快照
├── manifests/                   # asset-inventory.json、hashes.json、migration.json
└── scripts/                     # 检查、构建、启动、备份和回滚脚本
```

### 实例模型

```ts
interface DesktopInstance {
  id: string
  name: string
  version: string
  runtimeRoot: string
  dshHome: string
  electronUserData: string
  desktopProfile: string
  workspace: string
  port: number
  lockName: string
  skillsSource: string
  enabled: boolean
  autoStart: boolean
}
```

所有路径必须是规范化绝对路径，且实例根必须位于 `D:\Dsh-Hub-HIDM\instances\<id>` 下。实例 ID 只允许字母、数字、点、下划线和横线。禁止实例之间复用 `dsh-home`、`electron-user-data`、`desktopProfile` 或日志目录。

### Skills 与插件

- canonical Skill 源集中在 `shared\skills`，不让每个实例的运行时直接依赖用户主目录。
- 创建实例时生成实例 Skill manifest，并将需要的 Skill 复制或建立受控目录链接到 `<instance>\dsh-home\skills`。
- 官方 profile 插件依赖写入实例自己的 `<instance>\dsh-home\profiles\desktop`，不写当前用户的 `~\.dsh`。
- 插件/Skill 安装和更新由 Hub 主进程调用官方 CLI/正式安装管线完成，渲染层不直接写 profile 文件。
- 迁移现有插件时先生成来源、版本、哈希和目标映射；无法确认来源的包保持为只读候选，不自动启用。

## 状态与错误处理

- Hub 持久化实例注册表使用原子临时文件 + rename，并保留上一份备份。
- runner 状态至少包括 `stopped`, `starting`, `ready`, `stopping`, `crashed`, `blocked`。
- 启动失败必须记录：版本、实例 ID、命令摘要（不含密钥）、工作目录、DSH_HOME、userData、端口、退出码和诊断文件路径。
- 端口冲突只能在实例未启动前自动选择同一分配策略的下一个端口；实际端口写回实例状态并广播给 UI。
- runner 崩溃不得修改其他实例状态；Hub 退出必须回收自己登记的进程树。
- 迁移失败只保留临时目标和错误清单，不删除源，不切换默认实例。

## 迁移规则

1. 先扫描并生成 `manifests/asset-inventory.json`，记录路径、类型、大小、修改时间、Git remote、版本和 SHA-256（大目录允许记录目录清单哈希）。
2. 对源码、发行目录、安装包、tarball、插件和备份分别分类；不把 `dsh-browser` 等非 Desktop 项目误归入运行时。
3. 目标复制完成后生成 `manifests/hashes.json`，逐项校验源/目标。
4. 当前运行实例只做快照；只有在新实例冷启动、插件/Skill 读取和隔离测试全部通过后，才允许用户选择迁移/切换。
5. 原目录至少保留一个完整回滚周期；任何删除必须是单独、显式、可审计的后续动作。

## 验收标准

- Hub 可创建、编辑、删除、启动、停止、重启实例，并显示 PID、状态、版本、端口、路径和日志。
- 两个实例可同时进入官方 Desktop 窗口；其 `DSH_HOME`、Electron userData、Desktop profile、锁名、端口和日志路径均不同。
- 在实例 A 安装/停用插件或 Skill，不改变实例 B 或当前 C 盘运行实例的 profile 文件。
- 实例 A/B 各自能加载声明的 Skill；UI 或诊断输出能显示实际解析路径。
- 关闭 Hub 后重新打开，实例注册表和路径仍可恢复；停止 Hub 会回收其子进程，不回收外部现有 Desktop。
- 资产迁移清单、哈希校验、备份路径和回滚脚本可复现。
- 至少通过：隔离单元测试、路径/锁/端口测试、Hub IPC 测试、两个实例启动烟测、插件/Skill 路径烟测和构建验证。

## 明确不做

- 不把当前 `C:\Users\Lenovo\.dsh` 或 `C:\Users\Lenovo\AppData\Roaming\DeepSeek Harness` 直接搬走。
- 不把不同端口或不同工作目录当作 profile 隔离证据。
- 不把社区 Tauri/Web launcher 冒充官方 Electron Desktop runtime。
- 不在未验证来源和许可证的情况下自动安装全部 D 盘插件。
