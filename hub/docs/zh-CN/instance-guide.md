# 实例收录与运作

本文档说明鲸域对一个 DeepSeek Harness 桌面发行体从发现、收录到启动、运行、停止、镜像备份的处理过程。

## 1. 发行体发现

两个入口共用同一套判定逻辑：全机扫描（设置/首页的扫描收录）与手动导入（输入目录路径）。

全机扫描的候选目录来源：所有逻辑盘顶层目录、`Program Files` 与 `Program Files (x86)` 顶层、`%LOCALAPPDATA%\Programs` 与 `%LOCALAPPDATA%` 一层、注册表 `Uninstall` 下的 `InstallLocation`、运行中进程映像路径反推的安装目录，以及额外配置的运行体目录与跳过清单。

对每个候选目录依次执行：`findExecutable`（查找 `DeepSeek Harness.exe` 或 `dsh-desktop.exe`）→ `readVersion`（读取版本号）→ `verifyInstall`（检查 `resources/app` 或 `resources/app.asar`，作为真实可打开的完整发行体依据）→ `isolatableFor`（按 `manifests/runtime-catalog.json` 判定隔离档位）→ `flavorFor`（判定 desktop / web 类别）。

隔离档位：A / B 档可隔离托管，可收录为可启动实例；C 档只收录不托管；未声明的发行体一律按不可托管处理（fail-closed）。收录按钮仅在 `verifyInstall` 通过时可用，未通过的条目置灰。

## 2. 收录

点收录后依次执行：校验目录下存在 DSH 桌面可执行文件 → 判定 isolatable（不可托管则仅写入清单，不创建实例）→ 查重（runtimeRoot 已登记则直接返回）→ 生成实例 id → `registry.create` 写入 `hub-data/instances.json` → `snapshotMirror` 建立初始镜像。

实例记录采用原子写：先写临时文件，把现文件改名为 `.bak`，再把临时文件改名为正式文件。

### 新建实例流水线

工具栏「新建实例」提供四阶段流水线（`instance-create.ts`）：

1. 核验：探测下载链接（HEAD）、目标目录必须不存在或为空——此阶段失败不清理目录（目录可能属于用户）；
2. 下载部署：下载到**归属本任务的暂存目录**并部署、上报进度（发布前目标目录保持原样）；
3. 自检：产物完整性 + 真实运行自检，出错按任务所有权回滚清理暂存产物；
4. 配置收录：复用收录流程（查重 → 创建 → 命名 → 端口 → 初始镜像）后发布到目标目录。

三类形态：

- 官方网页版：运行体为 npm 包 `@deepseek-ai/dsh`（只列通过完整性核验的版本）。部署 = 实例目录内自含 Node.js 便携版 + npm 安装 dsh；自检真实启动 `dsh web` 并 HTTP 探活；收录为「官方网页版」实例。启动时在实例自己的端口起本地服务（`DSH_HOME` 指向实例状态根，与其它实例隔离），就绪后自动打开浏览器。
- 社区桌面版：只通过「新建实例」部署**经隔离认证的免安装 zip 运行时**（来源与验收凭据登记在 `manifests/isolated-runtimes.json`，逐文件收据校验）；普通安装器一律禁止执行。其隔离接口已核实（2026-10 主线源码）：官方 `$DSH_HOME` 数据目录隔离受支持，但桌面壳配置（端口 `.store.dat`、窗口状态、CLI shim 注册）为整机共享且端口无环境变量覆盖，因此在隔离认证验收（双实例并行、私有数据、独立端口/锁等十二项检查）全部通过前，按 fail-closed 不提供可创建版本，版本列表如实提示暂不可用；历史安装产物保留原处，可自行运行或经「扫描收录」查看。
- 官方桌面版：同样只走「经隔离认证的免安装运行时」通道（来源锁定官方构建及其隔离补丁）；未认证前版本列表如实提示暂不可用，不会回退到官网安装器。

### 对源安装目录的处理

收录过程对源安装目录只读，不复制、不移动、不修改、不删除其中任何文件。

- 源目录路径作为 `runtimeRoot` 字段存入实例记录，仅作引用，指向 `DeepSeek Harness.exe` 所在目录。
- 收录实际落盘的内容只有登记文件与实例根下的初始镜像；`dsh-home`、`workspace` 等目录在实例首次启动时按需创建。
- 启动时 runner 从 `runtimeRoot` 原地启动 `DeepSeek Harness.exe`，二进制与安装目录为只读共享；通过 `--user-data-dir` 与环境变量把运行状态重定向到实例自己的目录。因此删除或替换源安装目录会使所有引用它的实例无法启动。

## 3. 实例数据布局

每个实例在 `hubRoot/instances/<id>/` 下拥有独立目录：

| 路径 | 用途 |
|---|---|
| `dsh-home/` | DSH_HOME，存放配置、profiles、sessions、storages、skills |
| `electron-user-data/` | Electron 用户数据（Chromium profile） |
| `workspace/` | 工作区，作为 runner 的 cwd |
| `logs/` | 运行日志 |
| `mirror/` | 当前镜像 |
| `mirror-history/` | 历史镜像 |

