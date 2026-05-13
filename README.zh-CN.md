# TODOList Windows Codex Pet

[English](README.md)

这是一个 Windows 桌宠 TODO 管理应用，基于 Electron、React 和 TypeScript 构建。它使用人类可读的 Markdown 文件保存 TODO，并兼容 Codex 桌宠资源格式和本地 Codex 宠物包生态。

## 功能

- Windows 透明置顶桌宠窗口。
- 兼容 Codex 宠物包：`pet.json` 加 `spritesheet.webp`。
- 自动读取 `%USERPROFILE%\.codex\pets` 下的 Codex 宠物。
- 自动读取 `%APPDATA%\TOList\pets` 下的应用内宠物。
- 自动读取 `%APPDATA%\TOList\pet-packages` 下通过 npm 安装的宠物包。
- TODO 默认保存到 `%USERPROFILE%\Documents\TOList\todos.md`。
- Markdown 使用年、月、日三级标题组织，适合直接手写和阅读。
- 宠物头顶显示 TODO 面板，最多可见三条，超出后在面板内滚动。
- TODO 标题栏会显示“今日已完成 X 个任务”的激励文字。
- 系统托盘会显示可见图标，支持显示/隐藏窗口、打开 TODO Markdown 和快速退出。
- 右键宠物可显示或隐藏 TODO 面板、打开 Markdown 源文件、导入宠物 zip、刷新宠物、切换宠物样式和退出。
- 右键 TODO 使用原生菜单，可标记完成、删除、标红或取消标红，并通过 `Adjust Priority > Move Up / Move Down` 调整优先级。
- 长按 TODO 仍可在同一天内拖拽排序。
- TODO 完成后会划线并移动到当天列表末尾。
- 宠物状态会跟随 TODO 状态切换：有未完成 TODO 时为 `review`，清空后为 `idle`，鼠标悬停或新增后短暂 `waving`，拖拽时根据方向显示 `running-left` 或 `running-right`。
- 宠物动画保持 Codex 兼容的状态行和帧数，但播放节奏更慢，更适合桌面常驻。

## 环境要求

- Windows 10 或更新版本。
- 推荐 Node.js 24+。
- 推荐 npm 11+。

## 开发命令

安装依赖：

```powershell
npm install
```

启动开发模式：

```powershell
npm run dev
```

运行测试：

```powershell
npm test
```

运行 TypeScript 类型检查：

```powershell
npm run typecheck
```

构建 Windows 便携版可执行文件：

```powershell
npm run build
```

构建后的便携版可执行文件位于：

```text
release/TOList-Desktop-Pet-0.1.0.exe
```

## Markdown TODO 格式

默认源文件路径：

```powershell
%USERPROFILE%\Documents\TOList\todos.md
```

应用保存格式如下：

```markdown
# 2026

## 2026-05

### 2026-05-11 Monday

- [ ] [!] Important item
- [ ] [order:1] Display-priority item
- [ ] Normal item
- [x] ~~Finished item~~
```

规则：

- `#` 表示年份。
- `##` 表示月份，格式为 `YYYY-MM`。
- `###` 表示日期，格式为 `YYYY-MM-DD Weekday`。
- `[!]` 表示标红或高优先级。
- `[order:n]` 表示可见 TODO 的展示优先级，可用于逾期任务和今日任务之间的跨日期排序。
- 完成项使用 `[x]` 和删除线。
- 删除 TODO 会直接移除对应 Markdown 行。

## 宠物包格式

兼容宠物目录包含：

```text
pet.json
spritesheet.webp
```

示例 `pet.json`：

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A short human-readable description.",
  "spritesheetPath": "spritesheet.webp",
  "kind": "person"
}
```

Spritesheet 要求：

- 图集尺寸：`1536x1872`。
- 布局：`8` 列 x `9` 行。
- 单元格尺寸：`192x208`。
- 状态行顺序：
  - `idle`
  - `running-right`
  - `running-left`
  - `waving`
  - `jumping`
  - `failed`
  - `waiting`
  - `running`
  - `review`

更多安装说明见 [docs/pet-pack-installation.md](docs/pet-pack-installation.md)。

## 安装宠物包

通过 npm 安装：

```powershell
npm install <pet-package> --prefix "$env:APPDATA\TOList\pet-packages"
```

安装后右键桌宠，选择 `Refresh Pets`。

通过本地 zip 安装：

1. 创建一个包含 `pet.json` 和 `spritesheet.webp` 的 zip。
2. 右键桌宠。
3. 选择 `Import Pet Zip`。

复用已有 Codex 宠物：

```powershell
%USERPROFILE%\.codex\pets
```

## 项目结构

```text
src/main/             Electron 主进程、Markdown 存储、宠物注册表
src/preload/          暴露给 renderer 的安全 IPC 桥
src/renderer/         React 桌宠界面
src/shared/           共享类型
tests/                TODO 存储、宠物注册、动画 helper 的 Vitest 测试
docs/                 宠物包安装文档
```

## 当前范围

这是一个本地优先的 Windows 桌面应用。当前不包含账号同步、云存储、周期性 TODO、提醒系统或情感/人格系统。
