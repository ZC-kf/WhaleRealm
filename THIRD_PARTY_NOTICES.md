# 第三方组件声明

Hub 分发依赖的准确版本、完整许可全文与摘要索引见 [hub/licenses/THIRD_PARTY_NOTICES.md](hub/licenses/THIRD_PARTY_NOTICES.md) 和 [hub/licenses/third-party-index.json](hub/licenses/third-party-index.json)。这些文件由 scripts/generate-third-party-notices.mjs 从安装依赖及锁文件生成，发布前使用 --check 核对。

## 随 Hub 分发

| 组件 | 许可说明 |
| --- | --- |
| React / React DOM / Scheduler | MIT；完整文本见 hub/licenses/npm/ |
| lucide-react | ISC，同时保留 Feather 派生图标的 MIT 归属；不得省略 |
| yaml | ISC |
| Electron | MIT；Electron、Chromium 及其捆绑组件的完整许可随发行体提供 |

## 源码内复制的第三方实现

scripts/lib/repair-pnpm-links.mjs 的 depPathToFilename 与 depPathToFilenameUnescaped 根据文件内记录，移植自 pnpm 11.7.0 的 dist/pnpm.mjs。原作者归属：

- Copyright (c) 2015-2016 Rico Sta. Cruz and other contributors
- Copyright (c) 2016-2025 Zoltan Kochan and other contributors

完整 MIT 授权文本保留于 [licenses/pnpm/LICENSE](licenses/pnpm/LICENSE)。该工具位于源码分发范围内，不能因 pnpm 属于构建工具而省略复制代码的许可。周边自有实现采用本项目许可。

## 按需获取的运行体

| 组件 | 许可与边界 |
| --- | --- |
| 官方 DeepSeek Harness 运行体 | 上游 MIT；实际依赖树保留各自许可；本项目补丁许可单独记录 |
| 社区 deepseek-harness-desktop | 上游包含 MIT 及 Additional Terms — No Commercial Secondary Development；不能仅标注为纯 MIT。完整条款应随对应运行体的 source-notices 分发 |
| Node.js 发行体 | Node.js 核心 MIT；捆绑组件许可以该发行体 LICENSE 为准 |
| @deepseek-ai/dsh 及 npm 依赖 | 包及传递依赖各自许可；不得用主包 MIT 声明代替整个依赖树 |

源码及运行体精确来源、补丁摘要、作者声明与待办见 [manifests/source-provenance.json](manifests/source-provenance.json)。该清单的本机证据路径不是公开下载链接。

## 开发工具

开发依赖的解析版本以 hub/package-lock.json 为准。构建工具不因参与构建就自动随 Hub 分发；若复制源码、资源或二进制进入公开产物，则需保留该部分许可与归属。

本项目自有代码采用 GPL-3.0-or-later，见 [LICENSE](LICENSE)。第三方原有版权和许可不由此覆盖。
