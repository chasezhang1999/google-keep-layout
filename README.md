# Google Keep 窄窗布局

`google-keep-layout.user.js` 是 Tampermonkey 油猴脚本，版本 0.5.0。
`create-shortcut.ps1` 建「Keep 窄窗」快捷方式。

## 仓库

GitHub 私有库 `chasezhang1999/google-keep-layout`（2026-10-22 起），各台电脑以它为准。
新电脑上拉到 `D:\Code\google-keep-layout`：`gh repo clone chasezhang1999/google-keep-layout D:\Code\google-keep-layout`，
再按下面「安装和更新」装脚本、建快捷方式。`node_modules` 不进库，要跑测试先 `pnpm install`。

## 做什么

1. **缩小图标**：顶栏、新建记事栏右侧三个按钮、左侧菜单按同一比例缩小（默认 75%）。
   - 顶栏 64→48（窄窗时 56→42）；
   - 窗口很窄时藏起顶栏的「Keep」字样，给按钮让位；去掉 Keep 页面 360px 的最小宽度。
2. **左侧菜单改成下拉**：平时完全收起、不占宽度，记事铺满整个窗口；
   点左上角菜单按钮，菜单从顶栏下方往下展开（宽 210，每行 36）。
   选了一项、点到菜单外、按 Esc 都会自动收起。菜单文字跟着缩小（默认 14→12px，最小 12px）。
3. **窗口能拖得很窄**：用「Keep 窄窗」快捷方式打开 Keep，窗口能拖到约 180（屏幕单位，PC 上约 220 像素）。
   脚本记住这个窗口的大小和位置，下次打开自动摆回去。

窄窗时 Keep 自己会变成单列、卡片铺满宽度，列表/网格切换按钮会被藏起来，
这时可以按 **Ctrl + G** 切换列表和网格视图。

## 左侧菜单怎么改的

- Keep 的菜单是 `.PvRhvb`：收起时带 `.PvRhvb-qAWA2`，占位块 `.PvRhvb-fozPsf-ysyhld` 撑出宽度，
  菜单面板 `.PvRhvb-bN97Pc` 固定在左边。脚本把占位块宽度设成 0，面板改成顶栏下方的下拉：
  收起时 `visibility: hidden`，展开时用 `clip-path` 从上往下露出。开关仍由 Keep 自己的菜单按钮控制。
- Keep 点完选项、点到菜单外都不会自己收起，脚本替它点一下菜单按钮（这样 Keep 自己记的状态、
  按钮的 `aria-expanded` 都对得上）。菜单按钮按标准菜单图标（`path d="M3 18h18v-2H3v2z…"`）认，
  认不到就认顶栏里唯一带 `aria-expanded` 的 div 按钮。
- Keep 在宽窗时把「菜单开着」记在 localStorage 的 `keep_db::left_nav_menu_open_state`（"true"/"false"），
  下次打开页面就是开着的、会盖住记事。脚本在页面最开始把 "true" 改成 "false"；页面加载完时还开着就关上。

## 为什么要另开一个窗口

「安装成应用」的 Keep 窗口最窄 500（PC 上 125% 缩放，就是 625 像素）。这是 Chromium 写死的：
`chrome/browser/ui/views/frame/layout/browser_view_app_layout_impl.cc` 里
`if (is_web_app_) contents_size.SetToMax(gfx::Size(kMainBrowserContentsMinimumWidth, 1));`，常量是 500。
Windows 连程序调整窗口大小也按这个最小值卡住，所以鼠标拖、网页 `window.resizeTo`、外部工具都过不去
（0.3.0 的「窗口宽度…」就是因此在应用窗口里无效，0.4.0 已删除）。
Edge 也一样（10-22，Edge 155）：装成应用的窗口同样拖不窄（Chase 自查）；`--app` 窗口和普通窗口的最窄宽度
与 Chrome 155 分毫不差（ASUS 上实测 178 / 516 屏幕单位），窗口这部分是同一份 Chromium 代码，换 Edge 没用。

