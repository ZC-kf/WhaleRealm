# WhaleRealm 发布就绪状态

更新日期：2026-10-13。本文件记录本次开源发布（1.0.0）的验收状态与已知边界，
不替代具体产物的逐项证据。文中结论均可由仓库内的清单与构建脚本复算。

## 结论

- 源码快照：294 个文件构成公开发布集（开发仓库排除 6 个非发布文件后得到）。
  快照为「内容保真」提交——提交树逐 blob 与冻结基线比对一致；不使用 force push，
  也不镜像开发历史。
- 发行产物（`WhaleRealm-1.0.0`）：
  - `WhaleRealm-1.0.0-setup.exe` —— 离线全量安装包（NSIS，非静默、可改安装目录）。
  - `WhaleRealm-1.0.0-x64.zip` —— 免安装（解压即用）。
  - `WhaleRealm-1.0.0-source.zip` —— 源码压缩包，内容与远端快照逐字节一致。
- 两个发行产物均已通过 `scripts/verify-isolated-release.mjs`：解析 ASAR 与 NSIS 实际
  载荷，未发现构建机绝对路径、用户数据或密钥形态内容。

## 运行体（实例运行时）状态

| 运行体 | 状态 | 说明 |
| --- | --- | --- |
| `community-desktop` 0.21.0 | 已认证，随安装包分发 | 11 项隔离验收全真；归档内置于 `resources/runtimes/`，创建实例**无需联网**。 |
| `official-desktop` | 未认证（本机环境豁免 8/11） | 见下文「环境豁免」。应用内选择该类型时会如实提示尚无通过隔离认证的桌面免安装包，不会代为执行普通安装器。 |
| `official-web` | 就绪 | 按产品既定逻辑按需下载。 |

### 环境豁免（官方桌面）

在本次构建所用的本机 AI 沙箱中，`dsh desktop host` 子进程在就绪后即退出，导致 HTTP
面无法持续在线：隔离本体 8 项断言为真，仅 3 项 HTTP 在线性断言（双实例同时服务 /
双端口在线 / 停止 A 后 B 仍在线）未通过。该现象已通过双侧证伪确认与运行环境变量无关，
且没有任何可抑制旋钮——环境因素既不充分也不必要。因此这里**不写「实际通过」**，
也不以环境豁免冒充认证。

升级路径：在任意无此沙箱机制的环境运行手动补证套件并通过后，即可把
`official-desktop` 提升为认证条目——只需更新清单，无需改动代码。

## 安全与隔离边界

- 每个实例使用独立的用户数据目录、WebView/Chromium 配置目录、端口与私有 OS 文件锁；
  同一实例的重复启动被私有锁拒绝。
- 实例删除要求所有权证明：目录内 `instance.json` 与布局版本必须匹配，否则拒绝删除
  并保留文件（fail-closed）。
- 社区桌面运行体的请求鉴权按实例传递：无凭据请求被拒绝，A 实例凭据不能用于 B 实例；
  该拒绝来自运行体自身的身份校验，而非代理层。
- 应用不注册全局自启动、协议处理与通知；不触碰既有的 DeepSeek Harness 安装与个人凭据。

## 校验方式（可复算）

- 运行体认证：`certify` 步骤只依据真实验收证据提升清单条目；证据不足的类型只会被排除，
  不会被写成认证。
- 快照保真：冻结基线记录每个文件的 git blob 摘要；推送前后各有一道闸门，提交树与基线
  逐 blob 比对，任何差异都会中止推送。
- 发行产物：`scripts/verify-isolated-release.mjs` 为纯 Node 实现、无第三方依赖，
  直接解析 ASAR 与 NSIS 载荷。

失败、未执行与环境限制分别记录，不合并为「通过」。

## 验证策略与约束

优先修业务问题，只运行与修改相关的回归。实际实例验证复用已核验的运行体，使用专有夹具
目录、独立端口和受所有权约束的进程树。不启动普通第三方安装器，不按进程名或端口批量
结束进程，不触碰已有 DSH 安装或个人凭据。

发布流程中的本机证据与临时产物位于被忽略的本地目录，不进入公开快照；公开文档不包含
访问令牌、用户数据或私人日志。

## 2026-10-13 发布检查补充 / Publication check

发布前检查确认旧的进程内静默安装无法在 NSIS 结束 Hub 后完成数据复核与重启。本版已改为自动检查并提示、用户到 GitHub 下载并在退出应用后手动安装；主进程拒绝旧安装 IPC。未将无人值守更新标为已验证。

The in-process silent updater could not complete verification/restart after NSIS terminated the Hub. This release checks and notifies only; users download and install after exiting the app. The old install IPC is disabled. Unattended updates are not claimed as verified.

本轮源码发布包含中英 README、贡献与安全说明、问题模板；此前的 294 文件计数仅对应旧快照。NSIS 验证依赖本机可用的 7-Zip 来读取实际负载，ASAR/ZIP 解析由 Node 工具完成。

The updated source includes bilingual READMEs and repository guidance. The earlier 294-file count refers to the previous snapshot. NSIS payload inspection requires an available 7-Zip tool; ASAR/ZIP parsing is implemented in Node.
