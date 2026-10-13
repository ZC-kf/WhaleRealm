# DSH 全形态独立实例 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 官方桌面版、社区桌面版、官方网页版均可安全创建并独立运行，任一实例的部署、生命周期及恢复不影响其他 DSH。

**Architecture:** 主进程以可信版本目录选择免安装资产，发行体适配器实施隔离。创建采用独占 staging 与所有权事务，统一实例路径、端口和进程管理；版本通过真实隔离验收后才进入支持目录。

**Tech Stack:** Windows x64、现有 Electron/React/TypeScript/Vitest；官方 Web 的便携 Node/npm；官方 Desktop 上游构建；社区 Desktop 的 Tauri/Rust 构建。

**Spec:** `<workdir>/docs/superpowers/specs/2026-10-03-dsh-instance-isolation-design.md`

## Global Constraints

- 三种形态都是最终交付目标，不能仅禁用桌面创建就宣称完成。
- 不在用户主机执行 DSH 普通安装器；免安装包也必须验证运行时副作用。
- 当前 3080 实例、`<user-profile>\.dsh`、`D:\DSH-Desktop` 不作为试装、自检、恢复或修改目标。
- 已有实例继续使用现有路径记录，不自动迁移或移动用户数据。
- 不修改现有 GPL 正式全文；新增自有源码保留项目版权头。
- 创建失败只清理任务拥有的文件；退出失败不得伪报停止成功。
- 保留现有九种语言、中英文手册、用户设置包名；既有未跟踪备份脚本不纳入本计划提交。
- 仓库账号由用户提供，不猜测身份；公开发布前核对实际沿用源码授权。

## Review Focus

1. 目标路径含空格/中文或经 junction 别名指向现有实例：拒绝别名冲突，合法独立路径成功（任务 2）。
2. 自检后用户向目标放入文件：发布不得覆盖，失败保留用户文件（任务 2）。
3. 实例进程退出后 PID 被系统复用：清理不能结束无关进程（任务 4）。
4. Web 同主机不同端口的 cookie 与浏览存储：两个访问窗口必须使用不同 partition（任务 5）。
5. 主机没有开发机目录/Node/Rust，或断网：已部署实例可运行；缺少新建资产明确失败，不使用普通安装器回退（任务 7、9）。

## 文件与契约

新增模块各有单一责任：`runtime-adapter.ts` 定义运行体协议，`runtime-assets.ts` 解析可信资产，`create-transaction.ts` 管理文件事务，`instance-operations.ts` 串行实例操作，`instance-web-window.ts` 隔离 Web 会话。修改现有 create-runtime、registry、paths、runner、web-runtime、supervisor、mirror 和 IPC 接线，不改成另一套应用框架。

共同类型由 `runtime-adapter.ts` 导出：

```ts
interface RuntimeAsset {
  assetId: string; kind: InstanceKind; version: string; adapterId: string;
  url: string; integrity: string; format: 'zip' | 'npm'; sourceRef: string;
}
interface InstanceLayout {
  root: string; runtimeRoot: string; dshHome: string; electronUserData: string;
  workspace: string; logs: string; cache: string;
}
interface RuntimeAdapter {
  id: string; kind: InstanceKind;
  deploy(asset: RuntimeAsset, layout: InstanceLayout, signal: AbortSignal): Promise<void>;
  selfcheck(layout: InstanceLayout, port: number, signal: AbortSignal): Promise<void>;
  launch(record: DesktopInstanceRecord, signal: AbortSignal): Promise<RuntimeHandle>;
}
```

`RuntimeHandle` 沿用现有 pid/url/stop/pause/resume，并增加 `exited: Promise<{code:number|null;signal:string|null}>`。旧记录新增可选 `layoutVersion: 2` 与 `adapterId`；缺少 layoutVersion 的记录继续使用原路径。

### Task 1: 主进程可信创建入口与普通安装器阻断

**Files:** Create `hub/electron/runtime-adapter.ts`, `runtime-assets.ts`; modify `create-runtime.ts`, `instance-catalog.ts`, `src/types.ts`, `src/components/InstanceSwitcher.tsx`, `src/api/demo-api.ts`; test `hub/tests/runtime-assets.test.ts`, `instance-create.test.ts`。

**Interfaces:** Produces `resolveRuntimeAsset(kind:InstanceKind, version:string, fetchImpl:CatalogFetch):Promise<RuntimeAsset>`；创建请求选择 kind/version，兼容期忽略 downloadUrl，并在主进程重新解析。