用 `chrome --app=网址` 打开的窗口不算已安装的应用，没有这条限制，标题栏只有图标和最小化/最大化/关闭。
但这种窗口 Chrome 不记大小位置（每次都以默认大小打开），所以由脚本来记：只在地址带 `#kc-narrow`
的窗口里生效（标记存进 sessionStorage，Keep 改了地址也认得），先改大小再挪位置
（反过来会被 Chrome 推回屏幕内）；Chrome 摆出来的高度常比要求多一两个单位，
所以只在你自己拖动或挪动后才保存，不会每次打开都长高一点。最大化时不保存。

## 安装和更新

1. **油猴脚本**：打开 Tampermonkey 控制面板，点开「Google Keep 窄窗布局」（没装就「添加新脚本」），
   把 `google-keep-layout.user.js` 的全部内容粘贴进去替换原有内容，按 Ctrl+S 保存，再刷新或重开 Keep。
   脚本名和命名空间与旧版相同，会替换旧版。只改磁盘上的文件不会更新已安装的脚本。
2. **快捷方式**：PC、ASUS 上已建好（桌面和开始菜单里的「Keep 窄窗」）。别的电脑上运行：
   `powershell -ExecutionPolicy Bypass -File create-shortcut.ps1`
   （Chrome 用户资料不是 Default 时加 `-ChromeProfile "Profile 1"` 之类）。
   想固定到任务栏：右键快捷方式 →「显示更多选项」→「固定到任务栏」。
   快捷方式写着和窗口相同的任务栏身份（AppUserModelID `Chrome.keep.google.com_/`），固定后图标和打开的窗口是同一个，
   点它会切到已开的窗口。10-22 之前建的快捷方式没写这个，固定后会另起一个图标、点一次再开一个窗口：
   重跑一次脚本，取消原来的固定，再重新固定。
   快捷方式的图标用的是脚本复制到 `%USERPROFILE%\.google-keep-layout\keep.ico` 的那份，不是项目文件夹里的：
   ASUS 的 `D:\Code` 带沙箱加的权限规则，引用这里面的图标会显示成白纸；也不能放 `%LOCALAPPDATA%`，
   在 Claude / Codex 会话里跑脚本时，新建到那里的文件会被 MSIX 容器转存，资源管理器看不见，同样是白纸。
3. 用「Keep 窄窗」打开 Keep，第一次是默认大小，拖到想要的宽度、放到想要的位置；以后打开就是这个样子。
4. **发布到 GreasyFork**（10-22 起）：发布页的「附加信息」用 `greasyfork-description.md`（格式选 Markdown），
   脚本语言选「中文 (简体)」。脚本头部为此加了 `@license MIT`。

脚本完全不起作用时：

- 在 Chrome 地址栏打开 `chrome://extensions`，进 Tampermonkey 的「详细信息」，
  确认「允许用户脚本」已开启（Chrome 138 起需要）；
- 确认油猴总开关和本脚本开关都开着，并允许它在 `keep.google.com` 运行。

## 设置

**图标缩放…**：50–100（%），默认 75，在 Tampermonkey 菜单里，管顶栏、新建栏按钮和左侧菜单（菜单文字最小 12px）。
窄窗口的标题栏没有扩展图标，要在装好的 Keep 应用或普通标签页里打开 Keep，
点扩展图标（拼图）→ Tampermonkey 设置；各个窗口共用这个设置。

## 改了哪些地方（Keep 改版时对照）

类名取自 2026-10-21 的 Keep 页面（经典界面，非 Material 3）：

| 位置 | 选择器 | 做法 |
| --- | --- | --- |
| 顶栏（Google 通用顶栏，类名常变） | `#ognwrapper`、`#gb` | 整体 `zoom` |
| 选中记事时的顶部工具栏 | `.tJHJj-ZMv3u` | 整体 `zoom` |
| 左侧菜单 | `.PvRhvb`、占位 `.PvRhvb-fozPsf-ysyhld`、面板 `.PvRhvb-bN97Pc`、选项 `.PvRhvb-ibnC6b` | 整体 `zoom`，改成下拉 |
| 新建记事栏 / 三个按钮 | `.h1U9Be-xhiy4` / 其下 `[role=button]` | 按钮 `zoom` 后垂直居中 |
| 记事卡片 / 列表容器 | `.IZ65Hb-n0tgWb` / `.gkA7Yd-sKfxWe` | 只加 `max-width` 兜底 |
| body | `body` | `min-width: 0`（原 360px） |

