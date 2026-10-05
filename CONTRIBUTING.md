# 贡献指南

感谢关注 StoryLoom。提 issue 或发 PR 前，建议先搜索现有 issue 是否已覆盖同一问题。

## 报告问题 / 提建议

- 问题请用 **Bug 报告** 模板，注明交付形态（Electron 安装版 / 便携版 / 导出 HTML 所在浏览器 / Tauri Lite）与版本号。
- 功能建议请用 **功能建议** 模板，重点描述使用场景：你想完成什么，现在是怎么绕的。

## 开发环境

```bash
npm install        # 国内网络建议 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev        # Electron 开发模式（HMR）
npm run dev:web    # 纯浏览器调试（localStorage 回退）
```

- Node 22。
- 打包 Windows 安装包需 MSVC BuildTools；Tauri Lite 需 Rust stable-msvc。打包工具链下载建议同时设置 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run typecheck` | 类型检查（node + web 两个 tsconfig） |
| `npm run test:io` | Ink/Yarn 导入导出回环测试（无需 Electron） |
| `npm run test:core` | 恢复、素材去重、存档、目录工程与协作冲突回归（无需 Electron） |
| `npm run build` | 构建运行时与 Electron 三层 |
| `npm run test:app` | 隐藏 Electron 验证恢复、首屏、CSP 与试玩（需先 build） |
| `npm run test:player-dom` | 隐藏 Electron 验证玩家交互与单 HTML 重载读档（需先 build） |
| `npm run build:win` | 打包 Electron 安装包与便携版（dist/） |

## 提交 PR

1. 从 `main` 拉分支，一个 PR 聚焦一件事。
2. 提交前本地至少通过：`npm run typecheck`、`npm run test:io`、`npm run test:core`；改动涉及运行时或界面时，再跑对应的 Electron 测试。
3. CI 在 Linux 上跑同一组检查（Electron 测试经 xvfb），Windows 上跑核心子集。
4. 提交信息用约定式前缀（feat / fix / docs / refactor / test / ci / chore），描述可用中文。

## 代码约定

- 架构地图、数据流与各系统「怎么做」见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，动手前建议先读。
- 三端（Electron / Tauri / 浏览器）共用的数据模型与转换逻辑放 `src/shared`；运行时（`src/runtime`）是独立构建，不反向依赖编辑器。
- 改动工程文件（`.story.json` / `.loomproject`）schema 时，必须保持旧版本读取兼容（migrateProject 路径），并补回环测试。
