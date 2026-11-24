# 更新记录 / Changelog

## [v0.5.1](https://github.com/ElmaTony/douyin-follow-manager/releases/tag/v0.5.1) · 2026-11-24

### 名单核对与中断恢复

- 关闭名单、刷新、切换画廊或遇到提交错误时，已取消的勾选会保留。核对期间其他画廊移回未审或改为保留的人会从名单移除，新标记需再次勾选。名单支持全选和全不选。
- 重试只列出上批未完成且审阅决定未变的人。另有「全部待取关」入口，可主动查看其他候选。
- 上一批的逐人结果保存在本机。重开后可区分已登记、尚未开始和中断待复核的账号。恢复后需要再次确认才会执行。
- 执行前再次检查当前标记。批量处理复用未变化的快照，单人复核只读取所需的标记记录。桌面打开旧画廊时按模板内容检查更新，已有标记继续有效。

### English

- Unchecked authors stay deferred across dialog closes, reloads, gallery switches and submission errors. Authors marked to keep or moved back to undecided disappear from an open confirmation list. Newly changed decisions require selection. Select or clear the full list in one click.
- Retry only unresolved authors whose decision is still current. The full pending queue remains available separately.
- The last batch is saved locally. Reopening distinguishes recorded results, work that never started and actions that need verification. A recovered batch requires confirmation before it can run again.
- The app checks the current decision immediately before acting. Batch verification reuses an unchanged snapshot and reads the requested decision records. The desktop launcher checks the generated gallery template for updates and preserves existing marks.

## [v0.5.0](https://github.com/ElmaTony/douyin-follow-manager/releases/tag/v0.5.0) · 2026-11-24

### 画廊内取关

- 三个画廊共用待取关名单。点卡片或在作品预览中连续标记后，可在画廊内逐人核对、取消勾选，一次确认即可执行。
- 切换画廊后仍可查看本批进度和逐人结果。已核实未关注的账号即时登记并退出待处理和导出名单。失败项保留，可单独重试。
- 画廊和文件导入共用大号身份、目标账号及关注状态核对。确认名单后更新的标记会重新核对，防止误取关。文件导入和在线核对在后台运行。
- 打开旧版生成的画廊时会更新操作入口，沿用原有审阅标记。已统一历史发版标题格式。

### English

- Review one deduplicated queue shared by all three galleries. Mark authors on a card or in the cover viewer, uncheck anyone to defer, and confirm the batch in place.
- Switch galleries while a batch runs and inspect individual results. Verified unfollows go straight into the local register and leave pending lists and exports. Unresolved entries can be retried separately.
- Gallery execution and file imports share checks for the signed-in account, author identity and live follow state. Decisions are checked again before acting. File imports and online checks run in the background.
- Previously generated galleries gain the new controls when opened from the desktop and retain their review marks. Historical release titles now follow one format.

## [v0.4.1](https://github.com/ElmaTony/douyin-follow-manager/releases/tag/v0.4.1) · 2026-11-24

### 维护与复测

- 桌面和画廊复测默认不保存截图。需要检查画面时，桌面复测使用 `-KeepScreenshots`，画廊复测使用 `--keep-screenshots`。截图保存在所测项目的数据目录内。
- 桌面复测结束后清理测试名单、辅助脚本和进程编号文件。发版收尾会核验下载文件，再清理本地旧安装包、临时解压目录及过期日志。历史发布仍可在 GitHub 下载。

### English

- Desktop and gallery checks save screenshots only when requested. Use `-KeepScreenshots` for the desktop or `--keep-screenshots` for the gallery. Images stay in the data folder under test.
- Desktop checks remove their sample list, helper script and process ID file on exit. Release housekeeping verifies the downloads, then removes superseded local packages, temporary extracts and obsolete logs. Previous releases remain available on GitHub.

## [v0.4.0](https://github.com/ElmaTony/douyin-follow-manager/releases/tag/v0.4.0) · 2026-11-24

### 多画廊审阅

- 同一博主在三个画廊共享保留和取关标记。旧版各画廊的决定一致时自动沿用。若有冲突，会显示「旧标记有冲突」，可筛出、核对各画廊原来的选择后重新决定。当前结果和整页名单把尚未解决的冲突标为「待复核」，账号操作预览会跳过。
- 新增「三个画廊已标记」导出范围。从任一画廊复制或下载都只需一次，按账号去重，只包含本次快照中可审阅且已决定的博主。保留名单、资料待核、冲突和未审账号均不会进入合并名单。
- 重新打开工具后，也可以在卡片上点「移回未审」，把以前的决定移出已标记名单并放回待审队列。这个操作同样可以撤销。
- 复制和下载前可核对各类决定的人数。文件名包含所选范围、快照日期与导出时间，方便区分连续下载的名单。
- 同一标签页内，切换画廊后仍能撤销共同博主的决定。在单人页面，撤销只作用于眼前这位博主。其他标签页后来改过的决定受到保护，即使最终显示的选项恰好相同。每个标签页对同一快照最多保存最近 50 笔手动操作。
- 从一个画廊经过另两个画廊查看同一位博主，可以逐层返回。来源和目标快照不同会得到提示。旧链接中的博主已不在目标画廊时，页面会说明原因并保留返回入口。

