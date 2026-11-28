<div align="center">
  <img src="desktop/desk.svg" width="72" alt="Guanxu icon">
  <h1>Guanxu · Douyin Follow Manager</h1>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><strong>Safely review, organize and transfer your own Douyin follows on Windows.</strong></p>
  <p>Collect destination snapshots and recent posts, triage low-activity, inactive or renamed accounts across three galleries, unfollow directly in-gallery or run two-account incremental transfers.</p>
  <p><a href="#download">Download v0.5.4</a> · <a href="#quick-start">Quick start</a> · <a href="#workflows">Workflows</a> · <a href="#safety--data-integrity">Safety &amp; data integrity</a> · <a href="#faq">FAQ</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="https://github.com/ElmaTony/douyin-follow-manager/issues">Issues</a></p>
  <img src="assets/dashboard.png" width="840" alt="Dashboard with a fictional follow snapshot and three review galleries">
  <p><sub>All accounts, counts and migration results shown here are fictional. The application interface is in Chinese.</sub></p>
</div>

## Download

| Platform | Package | Requirements |
| --- | --- | --- |
| Windows x64 | [Windows ZIP](https://github.com/ElmaTony/douyin-follow-manager/releases/download/v0.5.4/douyin-follow-manager-0.5.4-windows-x64.zip) · [SHA-256 checksums](https://github.com/ElmaTony/douyin-follow-manager/releases/download/v0.5.4/SHA256SUMS.txt) | Windows 10/11 x64, Node.js 20+, Google Chrome and .NET Framework 4.8 with WPF |

Extract the entire ZIP to a writable folder. It bundles the compiled `关序.exe` desktop app, all Node.js scripts and the Playwright Core dependency. Source archives and previous releases are available on the [Releases page](https://github.com/ElmaTony/douyin-follow-manager/releases).

## Overview

| View | What it does |
| --- | --- |
| **Dashboard** | Shows the latest destination snapshot timestamp and count, migration progress, held entries, unfollow register count, self-check summary and re-follow alerts. |
| **Review galleries** | Generates three local HTML galleries: low posts (&lt; 20), inactive (&gt; 30 days) and name/caption-topic shifts, with a cover lightbox, cross-gallery sync and in-gallery unfollow execution. |
| **Migration ledger** | Search accounts by nickname, Douyin ID, status label or note, filter pending work and reset retryable held rows in one click. |
| **Account actions** | Preview, verify and batch-unfollow imported TXT/TSV/CSV lists, run two-account incremental transfers, and refresh or acknowledge the unfollow register. |
| **Task log** | Stream live task output, warnings, failure details and diagnostic reports, with safe cancellation for running tasks and browsers. |

## Quick start

1. Install [Node.js](https://nodejs.org/) (20+) and [Google Chrome](https://www.google.com/chrome/), then unpack the Windows ZIP into a writable directory.
2. Open PowerShell in that directory and run the first command to sign in and bind your **destination (main) account** for review. Only run the second command if you plan to transfer follows from a separate **source (alt) account**.

   ~~~powershell
   node scripts/setup.mjs main
   node scripts/setup.mjs alt
   ~~~

3. Launch `关序.exe` and select **在线更新审阅数据…** to fetch the destination following list, recent visible works and profile status, generate all three review galleries and sync the unfollow register (interrupted runs resume within 6 hours).
4. Open any gallery from the dashboard, mark authors as **待取关** on cards or in the cover viewer, then open **处理待取关** to inspect the deduplicated queue across all three galleries and confirm execution directly in the background.

## Workflows

### Gallery review &amp; batch unfollows

- **Multi-criteria filtering**: Combine **只看本轮变化** (changes since the previous snapshot), **多画廊命中**, **未标记 · 无封面**, work-count buckets (`0`, `1–5`, `6–19`), completed-day inactivity tiers (`31–90`, `91–180`, `181+`, or pending activity) and rename/topic-shift filters. Sort by default grouping, longest inactivity or follower count, and search across current/former nicknames, Douyin IDs and post captions.
- **Cross-gallery sync &amp; position memory**: Decisions, undo history (up to 50 edits per tab per snapshot) and profile delivery states stay synchronized across all three galleries. Jumping to another gallery for a specific author preserves a return breadcrumb and restores your previous scroll position.
- **Continuous lightbox review**: Zoom with the mouse wheel, pan while zoomed, open original video/note links, skip an author temporarily without marking, or undo and jump back to the exact work. Marking automatically advances to the next unmarked author with a cover.
- **Profile browsing &amp; exports**: Open 1 or 5 profiles per batch; desktop-launched galleries can enable **复用主页标签页** to reuse one profile tab (Ctrl-click or middle-click opens a separate comparison tab). Click **对比上次快照** on the dashboard to export `data/snapshot_changes.csv`, or copy/download 4-column decision lists by scope (**当前结果**, **整个画廊** or **三个画廊已标记**).
- **In-gallery &amp; file-based unfollows**: Unchecking an author in the confirmation dialog defers them for the same snapshot and decision; unresolved items can be retried individually, while verified unfollows go straight into the local register. Existing TXT/TSV/CSV files can also be imported under **账号操作 → 从文件取关** (local preview → dry-run check → confirmed execution, with automatic skipping of already-completed rows when running the same file in `--limit` batches).

### Incremental migration &amp; unfollow register

- **Four-stage transfer pipeline**: Running **开始增量迁移…** executes `preflight` (verifies both account bindings and total following count) → `merge` (records `former_nicknames` on renames and warns on register hits) → `driver` (rate-limited batches with cooldowns) → `final_verify` &amp; `finalize` (writes `data/crosscheck.csv`).
- **Destination-first &amp; mutual-follow support**: Handles both one-way (`follow_status=1`) and mutual (`follow_status=2`) follows, persisting destination completion immediately before touching the source account. Isolated restricted or failed rows are held without blocking subsequent batches, platform verification/rate-limit prompts pause immediately, and retryable rows can be queued again via **迁移台账 → 重置异常项**.
- **Unfollow register &amp; re-follow handling**: Snapshot refreshes and registry updates compare dated complete following lists to populate `data/unfollow_registry.json`, blocking accidental destination re-follows during future migrations. When an intentional re-follow triggers a dashboard alert, click **确认重关并移出登记…** under **账号操作 → 取关登记** to clear the alert and entry; authors in `data/user_keep_list.json` are automatically exempted from re-follow warnings.

## Safety &amp; data integrity

- **Triple identity &amp; button-text guards**: Before any follow or unfollow click, the runner verifies the signed-in owner, profile URL/API `sec_uid`, Douyin ID, normalized nickname and the live button text to prevent stale-cache or mis-targeted toggles.
- **Two-phase persistence**: Destination follow completions are written to `data/ledger.json` immediately so source-side network errors or cancellations never lose destination progress.
- **Protected &amp; uncertain locks**: Authors in `data/user_keep_list.json`, penalized accounts in `data/ban_latest.json` and accounts with conflicting/insufficient work visibility are locked across all galleries and skipped by unfollow execution.
- **Transactional snapshot publishing**: Online updates stage collection, analysis, profile verification and all three galleries in a temporary workspace, verifying SHA-256 checksums before atomically replacing live files. Interrupted publishes recover cleanly on the next run.
- **Local-only storage**: `data/` stores bindings, snapshots, ledgers and reports; `profiles/` stores isolated browser sessions and gallery marks. Keep both folders private and never publish real account data.

## Preview

<details><summary>Migration ledger with fictional accounts</summary>
<p><img src="assets/ledger.png" width="840" alt="Sample ledger with completed, restricted and pending rows"></p>
</details>

## FAQ

- **Why are the galleries unavailable on first launch?**
  Galleries are generated from your own destination snapshot. Bind the main account with `node scripts/setup.mjs main` and run **在线更新审阅数据…** once. Existing snapshots can be regenerated offline with **从快照重建**.
- **Where are my data and browser sessions stored?**
  All local state and reports live in `data/`, and dedicated Chromium sessions live in `profiles/`. To manage a separate pair of accounts, extract the app into a fresh directory and bind again.
- **What if I see an identity mismatch or platform verification prompt?**
  Check **任务记录** to verify the browser is signed in to the expected bound account, and complete any required verification in the official Douyin web view before retrying.
- **How do I point Guanxu to a custom Chrome installation?**
  Set the `GUANXU_CHROME` environment variable to the full path of `chrome.exe` and launch `关序.exe` or the CLI from that same terminal.

## CLI &amp; development

All core operations are also exposed via `node scripts/run.mjs <command>`:

| Command | Description |
| --- | --- |
| `node scripts/run.mjs check [--browser]` | Run read-only diagnostics (`--browser` also launches headless Chrome on a local test page) |
| `node scripts/run.mjs refresh` | Collect snapshot, verify profiles, rebuild galleries and sync the unfollow register |
| `node scripts/run.mjs rebuild` | Re-run analysis, verification and gallery generation from `data/snapshot_latest.json` |
| `node scripts/run.mjs gallery [review\|stale\|suspect\|all]` | Regenerate one or all gallery HTML files from local data |
| `node scripts/run.mjs open [review\|stale\|suspect]` | Launch the bound review browser for local galleries (enables in-gallery unfollows and tab reuse) |
| `node scripts/run.mjs diff` | Compare the latest two snapshots and export `data/snapshot_changes.csv` |
| `node scripts/run.mjs preview <list>` | Preview eligible targets from a 4-column decision file or CSV locally |
| `node scripts/run.mjs unfollow <list> [--execute] [--limit N]` | Check or execute unfollows for an imported list (supports resumable `--limit` batches) |
| `node scripts/run.mjs transfer` | Run the full two-account incremental transfer workflow |
| `node scripts/run.mjs reset-held [--include-protected]` | Reset retryable held ledger entries to pending and clear stale error notes |
| `node scripts/run.mjs registry` | Fetch the full main following list to update the unfollow register and re-follow alerts |
| `node scripts/run.mjs accept-refollow --all` | Acknowledge current re-follows and remove them from the unfollow register |

Build and run the full automated test suite from source:

~~~powershell
git clone https://github.com/ElmaTony/douyin-follow-manager.git
cd douyin-follow-manager
npm ci
npm run qa
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File desktop/build.ps1
powershell.exe -NoProfile -STA -ExecutionPolicy RemoteSigned -File desktop/qa.ps1
node scripts/run.mjs check --browser
~~~

`npm run qa` runs offline safety tests, headless in-gallery unfollow end-to-end tests and headless gallery UI tests using simulated accounts and pages; `desktop/qa.ps1` exercises the WPF dashboard in an inactive background window. Run `desktop/package.ps1` in Windows PowerShell to produce the release ZIP and `SHA256SUMS.txt`. Playwright Core includes its license and third-party notices.

Guanxu is an independent desktop tool and is unaffiliated with Douyin.
