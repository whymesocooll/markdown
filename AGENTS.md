# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

InkFlow —— 对标 Typora 的所见即所得（WYSIWYG）Markdown 编辑器。纯浏览器应用：原生 JS + CodeMirror 6，无框架、无测试框架，esbuild 打包。所有注释与 UI 文案为中文，新代码保持该风格。

## 常用命令

```powershell
npm install              # 安装依赖
npm run build            # 打包到 dist/（含生成 src/gen-assets.js）
npm run dev              # watch 模式
$env:OUT_DIR = "out2"; npm run build   # 输出目录覆盖（dist 被外部句柄锁定时）

npm run desktop          # 构建后在 Electron 中运行（开发调试桌面版）
npm run pack             # electron-packager 打包 win32-x64 到 release/InkFlow-win32-x64/（双击 InkFlow.exe 即开）
npm run smoke:desktop    # Electron 冒烟：preload 桥 + 编辑器挂载 + 文件树 IPC 往返
```

### Electron 桌面版

- `main.cjs` 主进程：窗口加载 `dist/index.html`；菜单隐藏（快捷键全部由渲染进程处理）；Node fs + dialog 实现文件系统 IPC（含 `fs:write-asset` 图片落盘、`fs:grep` 全文搜索、mtime 冲突检测）。
- `preload.cjs`：contextBridge 暴露 `window.inkflowDesktop`（folder:open/restore/close、fs:walk/read/create、file:open/save/saveAs）。
- `src/desktop.js`：渲染进程适配层——`isDesktop` 检测（`window.inkflowDesktop` 存在时启用）。句柄统一为 `{ kind, path, name }` 结构，与浏览器 File System Access handle 同构。
- `filetree.js` / `files.js` 双后端：Electron 走 IPC，浏览器走 File System Access API（行为不变，测试可继续用浏览器环境）。**Electron 模式比较文件用 `path`（`sidebar.js` 的 `treeNodesHtml` 里 `key(h)` 辅助函数），不要用对象引用比较。**
- 文件夹路径持久化在 `userData/folder-path.json`（主进程维护，替代浏览器的 IndexedDB）。
- `INKFLOW_SMOKE=1`：启动后验证渲染进程并自动退出（0/1）；`INKFLOW_SHOT=<path>`：截图保存后退出；`INKFLOW_THEME=<主题名>`：配合截图模式，先写入主题设置再刷新页面，用于逐主题截图验证。三者用于打包产物验证。

无 lint / 单测脚本。测试是 puppeteer 冒烟测试，依赖本机 Edge：

## 提交约定

每次改完代码且验证通过后，自动执行 `git add -A && git commit && git push`（不需要等用户提醒）。提交信息用中文写清楚修改了哪些内容（列要点），并保留 `Co-Authored-By: Codex <noreply@anthropic.com>` 结尾。远端为 GitHub 私有仓库 `whymesocooll/markdown`（`origin/main`）。构建产物不入库（见 `.gitignore`）。



```powershell
# 1. 先起静态服务器（测试默认访问 http://127.0.0.1:8123/index.html，可用 URL 环境变量覆盖）
python -m http.server 8123 -d dist
# 2. 另开终端
node test/run.mjs       # 一键串行跑全部回归（自带静态服务器，遇错即停）
node test/smoke.mjs     # 主冒烟测试：渲染、命令、导出、主题（退出码 0/1 表示通过/失败）
node test/tree.mjs      # 文件树：桩 showDirectoryPicker 验证树渲染/懒加载/打开文件
node test/prompt.mjs    # 新建文件输入对话框：弹出/创建/重名拦截/取消（Electron 无 window.prompt）
node test/table.mjs     # 表格编辑：单元格内联编辑、右键菜单增删行列/对齐
node test/mermaid.mjs   # Mermaid：widget 渲染、光标回源码、导出内联 SVG
node test/regression.mjs # 缺陷回归：标题菜单、块插入换行、widget 点击定位、监听器、saveState
node test/diag.mjs      # 诊断：抓页面错误、检查 window.InkFlow
node test/diag2.mjs
```