### 分类与依据

- 跨画廊入口显示另一个画廊的入选理由，包括主页或列表作品数、距最近已知发布的天数、历史昵称或本轮改名。资料不足、异常保留及名单保护在各画廊统一生效。
- 「从快照重建」会重新分析改名线索。只发生全半角或首尾空格变化的昵称不计为改名。前后两次快照昵称相同、但台账有不同旧名时，标为「历史名称不同」。缺少主页核验的线索会保留供查看，等待核验后再决定。
- 两条作品文案仅重复同款、下单或折扣等推广措辞时，不再据此判定内容转向。主题变化仍须有不同文案支持具体题材。
- 本轮作品日期不可见时，若旧快照已经记录近 30 天内的发布，停更画廊会排除该账号。

### English

- Keep and unfollow decisions follow the author across all three galleries. Matching legacy marks carry over. Conflicting legacy marks show the original choice in each gallery and can be filtered and resolved explicitly. Current-result and whole-gallery exports label unresolved rows as pending review, and the action preview skips them.
- Choose **三个画廊已标记** to copy or download one deduplicated list from any gallery. It includes current, eligible authors with a keep or unfollow decision. Protected, uncertain, conflicting and unreviewed entries are excluded.
- Reopen a previously decided author with **移回未审**. This removes the author from the combined list, returns them to the review queue and supports undo.
- The export preview counts each decision type. Download filenames include the scope, snapshot date and export time.
- Undo follows shared authors in the current tab. A single-author view limits undo to that person. Revision checks preserve newer edits made in other tabs, including edits that ended on the same choice. The tab keeps its last 50 manual edits for the snapshot.
- Return through a chain of galleries without losing the author. Cross-snapshot and missing-author links explain what changed.
- Repeated calls to buy, product matches and discounts alone no longer count as a change of topic. A shift requires distinct captions supporting a concrete subject.
- Cross-gallery links show the evidence behind each match. Offline rebuilds recheck name history, distinguish historical names from changes since the previous snapshot and ignore width or surrounding-space differences. Authors with incomplete verification have the same review restrictions in every gallery. A recently documented post excludes an author from inactivity review even when its date disappears in the current sample.

## [v0.3.0](https://github.com/ElmaTony/douyin-follow-manager/releases/tag/v0.3.0) · 2026-11-24

### 画廊与主页

- 从作品大图直接打开当前博主的主页，返回后继续查看同一张作品。从工作台打开画廊时，可勾选「复用主页标签页」，逐个查看不同博主。Ctrl 单击或鼠标中键仍可另开标签页作对照。
- 关闭专用主页页签后，下次会重新打开。如果已在该页进入作品、打开作品弹层或转到其他地址，下一个主页会另开，保留正在看的内容。直接打开本地 HTML 时，主页使用普通浏览器链接。
- 批量打开主页可选每次 1 位或 5 位。同一份快照中的三个画廊共享主页记录：默认跳过本轮已经打开或已经复制过链接的博主。卡片区分两种状态，仍可单独重看，也可从头重看当前结果。主页记录与保留、取关决定分别保存。
- 画廊导航随页面滚动保持可用。在同一标签页切换画廊后，返回时恢复原列表的阅读位置。跨画廊定位同一博主时，页面提供返回来源画廊和查看本画廊原列表两个入口。

### 连续审阅

- 修复双击大图标记按钮会把同一决定写给下一位博主的问题。快速连续点击列表同一位置及长按标记按钮也有防误触处理。
- 大图新增「暂跳下一位」和「撤销上一笔」。暂跳不会写入决定，本次连续预览会绕过暂跳者。撤销可回到刚刚标记的博主及作品。同一浏览器标签页、同一快照内切换画廊后，仍可撤销该画廊最近的手动决定，最多保留 50 笔撤销记录。
- 修复封面加载失败时卡片高度突变的问题。关闭大图时，当前博主仍在筛选结果中会定位到对应卡片。

### English

- Open the author's profile directly from the cover viewer without losing the current work. Galleries launched from the desktop can reuse one profile tab for individual visits. Ctrl-click or middle-click opens a separate comparison tab. If the user has moved on to a work or another address, that tab is preserved.
- Open profiles one or five at a time. All three galleries in the same snapshot distinguish opened profiles from links copied as a fallback. The batch skips both by default and supports replay. Profile browsing never changes review decisions.
- Sticky gallery navigation, restored reading positions and explicit links back to the source gallery make round trips easier.
- Double-click and repeat-key handling prevents accidental decisions during rapid review. Skip an author without marking, or undo and return to the same work. Each gallery retains up to 50 manual decisions for undo in the current tab and snapshot.
- Failed cover images retain their layout space. Closing the viewer returns focus to the current author's card when it is still visible.

