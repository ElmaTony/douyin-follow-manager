<div align="center">
  <img src="desktop/desk.svg" width="72" alt="关序图标">
  <h1>关序 · Douyin Follow Manager</h1>
  <p><strong>简体中文</strong> · <a href="README_EN.md">English</a></p>
  <p><strong>在 Windows 上安全审阅、整理和迁移自己的抖音关注列表。</strong></p>
  <p>采集大号关注快照与近期作品，从低作品、停更与改名转向三个维度筛选复核，支持画廊内直连取关与双账号增量迁移。</p>
  <p><a href="#下载">下载 v0.5.4</a> · <a href="#快速开始">快速开始</a> · <a href="#核心工作流">核心工作流</a> · <a href="#安全与数据机制">安全与数据机制</a> · <a href="#常见问题">常见问题</a> · <a href="CHANGELOG.md">更新记录</a> · <a href="https://github.com/ElmaTony/douyin-follow-manager/issues">反馈问题</a></p>
  <img src="assets/dashboard.png" width="840" alt="示例工作台，显示迁移进度及三个审阅画廊">
  <p><sub>截图中的账号、数量和迁移结果均为虚构示例。</sub></p>
</div>

## 下载

| 平台 | 下载 | 运行环境 |
| --- | --- | --- |
| Windows x64 | [Windows ZIP](https://github.com/ElmaTony/douyin-follow-manager/releases/download/v0.5.4/douyin-follow-manager-0.5.4-windows-x64.zip) · [SHA-256 校验清单](https://github.com/ElmaTony/douyin-follow-manager/releases/download/v0.5.4/SHA256SUMS.txt) | Windows 10/11 x64、Node.js 20 或更高版本、Google Chrome、支持 WPF 的 .NET Framework 4.8 |

ZIP 压缩包已内置编译好的 `关序.exe`、全部运行脚本以及 Playwright Core 依赖，完整解压到可写目录即可运行。源码归档与历史发行版可在 [Releases 页面](https://github.com/ElmaTony/douyin-follow-manager/releases)查看。

## 功能概览

| 入口 | 主要能力 |
| --- | --- |
| **工作台** | 展示大号关注快照时间与人数、迁移完成率、受限保留数、取关登记数、自检概要与重关提醒。 |
| **审阅画廊** | 自动生成「低作品（&lt; 20）」「停更（&gt; 30 天）」「改名与内容转向」三套本地画廊；支持作品灯箱、标记同步与画廊内直连核验取关。 |
| **迁移台账** | 按昵称、抖音号、状态标签或备注搜索，筛选待处理记录，支持一键重置可重试异常挂起项。 |
| **账号操作** | 导入 TXT/TSV/CSV 决定名单执行本地预览、在线核对与分批取关；发起双账号增量迁移；刷新与确认取关登记表。 |
| **任务记录** | 实时查看任务输出日志、警告汇总、失败原因与自检报告，支持随时安全中止运行中的任务。 |

## 快速开始

1. 安装 [Node.js](https://nodejs.org/)（20 或更高版本）和 [Google Chrome](https://www.google.com/chrome/)，并将 Windows ZIP 完整解压到可写目录。
2. 在解压目录打开 PowerShell，运行下方第一条命令登录并确认绑定用于审阅的**目标大号**；仅当需要在两个账号间迁移关注时，才运行第二条命令绑定**来源小号**。

   ~~~powershell
   node scripts/setup.mjs main
   node scripts/setup.mjs alt
   ~~~

3. 双击启动 `关序.exe`，在工作台点击 **在线更新审阅数据…** 采集大号完整关注列表、近期可见作品与主页核验状态，自动生成三个审阅画廊并联动更新取关登记表（若中途关闭窗口，6 小时内重新更新可核对名单并断点续采）。
4. 在工作台打开任意审阅画廊，浏览卡片或作品大图并标为 **待取关**，点击顶部 **处理待取关** 核对三个画廊合并去重后的名单，确认后即可在画廊后台完成核验取关与本机登记。

## 核心工作流

### 画廊审阅与名单取关

- **多维组合筛选**：支持「只看本轮变化」「多画廊命中」「未标记 · 无封面」以及低作品分档（0 部 / 1–5 部 / 6–19 部）、停更满天分档（31–90 天 / 91–180 天 / 181 天以上 / 活动待核）和改名转向过滤，按默认分组、停更最久或粉丝数排序，并支持按新旧昵称、抖音号及作品文案搜索。
- **跨画廊联动与位置记忆**：同一博主在三个画廊共享审阅决定、撤销记录（同标签页同快照最多保留 50 笔）与本轮主页打开记录；从卡片跳转至另一画廊定位单人后，可随时沿链路返回来源画廊并恢复原阅读位置。
- **作品灯箱连续审阅**：支持滚轮缩放、拖拽平移、查看原作链接、暂跳下一位、撤销上一笔并回到原作品；标记后自动跳转到当前筛选结果中的下一位有封面未标博主。
- **主页查看与名单导出**：支持每次 1 位或 5 位批量打开主页；从工作台打开画廊时可勾选「复用主页标签页」逐人查看（Ctrl 单击或中键另开对照页）。支持点击工作台 **对比上次快照** 导出 `data/snapshot_changes.csv`，也可按「当前结果」「整个画廊」「三个画廊已标记」导出四列决定名单。
- **画廊内取关与文件导入**：画廊内取消勾选可跨画廊暂缓至下次，未完成项支持单独重试；已核实未关注的博主立即写入本机登记表并退出待处理队列。已有 TXT/TSV/CSV 清单可在 **账号操作 → 从文件取关** 导入，依次经过本地预览、在线核对与确认执行，并支持设置处理上限在同名单下分批自动跳过已完成项继续执行。

### 双账号增量迁移与取关登记

- **四阶段迁移链路**：执行 **开始增量迁移…** 时按「前置核对（校验双端绑定身份与关注总数）→ 增量合并（自动保存 `former_nicknames` 历史曾用名并提醒命中登记表的账号）→ 分批限速迁移 → 终态复核与对照表导出（`data/crosscheck.csv`）」运行。
- **严控顺序与互关兼容**：迁移过程兼容普通关注与互相关注（朋友）状态，严格核实大号已关注成功后才执行小号取关；遇到单账号异常或受限挂起时自动记录并继续同批其余账号，遇到平台风控提示立即暂停，可在 **迁移台账 → 重置异常项** 一键放回待处理队列。
- **取关登记与重关管理**：在线更新快照或刷新登记表时按日期对比完整大号关注列表，自动将不再关注的账号写入 `data/unfollow_registry.json`，在后续增量迁移大号准备重新关注时自动拦截。若用户主动重新关注并在工作台看到重关提醒，可在 **账号操作 → 取关登记** 点击 **确认重关并移出登记…** 解除提醒与拦截；位于 `data/user_keep_list.json` 的永久保留账号会自动豁免重关告警。

## 安全与数据机制

- **三重身份与按钮状态校验**：执行任何关注或取关点击前，同时核对当前登录账号身份、目标主页路径与接口 `sec_uid` / 抖音号 / 规范化昵称，以及目标关注按钮实际文案，防止接口缓存或页面异步加载导致的误操作。
- **先大号后小号的两阶段落盘**：大号关注或确认已关注后立即写入本地台账，小号阶段出现网络波动或中止不会丢失大号已完成状态。
- **保护名单与异常锁定**：位于 `data/user_keep_list.json` 保留名单、`data/ban_latest.json` 受罚账号或作品可见性存在冲突的账号在各画廊均被锁定，不会被误导或误执行取关。
- **事务化快照发布**：在线更新在临时目录完成采集、嫌疑分析、主页核验与三套画廊生成并逐一校验通过后才原子替换正式文件；若中途失败或中断，原有快照与画廊保持完整，下次更新自动续传。
- **纯本地数据存储**：`data/` 保存本机账号绑定、台账、快照与导出报表，`profiles/` 保存独立浏览器登录态与画廊标记。两个目录均只保存在本机且仅供个人使用，请勿将真实账号数据提交或公开分享。

## 界面预览

<details><summary>展开查看迁移台账（示例数据）</summary>
<p><img src="assets/ledger.png" width="840" alt="迁移台账示例，包含已完成、受限保留与待处理记录"></p>
</details>

## 常见问题

- **首次启动为什么画廊不可用？**
  画廊基于本机大号快照生成。完成 `node scripts/setup.mjs main` 绑定并在工作台执行一次 **在线更新审阅数据…** 后即可打开；已有快照时可使用 **从快照重建** 离线重新生成。
- **本地数据与登录状态保存在哪里？**
  全部配置、快照、台账和报告位于 `data/`，浏览器登录态与画廊本地标记位于 `profiles/`。如需管理另一组抖音账号，请将程序解压到新的独立目录后重新绑定。
- **看到“身份不符”或遇到平台验证怎么办？**
  请先在 **任务记录** 查看具体报错，核实浏览器中登录的是否为绑定的预期账号；若触发平台滑块或频繁提示，请在对应账号的浏览器页面完成验证后再继续操作。
- **Chrome 安装在非默认路径如何指定？**
  将环境变量 `GUANXU_CHROME` 设为本机 `chrome.exe` 的完整路径后，从同一终端启动 `关序.exe` 或运行命令行脚本即可。

## 命令行与开发构建

除桌面端外，所有核心流程均可通过统一入口 `node scripts/run.mjs <命令>` 调用：

| 命令 | 用途 |
| --- | --- |
| `node scripts/run.mjs check [--browser]` | 运行只读项目自检（`--browser` 额外验证无头浏览器启动本地测试页） |
| `node scripts/run.mjs refresh` | 在线更新快照、处罚核验、三个画廊并联动刷新取关登记表 |
| `node scripts/run.mjs rebuild` | 基于现有 `data/snapshot_latest.json` 重新分析并生成三套画廊 |
| `node scripts/run.mjs gallery [review\|stale\|suspect\|all]` | 按当前核验结果重新生成指定或全部画廊 HTML |
| `node scripts/run.mjs open [review\|stale\|suspect]` | 启动绑定的审阅浏览器打开本地画廊（支持画廊内直连取关与主页复用） |
| `node scripts/run.mjs diff` | 对比最近两次完整快照并导出 `data/snapshot_changes.csv` |
| `node scripts/run.mjs preview <名单>` | 本地预览四列决定名单或 CSV 清单待处理条目 |
| `node scripts/run.mjs unfollow <名单> [--execute] [--limit N]` | 在线核对名单（加 `--execute` 执行取关，同名单支持 `--limit` 分批续跑） |
| `node scripts/run.mjs transfer` | 执行双账号增量迁移全流程（前置核对 → 合并 → 驱动 → 终验 → 汇总） |
| `node scripts/run.mjs reset-held [--include-protected]` | 重置台账中的可重试异常或挂起记录并清理旧错误备注 |
| `node scripts/run.mjs registry` | 拉取最新大号完整关注列表更新取关登记表并检测重新关注 |
| `node scripts/run.mjs accept-refollow --all` | 确认保留当前重关账号并将其从取关登记表与告警中移出 |

从源码构建与运行完整测试：

~~~powershell
git clone https://github.com/ElmaTony/douyin-follow-manager.git
cd douyin-follow-manager
npm ci
npm run qa
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File desktop/build.ps1
powershell.exe -NoProfile -STA -ExecutionPolicy RemoteSigned -File desktop/qa.ps1
node scripts/run.mjs check --browser
~~~

`npm run qa` 会依次执行离线回归测试、无头画廊内取关端到端测试与无头画廊交互测试（全部使用本地模拟账号与页面）；`desktop/qa.ps1` 在后台非激活窗口下验证 WPF 管理台全部核心交互。如需打包 Windows 分发压缩包与 SHA-256 校验清单，请运行 `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File desktop/package.ps1`。Playwright Core 的许可证与第三方声明随依赖一同提供。

关序是独立的开源桌面工具，与抖音官方无隶属关系。