Edge 路径硬编码在测试里：`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。测试通过 `main.js` 暴露的 `window.InkFlow` 调试入口驱动编辑器。

## 架构

模块均为 ES module，由 esbuild 从 `src/main.js` 以 **ESM + splitting** 打包（入口 `dist/app.js`，动态 import 生成独立 chunk 按需加载；**不要改回 IIFE**——IIFE 会把所有动态导入内联进单文件），`public/index.html` 原样复制到 dist。

### 所见即所得核心（本项目的关键机制）

`src/livepreview.js` 是 WYSIWYG 的核心：基于 Lezer 语法树 + 光标位置构建 CodeMirror 6 的 `Decoration` 集合。**规则：光标所在节点显示 Markdown 源码，其余位置隐藏标记并直接渲染效果**（标题放大、`**`/`~~`/`==` 隐藏、列表符换成圆点、`> ` 与 `#` 隐藏等）。**阅读模式**（工具栏书形按钮 / Ctrl+Alt+R，`readModeField` StateField + `readOnlyComp` 只读）让 `touched` 恒为 false：点击任何位置都不显示源码，仅保留渲染与高亮效果。块级/行内数学公式（`$$…$$`、`$…$`）、`==高亮==`、脚注（`[^x]` 引用/定义）、`[toc]` 不走语法树，用正则按行扫描生成装饰（脚注与 [toc] 的上下文判断要用窄代码正则——`[^x]`/`[toc]` 会被 Lezer 解析成 Link 节点，CODE_CTX 的 Link 分支会误判）。装饰合并后要做冲突过滤（语法树与自定义正则的 replace 装饰重叠会导致崩溃）。

### 点击定位的坑（重要，踩过）

CodeMirror 用 `getBoundingClientRect`（不含 margin 的边框盒）建坐标模型，视觉与模型不一致会让**点击文字时光标串行到相邻段落**（`test/click.mjs` 回归测试）。两条铁律：

1. **行元素（`Decoration.line` 类）和 block widget 上不要用垂直 `margin`**，用 `padding`（padding 在边框盒内，测量一致）。标题 `.ink-h*`、代码块、mermaid、表格、数学块的间距全部用 padding。
2. **block replace 的范围要含行尾换行符并设 `inclusiveEnd: false`**：`range(from, Math.min(to + 1, doc.length))` + `Decoration.replace({ block: true, inclusiveEnd: false, ... })`。否则被替换的行会残留空行元素（点击坐标整体下移一行）或吞掉下一行（空行消失）。所有 widget 类（数学/mermaid/表格/分隔线/块级图片）都按此约定。

- `src/widgets.js`：渲染结果用 Widget 实现——公式（KaTeX）、图片（支持 `![alt|400]` 宽度语法）、表格、分隔线、任务勾选框、列表符号、`[toc]` 目录块（`TocWidget`，标题签名参与 eq）。点击 Widget 会把光标送回源码位置（`editOnClick`，目录项用同款 mousedown 模式）。
- `src/editor.js`：装配全部 CodeMirror 扩展，导出 `createEditor` / `setDoc`（带 `isolateHistory`，撤销不跨文档）/ 高亮样式 / 两个 Compartment（`readOnlyComp`、`spellcheckComp`）。
- `src/commands.js`：格式化命令（`toggleWrap`、`toggleLinePrefix`、`setHeading`、各种插入），工具栏与 `formatKeymap` 共用同一实现。
- `src/langs.js`：代码块内语法高亮，语言包按需动态加载（`LanguageDescription` + 动态 import）。

### 其余模块

main.js 已按依赖方向拆分，**依赖单向无环**：`state → icons/utils → sidebar/dialogs/theme → save-pipeline → doc-lifecycle → main.js`（组装根）。