## [v0.2.0](https://github.com/ElmaTony/douyin-follow-manager/releases/tag/v0.2.0) · 2026-11-24

从 v0.1.0 升级后，可以先对比两次关注快照，集中审阅本轮有变化的博主，再按当前筛选导出决定名单。

### 审阅与导出

- 三个画廊支持「只看本轮变化」「多画廊命中」和「未标记 · 无封面」。可以组合分类与标记状态、按粉丝数或停更时间排序，搜索昵称、曾用名、抖音号和文案。卡片显示变化依据及其他画廊的待核原因，跨画廊查看同一博主后可返回原筛选与批次位置。
- 可撤销上次标记，筛选条件会随画廊保存。大图预览支持标记后切换到下一位有封面的未标博主，并提示剩余无封面账号。修复手动标记一位时把系统锁定或预设保留的其他账号一起写入决定记录的问题；已有标记原样保留。
- 复制和下载名单可选「当前结果」或「整个画廊」，默认跟随当前筛选，并显示可导出人数。受保护账号会被排除；空结果可一键清除筛选，零条可导出记录时禁用复制和下载。浏览器拦截批量打开主页时，成功复制的链接会计入已交付批次，复制失败可从原处重试。

### 分类与作品

- 低作品画廊优先使用主页核验的作品数，支持筛选 0 部、1–5 部和 6–19 部。私密账号、作品数未知或与可见记录不符时单列待核。停更按快照时点的完整天数分档，上次确实看到过的发布日期也会纳入判断；仅有作品数而缺少可见日期时单列待核。
- 区分历史曾用名与上次采集以来的改名。主题变化须由前后多条不同文案支持，卡片可查看对应证据。重复文案、同一批共有样本及证据并列的主题不会单独触发判定。
- 近期作品按发布时间排列，同一条作品的封面、日期、文案及原作链接一起展示，支持视频和图文。封面加载失败会尝试备用地址；旧快照无法对应原作时会注明历史封面。修正卡片与作品预览跨午夜显示不同日期的问题。

### 桌面与采集

- 工作台新增「对比上次快照」，按稳定账号标识生成本地 CSV，列出新增、移出、改名、抖音号、粉丝数和作品数变化，以及可见作品更新、恢复发布、进入停更观察、可见日期回退和作品数跨过 20 部门槛等情况。首次采集前禁用重建，取得两次有效快照后才启用对比。
- 在线采集分批保存作品与主页核验进度。中断后六小时内重新更新，会核对账号和当前关注名单，复用可用结果，补查新增、未完成和作品数已变化的记录。修复续采时旧缓存覆盖新作品的问题；旧快照补图失败可单独重试。
- 发布本地快照与画廊前先校验整批文件，避免损坏文件导致部分画廊提前替换。更新了项目自检、离线回归和桌面、浏览器操作测试。

### English

- Compare two follow snapshots and export a CSV covering membership, names, IDs, counts, publication activity and threshold crossings. The desktop enables comparison and rebuilding when their inputs are ready.
- Combine change, cross-gallery, decision and missing-cover filters. Search former names and captions, sort results, undo a mark, or inspect the same author in another gallery and return to your saved position. Protected and preset rows are no longer stored as manual decisions when marking someone else.
- Export the filtered results or the entire gallery, with eligible counts shown before copying or downloading. Clear filters in one click. Successfully copied fallback profile links advance the batch cursor; failed copies can be retried.
- Low-post and inactivity categories use verified counts, full-day boundaries and previously observed publication dates. Limited visibility is flagged for review. Renames are dated against the previous snapshot, and topic changes require distinct evidence on both sides.
- Browse dated video and photo posts with matched covers, captions and original links. Use the cover viewer to mark and advance, then review authors without covers. Alternative cover URLs, legacy-cover labels and consistent calendar dates improve older snapshots and missing images.
- Resume interrupted collection within six hours after rechecking the account and following list. Recent results take precedence over stale checkpoints. Failed legacy cover lookups can be retried independently, and all pending local output files are validated before replacement.

## [v0.1.0](https://github.com/ElmaTony/douyin-follow-manager/releases/tag/v0.1.0) · 2026-11-23

首个 Windows 公开版本，包含关注工作台、迁移台账、账号操作与任务记录。

- 可按低作品、停更或资料变化审阅账号，保存标记并导出决定名单。
- 双账号迁移逐条确认目标关注状态。取关清单支持本地预览、在线核对和执行前确认。
- 首次使用时在本机绑定账号，Chrome 路径可自动发现或手动指定。
- 暖白纸感与陶红色桌面主题，程序文件、窗口左上角和标题栏共用「关」字图标。

### English

- First Windows desktop release with a dashboard, searchable ledger, account actions and task log.
- Three review galleries support local marks and decision-list export. Transfers verify the destination account's follow before processing the source.
- Local account binding, configurable Chrome discovery and a warm paper-and-terracotta interface.
