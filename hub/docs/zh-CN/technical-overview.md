# 运行原理与技术解析

本文介绍鲸域的内部结构与关键机制，帮助理解软件行为，也方便开发者阅读源码。

## 整体结构

鲸域基于 Electron，分为三层：

- 主进程（`hub/electron/`）：实例生命周期、镜像、端口分配、进程监督、设置存储。
- 预加载桥（`hub/electron/preload.ts`）：通过 `contextBridge` 暴露白名单 API。
- 渲染层（`hub/src/`）：React 界面，通过 `useLauncherApi` 调用主进程能力。

主进程与渲染层共享 `constants.ts` 中的 IPC 通道名与 `types.ts` 中的类型定义，preload 的注册面与主进程的注册面是同一份定义。

## 数据目录

- 用户数据（userData）：`settings.json`、`hub-root.txt`、`launcher-assets`（插图）、`process-supervisor`（监督进程脚本）。
- 数据根（hubRoot）：解析顺序为 `DSH_HUB_ROOT` 环境变量 → `hub-root.txt` → 进程工作目录上级（开发态回退）。hubRoot 下是 `hub-data`（instances.json、skipped-installs.json）、`manifests`（runtime-catalog.json）、`instances`（每实例一个目录）、`shared/skills`。

## 实例模型

每个实例是一份登记记录（instances.json），含 id、runtimeRoot（源安装目录引用）、dshHome、electronUserData、workspace、logs、port、lockName 等字段。实例运行状态（运行中/停止/暂停/异常退出）只存在于内存态机，不落盘。

## 隔离模型

代码与状态分离：

- 代码：runtimeRoot 指向的源安装目录只读共享，启动时原地 spawn `DeepSeek Harness.exe`。
- 状态：dsh-home、electron-user-data、workspace 各自独立，端口与单实例锁各自独立。

启动实例时通过 `--user-data-dir` 与环境变量（`DSH_HOME`、`DSH_DESKTOP_*`）把状态重定向到实例自己的目录；并删除继承的 `ELECTRON_RUN_AS_NODE`，防止 runner 退化为纯 Node。

## 镜像模型

停止实例时把 dsh-home 与 workspace 复制到实例根下 `mirror/`，并写 `mirror.json` 清单（文件相对路径 → size / mtimeMs）。停止期间的差异通过逐文件比对 size 与 mtimeMs 得到新增 / 修改 / 删除三类。每次建立新快照前把当前镜像归档到 `mirror-history/`，最多保留 5 份。快照与比对都排除 node_modules、.git、.pnpm 与各类缓存目录。

## 进程管理

- 单实例锁：`dsh-desktop-<id>` 防止同一实例重复启动。
- 暂停 / 恢复：通过 `NtSuspendProcess` / `NtResumeProcess` 挂起 / 恢复整棵进程树，保留内存状态。
- 退出回收：独立监督进程记录所有登记的 pid，鲸域崩溃时也能在 Electron 之外结束进程树；正常退出时依次停止所有实例 → 监督器清理 → 本地句柄兜底。

## 端口分配

每个实例占用一个回环端口（默认 19387）。修改端口时检测与其他实例冲突及端口可用性，冲突则从目标端口开始循环探测下一个可用端口。

## 新建实例版本目录与流水线

- 版本目录（`instance-catalog.ts`）：官方网页版按 npm 包 `@deepseek-ai/dsh` 的元数据列版本，且只保留通过完整性核验的已验证版本（下载地址为 npm tarball）。两类桌面版只列 `manifests/isolated-runtimes.json` 中**通过隔离认证**的免安装 zip 包（`desktop-assets.ts` 逐项校验来源、补丁、收据与十二项验收检查）；没有认证条目时如实返回「尚无通过隔离认证的桌面免安装包」，绝不回退到安装器。结果不缓存，选择类型时实时拉取。
- 创建流水线（`instance-create.ts` + `create-runtime.ts` + `adapters/`）：核验（链接 HEAD、目标目录为空、任务日志落地）→ 下载部署 → 自检 → 收录。官方网页版部署 = 实例内自含 Node 便携版 + `npm install @deepseek-ai/dsh`，自检真实启动 `dsh web` 并 HTTP 探活后才收录；启动实例即在自身端口起本地服务（`DSH_HOME` 隔离）并打开浏览器。桌面版部署 = 下载经隔离认证的 zip 并解压到暂存目录，逐文件收据校验通过后才发布。整个部署发生在**归属本任务的暂存事务**（`create-transaction.ts`）里：发布前目标目录保持原样，失败按任务所有权回滚；软件中途退出会留下任务日志，下次启动经「确认清理」按所有权删除暂存产物，绝不触碰任务之外的文件。
- 实例类别（`instanceKind`）：按包名（`@deepseek-ai`/`deepseek-harness`）与 exe 名组合判定；老实例由 `list` 时现场补种。

## 界面数据流

界面状态集中在 `use-launcher-store`：实例列表、运行状态（5 秒轮询）、Token 用量、余额（10 秒轮询）、镜像差异（5 秒并行轮询停止中的实例）。启动 / 停止 / 暂停 / 恢复后立即刷新相关状态，避免陈旧显示。

## 文档多语言机制

内置文档存放于安装目录的 `docs/<语言代码>/` 下，按 id 组织文件。界面按当前语言列出文档标题（标题与简介走界面翻译），读取正文时依次尝试当前语言 → 英文 → 简体中文，找到即用。后续新增文档只需在 docs 目录添加对应语言的文件，并在翻译表中登记标题。
