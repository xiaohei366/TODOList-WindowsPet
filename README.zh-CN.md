# TODOList Windows Codex Pet

[English](README.en.md)

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
- TODO 标题栏会轮播显示激励文字，先展示“今日已完成 X 个任务”，几秒后切换为“今日仍需完成 N 个任务”。完成数统计今日完成的父 TODO 项与子任务；剩余数规则为：父 TODO 未完成且设置了截止日期且截止日期不晚于今日时，父项计 1 加上其全部未完成子任务；否则父项不计入，子任务按自身截止日期独立判断（未完成且截止日期不晚于今日才计入）；未设置截止日期的项不计入。
- 会在本地日期切换后自动刷新 TODO 面板，昨日完成项会自动从可见列表移除。
- 支持定时 TODO 规则，可创建每周重复任务和一次性未来任务。
- 支持定时提醒；到点后会创建 TODO、自动进入该项专注模式，并发送 Windows 原生通知；若当前已在专注其他任务，提醒会排队，待当前专注退出或完成后依次进入。
- 定时规则保存到 `%APPDATA%\TOList\scheduled-todos.json`。
- 原生菜单和 TODO 面板支持中文 / English 切换。
- 鼠标移动到宠物右下角会显示直角缩放柄，拖动后可在 65% 到 200% 之间同步缩放宠物和 TODO 框。
- 系统托盘会显示可见图标，支持显示/隐藏窗口、打开存储数据的原始文件和快速退出。
- 右键宠物可显示或隐藏面板、切换语言、管理定时 TODO、导入/导出 TODO 项和定时任务、导入宠物 zip、刷新宠物、切换宠物样式和退出。
- 右键 TODO 使用原生菜单，可编辑、标记完成、删除、标红或取消标红、编辑标签、添加备注/截止日期/子任务，并通过 `调整优先级` 下的 `上移` 或 `下移` 调整优先级。
- 带标签的 TODO 会按 Chrome/Edge 风格的彩色标签组聚合展示，标签组可折叠、展开，并可与未打标签 TODO 同级调整顺序；编辑标签时会通过下拉框提供当前未完成 TODO 中已存在的标签供选择，同时保留自定义输入。
- 子任务保存在父 TODO 下方，可随父 TODO 折叠；父 TODO 必须等待所有子任务完成后才能标记完成。
- 长按 TODO 可直接拖拽排序；带标签 TODO 只能在标签组内排序，标签组和未打标签 TODO 在顶层同级排序。
- TODO 完成后会划线并移动到当天列表末尾。
- 宠物状态会跟随 TODO 状态切换：有未完成 TODO 时为 `review`，清空后为 `idle`，鼠标悬停或新增后短暂 `waving`，拖拽时根据方向显示 `running-left` 或 `running-right`。
- 宠物动画保持 Codex 兼容的状态行和帧数，但播放节奏更慢，更适合桌面常驻。

## AI 用量面板

右键 Pet，在第一个分割线上方选择 **AI相关 → AI 用量**。点击面板齿轮打开本机配置网页，添加 Codex、Antigravity 或自定义名称的个人网关。面板与 TODO 同宽（304px）并使用紧凑按钮，每个账号摘要约两个 TODO 项高度；关闭网页后仍由 Pet 后台刷新。专注期间请先结束专注再切换面板。

Codex、Antigravity 默认使用内置浏览器登录：选择平台后点击「浏览器登录」，当前设置页会直接跳转至官方授权页；登录完成后回到 Pet 的成功展示页，点击「查看账号与用量」继续设置，新账号自动保存并查询额度。无需填写 Client ID、Client Secret、回调地址或 scopes；自定义注册仅在高级登录设置中使用。支持跨平台及同平台多账号：点击「添加账号」或「添加另一个账号」，切换平台也会创建新账号草稿。相同身份与工作区重新登录只更新授权，不同身份自动新增，已有账号保留。配置页和 Pet 卡片显示平台、邮箱及工作区，自定义名称独立保留。凭据使用 Windows 系统加密，Pet 独立续期，不读取或改写其他客户端的登录文件。真实账号的授权、用量权限与续期仍需实际登录验收。

- **默认展示**：Codex、Antigravity 与个人网关均选择剩余百分比最低的一项，例如周额度剩余 18%、5 小时额度剩余 63% 时展示周额度。不同单位的原始余额不直接比较；没有百分比时显示可用余额，不将未知额度算作 0。
- **账号排序与状态**：账号名称和身份信息加粗。按住卡片摘要或左侧拖动柄即可调整账号顺序，靠近列表边缘会自动滚动；松开后保存，重启后仍保留。按 Esc 取消，也可聚焦拖动柄用上下方向键排序。暂停的账号在卡片或设置页点击「恢复并刷新」即可重新启用。
- **Antigravity 额度窗口**：仅展示 Claude 与 Gemini 的 5 小时、每周四个服务端限额窗口；模型目录中的其他条目不是时间窗口，不再进入面板。某个窗口未返回时显示「—」，不虚构数值，也不需要手动选择模型。
- **展开明细**：点击账号右侧「展开」，以 TODO 子项样式查看所有周期、模型和额度；「收起」恢复一条摘要。面板保持 TODO 的列表高度，可滚动查看。悬停额度可查看准确恢复/到期时间和金额。
- **统计周期**：Gateway Usage v1 可点击「添加统计周期」，同时添加今日、本周、本月，分别填写可选 Credit 预算。其他协议使用服务实际返回的周期。
- **测试查询**：结果及错误显示在测试按钮下方，后台刷新不覆盖该区域。正在执行的查询会等待完成，同一配置的重复点击复用 10 秒内的结果；平台限流仍遵守 Retry-After。

