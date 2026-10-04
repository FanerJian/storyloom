# StoryLoom 架构指南（v0.6）

面向接手维护与二次开发的开发者。读完这一篇，应该能回答：「改一个功能要动哪几个文件」。

## 1. 模块地图

五层结构，依赖方向自上而下（shared 被所有层引用，自身不依赖任何层）：

```
src/main        Electron 主进程（Node 侧，安全敏感：所有文件 IO 在这里）
src/preload     contextBridge，把受控的 IPC 面暴露为 window.api
src/renderer    React 编辑器（zustand 单 store + React Flow 画布）
src/runtime     可玩运行时（独立 vite 构建，?raw 内嵌进导出 HTML；试玩共用同一份）
src/shared      数据模型 / 校验 / 存档协议 / io 转换 / 契约类型（三端共用）
src-tauri       Tauri 2 壳（StoryLoom Lite，能力白名单 + recovery 插件）
```

| 层 | 关键文件（行数量级） | 职责 |
|---|---|---|
| main | `index.ts`（~150） | app 生命周期、单实例锁、窗口创建、关闭握手（渲染层保存确认后才能退出） |
| main | `ipc.ts`（~200） | 全部 IPC 通道（打开/保存/恢复/导入/导出/最近文件） |
| main | `directoryProject.ts`（~240） | v4 团队工程：pid 锁 + pending.json 事务 + 分场景保存 + sha256 素材去重 + 冲突检测 |
| main | `assetProtocol.ts` / `atomicFile.ts` / `recovery.ts` / `recentFiles.ts` / `windowState.ts` / `e2eHarness.ts` | 单一职责小模块 |
| shared | `schema.ts`（~420） | `StoryProject`（v3/v4）、10 种节点、`ReleaseConfig` 发布配置、`migrateProject`、`evalCondition/applyOp` |
| shared | `playerState.ts`（~200） | 存档协议（6 槽 + 校验 + 命名空间）、玩家设置（文字速度/自动档位/双音量） |
| shared | `authoring.ts` / `assets.ts` / `validate.ts` / `plugins.ts` / `api.ts` / `mime.ts` | v4 升版与素材寻址 / 去重哈希 / 静态校验 / 插件解析 / HostApi 契约 / MIME 表 |
| shared/io | `common.ts`（~500）+ `ink.ts` / `yarn.ts` | Segment 中间表示 + planChains/chainsToProject 两阶段互转 |
| renderer | `App.tsx` → `Workspace.tsx` → `StudioWorkspace.tsx` | 视图装配：studio 按 `workspaceMode` 路由到画布/剧本/场景图/角色/素材五个视图（`components/views/`） |
| renderer | `stores/project.ts`（~700） | 单 store + 外置 undo 历史（`commit()` 三档合并：离散/typing 800ms/drag） |
| renderer | `lib/exportHtml.ts` / `projectActions.ts` / `api.ts` | 导出合成 / 命令式动作 / 三端 HostApi 适配 |
| runtime | `player.ts`（~860） | `mountPlayer` 编排 + 剧情管线（enter/proceed/渲染）+ 自动/快进调度 |
| runtime | `screens.ts` / `typewriter.ts` / `media.ts` / `saves.ts` / `scripting.ts` | 标题画面与面板 UI / 打字机 / 媒体 / 存档 / 脚本引擎 |

## 2. 核心数据流

```
.story.json（v3 单文件）或 project.loomproject（v4 团队目录）
   │  migrateProject / upgradeAuthoring 兜底与升版
   ▼
渲染层 store（编辑、undo、自动保存 → recovery 快照）
   │                          │
   │ 试玩 PlaytestModal        │ 导出 exportHtml()
   │ mountPlayer(container,   │ runtime.js/css ?raw 内联 +
   │   project, {titleScreen})│ <script>window.__STORY__=…</script>
   ▼                          ▼
同一份 runtime 播放器（tgr-* DOM）—— 所见即所得
   └─ 读取 story.release（发布配置：标题画面/玩家设置/快捷菜单）
      与 window.__PLUGINS__（插件运行面）
```

**发布配置（`ReleaseConfig`，v0.6+）**：`StoryProject.release`，编辑器「发布设置」弹窗（`ReleaseModal.tsx`）编辑，随工程保存。运行时经 `normalizeRelease(story.release)` 与默认值深合并——旧工程/缺字段一律安全。标题画面按钮 class 契约（E2E 依赖）：`.tgr-title-start/-continue/-load/-settings/-credits`。

## 3. 存档系统（shared/playerState.ts）

- `playerIdentity`：存档命名空间 = gameId（v4）或 title+author+start 的哈希；试玩（`playtest`）与导出（`game`）天然隔离。
- `playerRevision`：作品指纹——v4 用 `gameId:saveCompatibilityVersion`，旧工程用全量 canonical hash。改了剧情 → 旧档失效（面板显示「版本已更新」）。
- `validatePlayerSave`：严格校验（节点类型限 dialogue/choice/end、素材 key 必须存在等），任何存档数据都不可信。
- `createPlayerStorage`：localStorage 包装，2MB 上限，**任何存储异常都吞掉不中断游戏**；玩家设置（`settings()`）与缩略图（`PlayerSave.thumb`，可选 jpeg data URL）都在这里。