- [ ] 写失败测试：伪造 downloadUrl 不进入下载/执行；非支持版本拒绝；community 普通 exe 资产拒绝。断言 `spawnInstaller` 调用次数为 0，错误属于部署能力不足，不显示成功。
- [ ] 在 hub 执行 `npm test -- tests/runtime-assets.test.ts tests/instance-create.test.ts`，确认新增断言失败。
- [ ] 实现资产解析和适配器准入，删除创建路径的 `runSilentInstaller`；桌面版本只允许认证免安装资产。Web 版本核对实际 npm 发布及完整性，不假定 GitHub tag 必有 npm 包。
- [ ] 重跑目标测试及 `npm run build`，应通过；补齐临时未认证桌面版本的准确界面说明。
- [ ] 仅提交本任务文件：`fix: prevent system DSH installer execution during instance creation`。

### Task 2: 创建事务、目标保护与新布局

**Files:** Create `hub/electron/create-transaction.ts`; modify `instance-create.ts`, `create-runtime.ts`, `instance-paths.ts`, `instance-types.ts`; test `create-transaction.test.ts`, `instance-paths.test.ts`, `instance-create.test.ts`。

**Interfaces:** Produces `beginCreateTransaction(target:string, taskId:string, existingRoots:string[]):Promise<CreateTransaction>`；`CreateTransaction` 提供 `layout:InstanceLayout`、`publish():Promise<InstanceLayout>`、`rollback():Promise<void>`、`release():Promise<void>`。`resolveManagedLayout(root:string):InstanceLayout` 创建新布局路径；旧记录继续原解析。

- [ ] 用临时目录写失败测试：非空目录保护、别名/junction 冲突、两任务同目录、中文空格路径、目标后来出现用户文件、回滚失败信息。断言原文件字节未变，临时文件不落在其他实例。
- [ ] 运行 `npm test -- tests/create-transaction.test.ts tests/instance-paths.test.ts tests/instance-create.test.ts`，确认失败。
- [ ] 实现真实路径核对、独占任务锁、同卷 staging 和所有权标记；发布前复核目标；去掉整个目标递归清理。登记失败先撤销本任务登记，再按所有权回滚；残留明确返回。
- [ ] 为中断任务加入启动时只读发现和用户确认的恢复/清理入口，不能自动清理无所有权目录；运行目标测试和 build。
- [ ] 提交：`feat: create isolated instances through owned staging transactions`。

### Task 3: 注册表、端口与路径兼容

**Files:** Modify `hub/electron/instance-registry.ts`, `instance-paths.ts`, `instance-ipc.ts`, `port-allocator.ts`; create `instance-operations.ts`; test `instance-registry.test.ts`, `port-allocator.test.ts`, `instance-operations.test.ts`。

**Interfaces:** Produces `createInstanceOperations():{run<T>(id:string, operation:()=>Promise<T>):Promise<T>}`；registry.create/update 保留 layoutVersion/adapterId 及明确新布局路径；`reservePort` 为全局串行预留，创建和启动均调用。

- [ ] 写失败测试：并发两次 create 均保留、坏 JSON 恢复 .bak、旧记录路径保持、两个创建任务端口不同、外部占用不被抢占。
- [ ] 运行 `npm test -- tests/instance-registry.test.ts tests/port-allocator.test.ts tests/instance-operations.test.ts`，确认失败。
- [ ] 将全部 read-modify-write 操作串行化，校验结构并保留损坏原件；原子替换且保留可恢复备份。区分实例操作队列和全局登记/端口队列，避免相互等待死锁。
- [ ] 对创建、启动、恢复和删除接入相同实例操作约束，运行目标测试与 build。
- [ ] 提交：`fix: serialize instance registration and reserve independent ports`。

### Task 4: 实际进程监督与退出确认

**Files:** Modify `hub/electron/runtime-supervisor.ts`, `official-runner.ts`, `web-runtime.ts`, `process.ts`, `process-supervisor.ts`, `main.ts`, `instance-ipc.ts`; test `runtime-supervisor.test.ts`, `process-supervisor.test.ts`, `official-runner.test.ts`, `web-runtime.test.ts`。

**Interfaces:** `createRuntimeSupervisor` 的 spawn 增加 AbortSignal；所有实际 runner 返回任务前述 RuntimeHandle 并登记进程身份。stop 等待 exited，失败保留非 stopped 状态并返回错误。