个人网关默认模板是 **火山引擎 API 网关 + VeFaaS + VMP**，需要已部署兼容的个人用量服务；普通推理 Endpoint 不自带余额接口。配置页可更换部署提供商、协议（Gateway Usage v1 / New API / Sub2API / Custom JSON）、地址、认证和字段映射，也可指定独立模型目录及其密钥。同协议只需换地址和凭证；不同协议需更换模板或映射；没有用量 API 时需要提供商侧适配服务。更换用量地址不会向新地址自动发送旧密钥。

Gateway Usage v1 的日/周/月统计与自设预算按 UTC+8 日历；预算是本地估算，不能代表官方可用余额。其他协议只采用接口返回的时间，自定义 JSON 支持带时区 ISO 或 Unix 秒/毫秒映射。路径原样拼接至 Base URL；如果 Base URL 已含 `/v1`，请将路径中的重复前缀移除。

 

## 环境要求

- Windows 10 或更新版本。
- 推荐 Node.js 24+。
- 推荐 npm 11+。

## 技术栈

- 桌面运行时：Electron 39，使用透明无边框 Windows `BrowserWindow`、原生托盘菜单、IPC，以及 Windows 置顶和鼠标穿透能力。
- 前端界面：React 19、TypeScript、CSS 和 `lucide-react` 图标。
- 构建工具：Electron Vite、Vite、TypeScript 编译器，以及 electron-builder 的 Windows 便携版打包。
- 数据持久化：TODO 使用本地 Markdown，定时 TODO 规则和应用设置使用 JSON。
- 宠物兼容：读取 Codex 风格的 `pet.json` 和 `spritesheet.webp` 图集，通过 JSZip 导入 zip，并用自定义 `todolist-pet://` 协议加载资源。
- 测试：Vitest 覆盖 Markdown 存储、定时调度、宠物注册、排序、本地化、窗口行为和动画 helper。

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
release/TOList-Desktop-Pet-0.4.0.exe
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
- [ ] [order:1] [tag:工作] [ddl:2026-05-12] Display-priority item
  - [ ] Sub-task item
  - Inline note text
- [ ] Normal item
- [x] [done:2026-05-11] ~~Finished item~~
```

规则：

- `#` 表示年份。
- `##` 表示月份，格式为 `YYYY-MM`。
- `###` 表示日期，格式为 `YYYY-MM-DD Weekday`。
- `[!]` 表示标红或高优先级。
- `[order:n]` 表示可见 TODO 的展示优先级，可用于逾期任务和今日任务之间的跨日期排序。
- `[tag:name]` 将父 TODO 归入单个标签组；标签组会以彩色折叠分组展示，并可与未打标签 TODO 同级排序。
- `[ddl:YYYY-MM-DD]` 表示父 TODO 或子任务的截止日期。
- `[done:YYYY-MM-DD]` 表示 TODO 的本地完成日期，因此今天完成的历史遗留 TODO 也会计入今日完成数。
- 缩进 checkbox 行（如 `  - [ ] Sub-task item`）表示父 TODO 的子任务。
- 缩进纯文本行（如 `  - Inline note text`）表示父 TODO 的备注。
- 完成项使用 `[x]` 和删除线。
- 删除 TODO 会直接移除对应 Markdown 行。

## 定时

右键桌宠并打开父菜单 `定时`，可分别选择 `定时 TODO` 或 `定时提醒`；两者使用相同的每周/一次性规则设置面板。

- 每周规则可选择星期，并在指定小时和分钟自动创建 TODO。
- 一次性规则可选择未来日期，并在指定小时和分钟自动创建 TODO；生成后规则会自动删除。
- 定时 TODO 会在后台创建任务；定时提醒还会自动进入新任务的专注模式并发送 Windows 原生通知，点击通知可重新聚焦该任务。若提醒触发时正在专注其他任务，新提醒会进入排队，当前专注退出或完成后自动依次进入；专注面板会显示排队中的任务数。
- 新增定时规则时，日期和时间会默认使用打开面板时的本地日期时间。
- 小时限制为 `0-23`，分钟限制为 `0-59`，日期必须是真实日历日期，例如平年 2 月 28 日、闰年 2 月 29 日。
- 紧凑星期选择器使用数字 `1-7` 显示。
- 错过的任务只补发今天已经到点的内容，不补发更早日期。
- 每条规则每天最多创建一次 TODO。
- 迁移环境时，可通过右键菜单导出或导入 `todos.md` 和 `scheduled-todos.json`。

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

安装后右键桌宠，选择 `刷新宠物`。

通过本地 zip 安装：

1. 创建一个包含 `pet.json` 和 `spritesheet.webp` 的 zip。
2. 右键桌宠。
3. 选择 `导入宠物 Zip`。

复用已有 Codex 宠物：

```powershell
%USERPROFILE%\.codex\pets
```

## 项目结构

```text
src/main/             Electron 主进程、Markdown 存储、定时 TODO、宠物注册表
src/preload/          暴露给 renderer 的安全 IPC 桥
src/renderer/         React 桌宠界面
src/shared/           共享类型
tests/                TODO 存储、定时 TODO、宠物注册、动画 helper 的 Vitest 测试
docs/                 宠物包安装文档
```

## 当前范围

这是一个本地优先的 Windows 桌面应用。当前不包含账号同步、云存储、推送通知或情感/人格系统。