`hubRoot` 的解析顺序为：环境变量 `DSH_HUB_ROOT` → `userData/hub-root.txt` 持久化值 → `process.cwd()/..`（开发态回退），解析结果写回 `hub-root.txt`。

其他字段：`port`（回环端口，默认 19387）、`lockName`（`dsh-desktop-<id>` 单实例锁）、`skillsSource`、`enabled`、`autoStart`。

路径安全：实例 id 需满足 `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`；实例根必须落在 `hubRoot` 之内，阻止 `..` 造成的路径逃逸。

## 4. 隔离机制

隔离对象是运行时状态与数据，不隔离代码：代码只读共享、原地运行；状态通过目录、进程、网络、环境四个层面独立。

- 目录：每实例一套独立目录树，技能等资源物理复制进实例自己的 `dsh-home/skills`，不使用符号链接或共享指针。
- 进程：每实例独立 spawn 一个 runner 进程；单实例锁防止重复启动；运行状态由内存态机维护，不落盘。
- 网络：每实例占用一个回环端口 `127.0.0.1:<port>`，只监听本机。
- 环境：注入 `DSH_HOME` 与 `DSH_DESKTOP_INSTANCE_ID / USER_DATA / WORKSPACE / PORT / LOCK` 六个变量，把状态全部指向实例自己的目录；同时删除继承来的 `ELECTRON_RUN_AS_NODE`，防止 runner 退化为纯 Node 无法启动。
- fail-closed：未知发行体一律按不可托管处理。

## 5. 启动与运行

启动依次执行：读取实例记录 → 标记运行中（期间禁止改端口/删除）→ spawn runner：

```
spawn(runtimeRoot/DeepSeek Harness.exe, ['--user-data-dir', electronUserData], {
  cwd: workspace,
  env: 注入后的环境,
  windowsHide: false,
})
```

`windowsHide` 显式设为 false：桌面发行体是 GUI 应用，若置 true 会把窗口全部隐藏。启动成功后状态变为运行中（含 pid 与 url），失败则变为异常退出。

运行状态机：停止 → 启动中 → 运行中 ⇄ 已暂停，启动失败落入异常退出。状态存于内存，不持久化。

暂停时通过 `NtSuspendProcess` 挂起整棵进程树（主进程与 GPU、renderer、utility 子进程），保留内存状态；恢复时调用 `NtResumeProcess`。挂起/恢复都先递归收集后代进程，再逐个处理。

## 6. 停止

停止依次执行：结束实例进程 → 清除运行标记 → 建立停止后镜像（等待完成，保证每个实例停止后都有基线）。

## 7. 镜像

镜像以「停止时刻」为基线，之后任何偏离都能通过文件清单比对发现。

- 快照结构：`mirror/` 存当前基线，包含 `mirror.json` 清单与 `dsh-home`、`workspace` 两份副本。清单只记录每个文件的相对路径、size、mtimeMs，不保存文件内容。
- 快照范围：仅 `dsh-home`（含 skills）与 `workspace`，不含 electron-user-data、logs 等可再生成的运行时产物。
- 排除目录：`node_modules`、`.git`、`.pnpm` 与各类 Cache，快照与比对统一跳过。
- 快照建立：把当前镜像归档到 `mirror-history/<时间戳>/` → 重建 `mirror/` → 复制目录 → 生成清单 → 裁剪历史到最多 5 份。

差异比对逐文件比较 size 与 mtimeMs：当前有、清单无 → 新增；两边都有但 size 或 mtimeMs 不同 → 修改；清单有、当前无 → 删除。三项任一非空即视为有差异，界面显示「实例异常」，点击进入修复页。

- 校正还原：删除新增文件，用镜像覆盖修改与删除的文件，回到最新基线。
- 历史回滚：可从任意历史快照（最多 5 份）回撤。

异常检测与启动校验：

- 主进程每 5 秒并行比对所有停止中的实例（运行中、启动中、暂停中的实例不判定异常），只读、低开销。
- 启动前先做一次 diff，不一致时弹窗让用户选择「更新镜像进入 / 还原镜像进入 / 取消」，避免带脏状态进入运行。
- 启动时后台补齐缺失镜像：对尚无快照的实例建立初始基线。

## 8. 端口分配

修改端口时，先取其他实例已占端口作为保留集合；若目标端口被占用或不可用，则从目标端口开始循环探测 1..65535，返回第一个可用端口。

## 9. 删除

- 仅移除注册：文件与镜像保留，可设置跳过再次扫描（临时或永久）。
- 完全删除：实例根目录（含 mirror、workspace、logs）移入回收站，随后移除注册并释放端口。

两种模式都会先停止实例并清除运行标记，可选删除指向该实例的桌面快捷方式（移入回收站）。

## 10. 退出时进程树回收

启动时创建独立的进程监督器（子进程，只依赖 Node 内置模块），记录所有由鲸域启动的进程 pid；当鲸域崩溃或强制关闭时，监督器仍能在 Electron 之外结束已登记的进程树。

退出流程依次执行：停止所有实例 → 监督器回收已登记进程树 → 本地句柄兜底清理。Windows 上先通过 WMI 递归收集后代进程并反向结束，再用 `taskkill /t /f` 兜底，覆盖脱离父进程树的子进程。
