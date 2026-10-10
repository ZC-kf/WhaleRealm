# 鲸域 · WhaleRealm

一个本地图形化管理器，用于集中管理多套 **DeepSeek Harness 桌面实例**，核心使命是让任意多套 DSH 桌面**互不干扰**。

- 项目主页：https://github.com/ZC-kf/WhaleRealm
- 许可证：GPL-3.0-or-later（详见文末）

## 功能

- **实例收录**：全机扫描 / 手动导入本机 DSH 桌面发行体；只有能隔离托管的发行体才收录为可启动实例，其余只进清单（fail-closed）。
- **强隔离**：每套实例拥有独立的 `DSH_HOME`、Electron 用户数据、desktop profile、工作区、日志、端口与单实例锁。
- **启动 / 停止 / 重启 / 移除**：单实例粒度控制，停止一个实例不影响其它实例。
- **Token 消耗**：每张卡片显示该实例今日 Token 数与缓存命中率（本地日志聚合，无网络请求）。
- **设置**：界面主题（松林 / 海湾 / 莓果 / 石墨）、主界面插图、托盘常驻、危险操作二次确认。

## 技术栈

Electron + React 19 + Vite + TypeScript，pnpm 管理依赖。

## 开发

```bash
npm install
npm run dev      # 启动 Vite 开发服务器 + Electron
npm run build    # 类型检查 + 构建渲染层与主进程
npm run test     # 运行 vitest 测试
```

## 打包

```bash
npm run package:win        # 生成 NSIS 安装包（含桌面/开始菜单快捷方式）
npm run package:portable   # 生成 zip 便携版（解压即用，可直接审查内容）
```

发行前用 `node scripts/verify-isolated-release.mjs` 校验产物：
存在性、必备文件、无开发机路径 / 用户数据 / 密钥形态内容（zip 全量扫描；
NSIS 内容扫描需要 7z，缺失时如实报告未执行）。

## 目录结构

```
hub/
├─ electron/     # Electron 主进程（实例注册表、发现、运行监督器、设置、托盘）
├─ src/          # 渲染层（实例首页、设置对话框、引导）
├─ tests/        # vitest 测试
├─ docs/         # 内置使用文档（zh-CN / en，设置-关于可打开）
├─ licenses/     # GPL 全文 + 第三方组件声明与各组件许可全文索引
├─ public/       # 静态资源（图标、插图）
└─ build/        # 打包资源（icon.png）
```

## 交流与反馈

与设置-关于页保持一致：

- **Telegram 频道**：https://t.me/LF_WhaleRealm
- **QQ 交流群**：1125566250
- **问题与建议**：优先提交到 https://github.com/ZC-kf/WhaleRealm/issues ，便于持续跟进；群里适合交流讨论。
- 反馈时请附上软件版本、系统版本、操作步骤与报错截图/脱敏日志；发送前请移除 API Key、Token、账号信息等敏感内容。

## License

本软件依据 GNU General Public License v3.0 或更高版本（GPL-3.0-or-later）发布，完整文本见 `LICENSE` 文件或 https://www.gnu.org/licenses/gpl-3.0.txt 。

附加署名要求：任何分发本程序或其衍生作品的行为，必须在显著位置保留版权声明及作者署名（Copyright (C) 2026 凛枫）。

第三方组件及其许可证见 `licenses/THIRD_PARTY_NOTICES.md`（由 `scripts/generate-third-party-notices.mjs` 自动生成，改动依赖后请重新生成）。
