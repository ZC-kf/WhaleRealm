# 第三方组件声明（THIRD PARTY NOTICES）

鲸域 · WhaleRealm 使用以下第三方开源组件。各组件版权归其原作者所有，按各自许可证分发。本清单覆盖运行时依赖与构建依赖。

## 运行时依赖（随软件分发）

| 组件 | 许可证 |
|---|---|
| react / react-dom | **MIT License** |
| lucide-react | **ISC License** |
| yaml | **ISC License** |
| Electron（含 Chromium、Node.js） | **MIT License**（Electron）；Chromium 与 Node.js 随发行体附带各自的第三方许可文件 |

## 新建实例按需下载的第三方组件（不随软件分发）

| 组件 | 用途 | 许可证 |
|---|---|---|
| dsh-tauri/deepseek-harness-desktop | 社区桌面版实例数据源（离线捆绑包内置 dsh 核心与运行时） | **MIT License** |
| Node.js 官方发行版 | 官方网页版实例运行时（本地服务），按需下载部署到实例目录 | **MIT License**（核心；bundled 组件许可随官方发行版 LICENSE 文件） |
| @deepseek-ai/dsh（npm 包，含其依赖） | 官方网页版实例运行体，按需 npm 安装到实例目录（版本与官方 GitHub Releases 一致） | **MIT License**（官方仓库 LICENSE；各依赖包自带许可声明） |

## 构建与开发依赖（不随软件分发）

| 组件 | 许可证 |
|---|---|
| TypeScript | **Apache-2.0 License** |
| Vite | **MIT License** |
| @vitejs/plugin-react | **MIT License** |
| vite-plugin-electron | **MIT License** |
| vite-plugin-electron-renderer | **MIT License** |
| Vitest | **MIT License** |
| electron-builder | **MIT License** |
| jsdom | **MIT License** |
| postcss | **MIT License** |
| @types/node / @types/react / @types/react-dom | **MIT License**（类型声明包） |

## 说明

- 完整依赖树及各自许可证以 `hub/package-lock.json` 与 `hub/pnpm-lock.yaml` 记录的版本为准。
- Electron 发行体内自带 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`，见所收录运行体目录。
- 本项目的许可证为 GNU GPLv3（或更高版本），见 LICENSE 文件。