- [ ] 写 deferred spawn 测试：start 后立刻 stop，最终不是 ready 且无存活句柄；写崩溃状态、退出超时、PID 复用、A/B 停止互不影响测试。
- [ ] 运行上述四份目标测试，确认新增断言失败。
- [ ] 实现启动取消、真实就绪、退出事件同步和有界停止；进程身份含创建时刻/映像信息，树清理仅限核对过的归属。失败不吞错；pause/resume/stopAll 使用一致生命周期规则。
- [ ] 运行目标测试与 build，再用专门测试子进程验证树退出，不能按 DSH 程序名批量终止。
- [ ] 提交：`fix: supervise actual runtime processes and await isolated shutdown`。

### Task 5: 官方 Web 适配与独立访问会话

**Files:** Create `hub/electron/adapters/official-web.ts`, `instance-web-window.ts`; modify `web-runtime.ts`, `instance-env.ts`, `main.ts`; test `official-web-adapter.test.ts`, `instance-web-window.test.ts`, `web-runtime.test.ts`。

**Interfaces:** Produces official Web RuntimeAdapter；`openInstanceWebWindow(id:string,url:string):Promise<void>`、`closeInstanceWebWindow(id:string):void`，每实例 persist partition，不加载 Hub preload。

- [ ] 写失败测试：A/B partition 不同；URL 必须为该实例批准的 loopback origin；日志令牌脱敏；npm/selfcheck 环境不沿用外部 DSH_HOME；安装脚本仅批准构建步骤运行。
- [ ] 运行目标测试，确认失败。
- [ ] 将 Node/npm 部署迁入 staging runtime，核验 Node 及 npm 资产完整性；安装时隔离环境/缓存，默认禁用生命周期脚本，明确批准所需原生构建。服务解析必须符合分配端口，窗口禁止 Node 权限、非批准导航及全局 cookie 共用。
- [ ] 执行目标测试、build 和两个专用 Web 实例验收，核对浏览存储与进程退出；记录真实通过结果。
- [ ] 提交：`feat: isolate web runtime deployment and browser sessions`。

### Task 6: 快照、恢复和删除的实例范围保障

**Files:** Modify `hub/electron/instance-mirror.ts`, `instance-ipc.ts`, `src/components/InstanceSwitcher.tsx`; test `instance-mirror.test.ts`, `instance-ipc.test.ts`。

**Interfaces:** 沿用 snapshot/diff/restore 接口；新清单携带版本及根命名空间。旧清单通过保留旧快照并重新建立基线升级，不能猜测冲突键属于哪个根。

- [ ] 写失败测试：两根同名 config.json 均能比对和恢复；归档/复制失败保留旧镜像；运行中恢复拒绝；历史路径逃逸拒绝；删除 A 保留 B 与旧共享运行体。
- [ ] 运行 `npm test -- tests/instance-mirror.test.ts tests/instance-ipc.test.ts`，确认失败。
- [ ] 在停止确认和操作锁内执行；临时镜像完成再发布；验证 manifest 和历史成员，拒绝链接逃逸；错误真实返回。新实例拥有的 runtime 可回收，旧共享 runtime 不删除。
- [ ] 重跑目标测试与 build，使用临时实例验证恢复字节结果。
- [ ] 提交：`fix: preserve per-instance data during snapshot restore and deletion`。

### Task 7: 官方与社区 Desktop 的认证免安装适配

**Files:** Create `hub/electron/adapters/official-desktop.ts`, `community-desktop.ts`, `scripts/build-isolated-runtimes.mjs`, `manifests/isolated-runtimes.json`, `runtime-sources/official-desktop/patches/`, `runtime-sources/community-desktop/patches/`；modify catalog/main；test `desktop-adapters.test.ts`, `runtime-assets.test.ts`。

**Interfaces:** 两个 Desktop RuntimeAdapter；`build-isolated-runtimes.mjs --kind <official-desktop|community-desktop> --source <directory> --output <directory>`，产出 zip 和来源/补丁/摘要凭据。manifest 是受信资产目录，包含版本、源提交、适配器和验收凭据。

