# 第三方组件声明（THIRD PARTY NOTICES）

鲸域 · WhaleRealm 使用以下第三方开源组件。各组件版权归其原作者所有，按各自许可证分发。

本清单由 `scripts/generate-third-party-notices.mjs` 从 `hub/package-lock.json`、
`hub/node_modules/` 实际安装与 Electron 发行体自动生成；请勿手改，
改动依赖后重新生成（校验：`node scripts/generate-third-party-notices.mjs --check`）。

本项目自身按 GNU GPL-3.0-or-later 分发，全文见 `licenses/GPL-3.0.txt`。

## 随软件分发的组件

| 组件 | 版本 | 许可证 | 全文 |
|---|---|---|---|
| react | 19.3.0 | MIT | `licenses/npm/react@19.3.0/LICENSE` |
| react-dom | 19.3.0 | MIT | `licenses/npm/react-dom@19.3.0/LICENSE` |
| scheduler | 0.28.0 | MIT | `licenses/npm/scheduler@0.28.0/LICENSE` |
| lucide-react | 1.47.0 | ISC | `licenses/npm/lucide-react@1.47.0/LICENSE` |
| yaml | 2.9.1 | ISC | `licenses/npm/yaml@2.9.1/LICENSE` |

| Electron | 43.7.3 | MIT | `release/win-unpacked/LICENSE.electron.txt`（随发行体分发） |
| Chromium（随 Electron 分发） | — | 见汇总 | `release/win-unpacked/LICENSES.chromium.html`（20MB 全量第三方许可汇总，随发行体分发） |

### 许可证全文索引

各 npm 组件的许可全文已复制到 `licenses/npm/<组件>@<版本>/LICENSE`，随软件一起分发：

- `react@19.3.0` — MIT
- `react-dom@19.3.0` — MIT
- `scheduler@0.28.0` — MIT
- `lucide-react@1.47.0` — ISC。完整 LICENSE 同时包含 Feather 派生图标的 MIT 归属（Cole Bemis 等），随全文一并列出，不得仅按 ISC 摘要。
- `yaml@2.9.1` — ISC

### 说明

- Electron 虽列于 devDependencies，但其二进制随软件分发，故按分发组件对待，不因 dev 标志豁免。
- 社区桌面运行体（community-desktop）随本安装包分发，位于 `resources/runtimes/community-desktop-0.21.0-win-x64.zip`；其上游许可证与附加条款位于压缩包内 `source-notices/`，Node.js、pnpm 与 npm 依赖的许可保留在各自 `resources/` 子目录，来源与哈希记录见 `manifests/source-provenance.json`。
- 官方桌面版与 Web 运行体（Node.js 发行版、@deepseek-ai/dsh 等）仍为新建实例时按需下载，不随本软件分发；其许可与来源记录见 `manifests/source-provenance.json` 与各运行体自带的声明文件。
- 构建/开发依赖不进分发包，其许可清单由 `hub/package-lock.json` 记录，不在此重复列举。