## 4. 素材系统

- 单文件工程：`dataUrl` 直接内嵌（.story.json 单文件可移植）。
- v4 团队工程：`dataUrl:''` + `path/contentHash` 指向 `assets/{sha256}{ext}`；运行时地址 `storyloom-asset://{rootToken}/{path}`（特权协议，`within()` 限词法+realpath 防逃逸）；导出/单文件保存前 `embedAssets` 读回 dataURL。
- 寻址：节点用 asset key；演出脚本用素材**名**（`assetUrlByName` 宽松匹配省略扩展名，runtime/media.ts）。

## 5. Ink/Yarn 互转（shared/io/）

统一骨架：节点图 ⇄ `Segment[]` 中间表示。
- 导出：`planChains` 把图切成线性链（choice/end/jump/汇合点断开）→ 各格式 emitter。
- 导入：parser → `ScriptChain[]` → `chainsToProject` 两阶段组装（先建节点+链内连线，再统一解析跨链目标；未知目标生成占位 end，补 start）。
- Yarn 演出糖命令（`<<shake>>` 等）与 script 节点双向往返；Ink 多媒体导出为注释。
- 约定细节（结局标记、中文名规则等）见 README「Ink / Yarn 映射约定」。

## 6. 插件系统（shared/plugins.ts）

`.loomplugin` JSON，`parsePlugin` 校验 + apiVersion 门槛。四个作用面：editorCss/editorJs（PluginHost 注入）/ runtimeCss/runtimeJs（mountPlayer opts.plugins；导出经 `window.__PLUGINS__`）。editorJs 上下文 = `window.StoryLoom`（pluginsContext.ts，apiVersion 内承诺稳定）。

## 7. 三端 HostApi（lib/api.ts + shared/api.ts）

同一接口三套实现，按环境自动选择：Electron（window.api → IPC）/ Tauri（plugin-dialog+fs）/ 浏览器（input file + download + localStorage）。团队目录工程仅 Electron 支持（api.ts 显式拒绝其他端）。

## 8. 「怎么做」手册

**新增节点类型**（五处清单）：
1. `shared/schema.ts`：`NodeType` + `StoryNode.data` 字段
2. `shared/validate.ts`：静态校验规则
3. `renderer/components/Inspector.tsx`：NodeForm 表单（被剧本视图复用）
4. `shared/io/common.ts`（如需脚本互转）：Segment + 两个方向的处理
5. `runtime/player.ts` 的 `enter()` switch：演出语义（自动节点直接推进，交互节点停下渲染）

**新增播放器界面**：面板走 `runtime/screens.ts` 的 overlay 机制（`openOverlay`）；若受发布配置控制，在 `ReleaseConfig` 加字段（schema + normalizeRelease + ReleaseModal 三处）并按 `release.*` 显隐。

**新增 IPC 通道**：`shared/api.ts` 契约 → `preload/index.ts` 暴露 → `main/ipc.ts` handler → `renderer/lib/api.ts` 三端分支（Tauri/浏览器能实现才加）。

**测试矩阵**（package.json scripts）：
- `test:io` Ink/Yarn 互转回环；`test:core` Node 侧五件套（window/asset/recovery/player/studio）
- `test:player-dom` 真实 Electron 驱动播放器 DOM（17 checks，含标题画面）
- `test:studio-app` / `test:app` 隐藏窗口驱动编辑器 UI（12 checks）
- `test:browser-recovery` 浏览器回退链路
- E2E 截图：`STORYLOOM_E2E=<png目录> npx electron .`（实现 `main/e2eHarness.ts`，可选 `STORYLOOM_E2E_EXPORT=<html>` 驱动导出成品）

**构建矩阵**：
- `npm run build:runtime` → `resources/runtime/`（固定文件名，导出内联依赖它，**导出前必须先跑**）
- `npm run build` → `out/`（Electron main/preload/renderer）；`build:win` → dist/ 安装包+便携版
- `npm run build:web` → `dist-web/`（Tauri/浏览器）
- 打包需设 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`（npmmirror），否则 TLS 超时（退出码 0 但产物缺失，要查产物）

## 9. 已知技术债与后续方向

- 事件双轨：窗口/菜单走 IPC `menu:action`，编辑器内部走 window CustomEvent（`storyloom:playtest` 等）——可统一为事件总线。
- `stores/project.ts` 的 commit/set 样板较重复（700 行），可抽通用 `patchNode` 工具。
- 导出 HTML 单文件体积随素材线性膨胀；未来可做「素材外置目录 + 相对路径」导出形态。
- runtime 播放器已模块化（screens/media/saves/scripting/typewriter），但 player.ts 仍是编排闭包；如再膨胀可抽 enter() 管线为独立 engine。
- `presentation.overlayOpacity` 校验只接受 `''/0/1`（历史遗留），扩展演出快照时注意。