菜单面板的 `top` 是 64/56px，与顶栏用同一个缩放比例，所以缩放后下拉正好贴在顶栏下面。

## 版本

- 0.5.0（2026-10-21）：左侧菜单改成点菜单按钮后从上往下展开的下拉，平时不占宽度；菜单文字跟着缩小（最小 12px）。
- 0.4.0（2026-10-21）：删掉 0.3.0 的「窗口宽度…」（应用窗口最窄 500，调不动）；
  改为「Keep 窄窗」快捷方式 + 记住窄窗口的大小位置。
- 0.3.0（2026-10-21）：缩小图标和菜单；去掉 0.2.x 的卡片重排和右下角「布局」按钮
  （窄窗时 Keep 自己就单列铺满；重排会破坏拖动排序）。0.2.1 原样存档在 `archive/0.2.1/`
  （10-22 起随整个文件夹进了 GitHub 私有库）。

## 验证状态

- **真实 Keep 页面**（Claude 内置浏览器，10-21）：把脚本注入页面后，
  顶栏 48/42、新建栏按钮 36 且居中，设置菜单弹出位置正确，搜索框展开后文字 16px；
  310px 宽时顶栏按钮都在、页面没有横向溢出。
  0.5.0 的下拉菜单：收起时左边不占位、记事铺满；展开在顶栏下方（210 宽、每行 36、文字 12px、有阴影）；
  真实鼠标点选项会跳转并收起，点菜单外、按 Esc 也收起；宽窗模式下展开不推动记事区。
- **窗口宽度**（PC，Chrome 155）：装好的 Keep 应用在 0.3.0 下调不窄（Chase 实测）；
  用快捷方式打开的窗口，程序强行设成 200 像素时停在 221 像素（即它的最小宽度）；
  标题栏只有图标和三个按钮。先改大小再挪位置能精确摆到指定位置；高度会多出一两个单位（已规避）。
- **Chase 实测**（10-21）：装上 0.4.0、用「Keep 窄窗」打开，反馈「可以了」
  （没细说是否试过关掉再开回到上次的大小位置）。0.5.0 还没装上试。
- **单元测试**：`node --test startup.test.cjs`，17 项通过（jsdom，只测逻辑，不测排版）。
  PC 上 PATH 里没有 node，可以借 Codex 自带的：
  `C:\Users\xczha\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`。
- **ASUS 这一份**（10-22）：PC 上的文件夹没有 git 和远端，这份是从 PC 那次 Claude 会话的记录里
  按顺序重放当时的写入还原的，中途几处字节数与 PC 当时打印的一致；`keep.ico` 由 `create-shortcut.ps1`
  从 ASUS 装好的 Keep 应用复制，`pnpm-lock.yaml` 在 ASUS 重新生成。ASUS 上 17 项测试、存档 0.2.1 的 10 项都通过。
  ASUS 的 Tampermonkey 里已装 0.5.0（10-22 看存储确认）。
  10-22 起以 GitHub 私有库为准（就是从 ASUS 这份推上去的），PC 那份要换成从库里拉的。
- **任务栏**（ASUS，10-22）：Chase 反映固定到任务栏后对不上。查明是快捷方式没有任务栏身份，
  而 Chrome 给 `--app` 窗口的身份是 `Chrome.keep.google.com_/`；脚本补上后重建，两个快捷方式与开着的窗口身份一致。
  固定后图标是白纸：快捷方式引用的 `D:\Code\google-keep-layout\keep.ico` 继承了 `D:\Code` 的低完整性标签等规则，
  Windows 取不出图标（从建好起就是白纸，没身份的对照快捷方式也一样）。先改放 `%LOCALAPPDATA%`，
  会话里渲染正常、资源管理器里还是白纸（重启资源管理器也一样）：那份图标被 Claude 的 MSIX 容器转存了，
  真实位置没有。最后放到 `%USERPROFILE%\.google-keep-layout`，截图确认桌面图标、开着的窗口在任务栏上的按钮
  都是 Keep 图标。Chase 确认固定到任务栏后图标正常、和窗口是同一个按钮。PC 上的快捷方式还是旧的。