- `src/state.js`：全局状态唯一归属地（不依赖其他 src 模块）——`app`（会话状态）、`treeState`（文件夹树）、`settings` + `defaults`（**加载时校验**：类型不符丢弃、未知主题回退 dark；恢复默认用 `resetSettings()` 原地恢复）、`readRecents`/`saveRecents`（最近文件）。全部 7 个存储 key 常量集中在此（settings/recent-files/obsidian-themes/vault/last/两个 IndexedDB 名）。
- `src/icons.js`：DOM 查询（`$`/`$$`）与 SVG 图标集（`P`/`svg`/`ICON`）。
- `src/sidebar.js`：侧栏渲染层（只渲染不做动作）——大纲（`buildOutline`/`scheduleOutline`/`highlightOutline`/`getOutline`）、文件树渲染与状态维护（`indexTree`/`loadTreeFromRoot`/`treeSectionHtml` 等）、文档库/历史/最近分区渲染（`renderFiles`/`refreshVaultSection`/`refreshHistorySection`）。
- `src/dialogs.js`：应用内对话框——`toast`（错误/警告带手动关闭）、`showConfirm`（Promise 化确认）、`showPrompt`（Electron 无 window.prompt 的输入替代）；Escape 关闭监听在模块加载时注册。
- `src/theme.js`：主题与外观——`effectiveTheme`/`themeFamily`/`THEME_NAMES`、Obsidian 主题导入注入（`obsidianThemes` 数组私有，删除走 `deleteObsidianTheme`）、`applyAppearance`（字号/行高/页宽 CSS 变量、专注/打字机/侧栏开关、主题变化刷新装饰、拼写检查 compartment）。
- `src/save-pipeline.js`：文档身份与保存管线——`text`/`setTitle`/`markDirty`/`renderSaveState`（状态条）、`checkpoint`（本地暂存，成功后刷 `refreshVaultSection`）、`autosave`（防抖，先 checkpoint 再写文件、外部修改冲突即停）、`finishSessionBeforeClose`（关闭前落盘并清空临时备份）。
- `src/doc-lifecycle.js`：文档生命周期动作——新建/打开/桌面版按路径打开/导入（`newDoc`/`openDoc`/`openDocFromPath`/`loadContent`/`openVaultDoc`）、保存与另存（`saveDoc`，前置确认 `confirmDiscard`）、导出（HTML/PDF/MD/复制富文本）、历史恢复（`restoreHistory`）、最近文件（`recordRecentFile`/`reopenRecent`/`removeRecent`）。
- `src/main.js`：组装根（约 1000 行）——`boot()` 装配编辑器并暴露 `window.InkFlow` 调试 API（测试依赖它，**暴露面不可改**）、工具栏与菜单、设置面板、粘贴管线（`pasteHandler`：图片优先落盘，桌面版文档旁 / 文件夹树根 `assets/`，失败回退 base64；富文本 HTML 经 `insertHtmlAsMarkdown`（Turndown）转 Markdown）、状态栏、阅读模式、快速打开（Ctrl+P 模糊匹配，候选=文件树+最近+暂存）、全文搜索面板、拖拽打开、`wireEvents()` 全部事件接线。
- `src/turndown-loader.js`：Turndown + GFM 插件懒加载（富文本粘贴 → Markdown），与 katex/mermaid 同款「失败可重试」模式。
- `src/obsidian.js`：Obsidian 主题导入器——解析 theme.css 的 CSS 变量（`.theme-dark`/`.theme-light`/`:root`/纯变量块/联合选择器，嵌套 `var()` fallback 多轮展开），映射为 InkFlow 主题变量（`MAP` 表 + 派生色 `color-mix`）。设置面板「导入 CSS 文件」导入，持久化于 `localStorage['inkflow:obsidian-themes']`，注入到 `<style id="obsidian-theme-css">`，主题 key 形如 `obs-<slug>[-light]`。解析/映射为纯函数，`test/obsidian.mjs` 直测（fixture 见 `test/fixtures/sample-theme.css`）。
- `src/files.js`：优先 File System Access API（可原地保存），否则回退上传/下载。本地文档库为 IndexedDB `inkflow-vault`（DB v2）：`docs` 存会话临时备份（关闭清空），`history` 存历史快照（每日一份、保留 7 天、跨会话保留，`putHistorySnapshot` 自带 60s 限频）；另 `inkflow:last`（上次文档 id）。图片落盘：`writeAssetDesktop`（走 fs:write-asset IPC）/`writeAssetBrowser`（写入目录句柄下 assets/，去重命名）。
- `src/filetree.js`：文件夹树——`showDirectoryPicker` 打开目录、递归遍历（懒加载子目录，深度上限 8）、句柄持久化到 IndexedDB（`inkflow-fs`，重开页面静默恢复）。`searchFolder` 全文搜索（桌面走 fs:grep IPC，浏览器递归 FSA；上限：500 文件/200 结果/单文件 2MB）。树状态（展开集合、节点 Map）在 `state.js` 的 `treeState`，渲染逻辑在 `sidebar.js`（`treeSectionHtml`/`treeNodesHtml`）。
- `src/exporter.js`：marked + highlight.js + KaTeX → 自包含 HTML（KaTeX/hljs/doc CSS 全部内联）；预处理管线 `replaceToc`（[toc]→锚链接列表）→ `extractFootnotes`（必须先于 marked：`[^x]:` 会被 marked 当链接引用定义吞掉）→ `extractMath`；`printToPdf` 按主题色系（dark/light）设页面底色；`buildRichFragment` 产出剪贴板富文本片段；`downloadFile` 走 Blob URL。mermaid 块导出时在浏览器内渲染为内联 SVG（`buildStandaloneHtmlAsync`），无 mermaid 时结果与同步版一致。
- `src/mermaid.js`：mermaid 懒加载共享模块（Widget 与导出共用实例）。
- `src/table-edit.js`：表格源码纯函数操作（解析 → 增删行列/对齐/单元格 → 整表重建），供 TableWidget 右键菜单与单元格编辑使用。
- `src/utils.js`：`sanitizeHtml`（写入 innerHTML 前的净化）、`panguSpacing`（中英文自动加空格）、`countWords`（单趟扫描）、`collectHeadings`（ATX/Setext 标题提取，livepreview 与导出共用）、`debounce`、`slugify` 等。