- [ ] 先核对实际官方与社区源码版本/许可证/构建配置，固化具体提交。保留原版权；社区源码在独立可忽略构建目录取得，维护补丁入库。
- [ ] 写失败测试：未认证版本拒绝；Desktop 环境及单实例存储不同；社区全局 shim/协议/更新注册关闭；解包 .exe 不执行；缺少本地构建工具不影响已部署实例。运行测试确认失败。
- [ ] 实现官方适配补丁：userData 在锁前设置、宿主端口显式传递、工作区独立、默认全局更新与注册禁用。构建完整文件树，核验其实际消费者，不能只改 Hub 环境。
- [ ] 实现社区适配补丁：实例标识贯穿 app data、WebView、store、锁和服务端口；CLI/协议/启动项/更新器改为无全局副作用。保留社区真实壳，不替换成官方 Web。
- [ ] 在隔离测试环境分别构建并执行每类两个实例，验证写入、锁、端口、旧系统登记和停止互不影响；失败修补，不将其计为支持版本。只将通过版本与精确 zip/摘要加入 manifest。
- [ ] 运行 Desktop 目标测试与 build，生成可追踪 zip、完整源码补丁和验收记录；提交：`feat: deploy certified independent desktop runtimes without installers`。

### Task 8: 创建界面、多语言与完整许可资料

**Files:** Modify `CreateInstanceDialog.tsx`, `InstanceSwitcher.tsx`, `FirstRunGuide.tsx`, `src/i18n/translations/*.ts`, `hub/docs/{zh-CN,en}/*.md`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `hub/licenses/`；create `scripts/generate-third-party-notices.mjs`, `manifests/source-provenance.json`；test `CreateInstanceDialog.test.tsx`, `third-party-notices.test.ts`。

**Interfaces:** `generate-third-party-notices.mjs --check` 检验声明与锁文件一致；无 --check 时生成版本、来源、许可证与文本索引，并供现有 license IPC 固定路径展示。

- [ ] 写失败测试：创建中禁止重复提交/更改/无主关闭、进度按任务归属、失败没有成功提示、九语言键集一致、锁文件全部条目可追踪且实际分发许可文本齐全。
- [ ] 运行目标测试确认失败。
- [ ] 接线创建任务 UI 和三个适配器，同步搜索与引导文案。按锁文件及分发结果生成依赖资料；核对 fork base 的实际沿用内容，无授权依据的文件取得许可或替换后再列为可公开发布。
- [ ] 执行生成检查、目标测试、build 和真实 UI 验收；文档记录支持版本与限制，不复用历史通过结论。提交：`feat: document isolated creation and ship verified third-party notices`。

### Task 9: 新机发行、仓库配置与更新

**Files:** Modify `hub/package.json`, `main.ts`, `ipc.ts`, `src/update.ts`, `App.tsx`, `SettingsDialog.tsx`, README；create `hub/electron/project-release.ts`, `scripts/verify-isolated-release.mjs`；test `project-release.test.ts`, `hub-root.test.ts`, `update.test.ts`。

**Interfaces:** `project-release.ts` 主进程读统一仓库配置；未知账号为空并准确显示未配置。`checkRelease():Promise<ReleaseInfo|null>`、`downloadRelease(id:string):Promise<{artifactId:string}>`、`installRelease(artifactId:string):Promise<void>`，执行仅绑定已核验产物。

- [ ] 写失败测试：无仓库时不猜测地址；新机稳定可写 root；旧 hub-root 保持；设置读取前不自动更新；任意路径安装拒绝；更新不改变实例数据。
- [ ] 运行目标测试确认失败。
- [ ] 完成稳定 root、受信运行体目录获取、setup+zip 双产物和单次可信更新；安装结果与延迟重启正确同步。用户提供账号后统一填写链接；公开上传前核对来源、数据排除和包内容。
- [ ] 执行 build、全量测试、设置中国镜像后打包；干净环境验证无本机 Node、无 D 盘也能首次创建三类认证版本。断网验证已有实例运行；真实更新在专门环境进行，比较设置/实例数据前后摘要。
- [ ] 产出最终验收记录，更新交接目录中的待办与文档（历史对话原文不改），提交：`feat: package independently managed DSH runtimes for release`。仓库建仓/公开上传仅在用户账号确定且发布资料可审阅后执行。

## 自审与完成标准

设计第 1—7 节由任务 1—7 覆盖；界面与配套由任务 8 覆盖；开源与发行由任务 8—9 覆盖；五项 Review Focus 已分配到对应失败测试。任务共用类型来自 runtime-adapter.ts，生命周期与路径迁移不另建不兼容平行契约。

临时桌面阻断、测试替身通过、本机 Web 单例成功均不等于完成。最终需三类认证版本的双实例验收、已有 DSH 不改写凭据、许可来源核对和干净发行验收。

计划等待用户审阅并选择执行方式：本会话直接逐项实施（Native），或逐任务实施与独立复核（Subagent-driven）。