### 主题

配色全部走 CSS 变量 + `<html data-theme>`；高亮样式类（`.tok-*`）引用变量，切换主题无需重建编辑器。共 9 套主题：`dark`（墨夜）/`light`（素白）为默认，另有 `dracula`（德古拉）、`nord`（北极光）、`tokyo-night`（东京之夜）、`ink-wash`（墨池青黛）、`carbon-lilac`（碳素紫晶）、`paper-saffron`（藏经纸）、`solarized-light`（日光），主题块定义在 `styles.css` 顶部的 `[data-theme="..."]` 里（每套 31 个变量，含 `--inline-code`）。展示名映射在 `theme.js` 的 `THEME_NAMES`；工具栏主题循环按钮顺序 `['dark','dracula','nord','tokyo-night','ink-wash','carbon-lilac','paper-saffron','light','solarized-light','auto']`。**导出 HTML 只支持暗/亮两套文档样式**，新主题经 `themeFamily()` 归入 dark/light 再传给导出器，不要直接传新主题名（mermaid 图表配色会随该值渲染成对应深浅）。默认值在 `state.js` 的 `defaults`，持久化于 `localStorage['inkflow:settings']`，加载时经 `sanitizeSettings` 校验（静态主题白名单 + `obs-` 前缀，类型不符回退默认）。源码模式由 `sourceModeField` StateField 控制。

## 关键注意点

- `src/gen-assets.js` 由 `build.mjs` 自动生成（KaTeX/hljs/doc CSS 内联为 JS 常量），**不要手工编辑**；写入是幂等的（内容一致则跳过，避免与外部句柄冲突）。
- 不要用 `rmSync` 清空输出目录——环境安全钩子会拦截回收站操作并抛错，直接覆盖写即可（`build.mjs` 注释）。dist 可能被外部文件句柄锁定，此时用 `OUT_DIR` 覆盖到新目录。
- 超大数据文档（>600k 字符）实时预览降级为纯源码高亮（`livepreview.js` 里的保护分支），保证流畅。
- 根目录的 `shots-*` 目录和 `*.txt` 是测试/调试残留文件，不属于构建产物。
