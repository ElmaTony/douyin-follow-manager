# Run in a fresh STA PowerShell process after building the executable.
param([switch]$KeepScreenshots)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$repoRoot = Split-Path $PSScriptRoot -Parent
$useFixture = !(Test-Path -LiteralPath (Join-Path $repoRoot 'data/ledger.json'))
$tempRoot = $null
$root = $repoRoot
$window = $null
$testDir = $null
try {
    if ($useFixture) {
        $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('guanxu-desktop-qa-' + [Guid]::NewGuid().ToString('N'))
        $null = [IO.Directory]::CreateDirectory($tempRoot)
        $null = [IO.Directory]::CreateDirectory((Join-Path $tempRoot 'desktop'))
        $null = [IO.Directory]::CreateDirectory((Join-Path $tempRoot 'scripts'))
        $dataDir = [IO.Directory]::CreateDirectory((Join-Path $tempRoot 'data')).FullName
        Copy-Item -LiteralPath (Join-Path $repoRoot '关序.exe') -Destination (Join-Path $tempRoot '关序.exe')
        Copy-Item -LiteralPath (Join-Path $repoRoot 'desktop/status.mjs') -Destination (Join-Path $tempRoot 'desktop/status.mjs')
        Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts') -File | Where-Object { $_.Name -notlike 'qa_*' } | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $tempRoot ('scripts/' + $_.Name))
        }
        $nmTarget = Join-Path $repoRoot 'node_modules'
        $nmLink = Join-Path $tempRoot 'node_modules'
        try {
            $null = New-Item -ItemType Junction -Path $nmLink -Target $nmTarget -ErrorAction Stop
        } catch {
            $null = [IO.Directory]::CreateDirectory($nmLink)
            Copy-Item -LiteralPath (Join-Path $nmTarget 'playwright-core') -Destination (Join-Path $nmLink 'playwright-core') -Recurse
        }
        $utf8 = [Text.UTF8Encoding]::new($false)
        $nowUtc = [DateTime]::UtcNow
        $nowIso = $nowUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
        $prevIso = $nowUtc.AddDays(-7).ToString('yyyy-MM-ddTHH:mm:ssZ')
        $nowSec = [int64][Math]::Floor(($nowUtc - [DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)).TotalSeconds)
        $staleSec = $nowSec - (75 * 86400)
        [IO.File]::WriteAllText((Join-Path $dataDir 'ledger.json'), '[
          {"idx":1,"sec_uid":"fx-done","nickname":"已迁示例","douyin_id":"fx_done","main_follow":"done","alt_unfollow":"done","note":""},
          {"idx":2,"sec_uid":"fx-rest","nickname":"受限示例","douyin_id":"fx_rest","main_follow":"skip_restricted","alt_unfollow":"","note":"账号受限"},
          {"idx":3,"sec_uid":"fx-skipnf","nickname":"原未关示例","douyin_id":"fx_skipnf","main_follow":"already","alt_unfollow":"skip_not_following","note":"小号原未关注"},
          {"idx":4,"sec_uid":"fx-idfail","nickname":"核对异常示例","douyin_id":"fx_idfail","main_follow":"id_check_fail","alt_unfollow":"","fail_count":3,"note":"重试3次仍失败"},
          {"idx":5,"sec_uid":"fx-todo","nickname":"待迁示例","douyin_id":"fx_todo","main_follow":"","alt_unfollow":"","note":""}
        ]', $utf8)
        [IO.File]::WriteAllText((Join-Path $dataDir 'snapshot_previous.json'), ('{"exported_at":"' + $prevIso + '","accounts":{"fx-a":{"sec_uid":"fx-a","nickname":"旧名作者甲","douyin_id":"fx_a","works":3,"followers":120,"times":[' + $staleSec + '],"captions":["水彩练习一","素描练习二"],"covers":[]}}}'), $utf8)
        [IO.File]::WriteAllText((Join-Path $dataDir 'snapshot_latest.json'), ('{"exported_at":"' + $nowIso + '","accounts":{"fx-a":{"sec_uid":"fx-a","nickname":"新名作者甲","douyin_id":"fx_a","works":4,"followers":130,"times":[' + $staleSec + '],"captions":["家常菜谱一","烘焙食材二"],"covers":[]},"fx-b":{"sec_uid":"fx-b","nickname":"新增作者乙","douyin_id":"fx_b","works":2,"followers":60,"times":[' + $staleSec + '],"captions":[],"covers":[]}}}'), $utf8)
        [IO.File]::WriteAllText((Join-Path $dataDir 'ban_latest.json'), '[{"sec_uid":"fx-a","nickname":"新名作者甲","status":"normal","secret":0,"works_fresh":4},{"sec_uid":"fx-b","nickname":"新增作者乙","status":"normal","secret":0,"works_fresh":2}]', $utf8)
        [IO.File]::WriteAllText((Join-Path $dataDir 'user_keep_list.json'), '{"keeps":[]}', $utf8)
        [IO.File]::WriteAllText((Join-Path $dataDir 'unfollow_registry.json'), '{"entries":{"fx-refollow":{"nickname":"曾取关示例","douyin_id":"fx_ref","last_seen":"2026-05-01","unfollowed_since":"2026-05-02","reason":"人工决定取关"}},"refollow_alerts":[{"sec_uid":"fx-refollow","nickname":"曾取关示例","current_nickname":"曾取关示例"}]}', $utf8)
        Push-Location $tempRoot
        try {
            $null = & node 'scripts/run.mjs' 'gallery' 'all'
            if ($LASTEXITCODE -ne 0) { throw 'Failed to generate fixture galleries for desktop QA' }
        } finally { Pop-Location }
        $root = $tempRoot
    }
    $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes((Join-Path $root '关序.exe')))
    $flags = [Reflection.BindingFlags]'Instance,NonPublic,Public'
    $desk = $assembly.GetType('FollowDesk.Desk').GetConstructors($flags)[0].Invoke([object[]]@([string]$root))
    $window = $desk.Window
    $window.WindowStartupLocation = 'Manual'
    $window.Left = -16000
    $window.Top = -16000
    $window.ShowActivated = $false
    $window.ShowInTaskbar = $false
    $dispatcher = [Windows.Threading.Dispatcher]::CurrentDispatcher
    [Threading.SynchronizationContext]::SetSynchronizationContext([Windows.Threading.DispatcherSynchronizationContext]::new($dispatcher))
    function Wait-Ui([scriptblock]$Condition) {
        $end = [DateTime]::UtcNow.AddSeconds(18)
        while (!( & $Condition )) {
            if ([DateTime]::UtcNow -gt $end) { throw ("GUI timed out: " + $window.FindName('Warnings').Text + ' / ' + $window.FindName('Output').Text) }
            $frame = [Windows.Threading.DispatcherFrame]::new()
            $null = $dispatcher.BeginInvoke([Windows.Threading.DispatcherPriority]::Background,[Action]{$frame.Continue = $false})
            [Windows.Threading.Dispatcher]::PushFrame($frame)
            Start-Sleep -Milliseconds 20
        }
    }
    function Click-Button([string]$Name) {
        $button = $window.FindName($Name)
        if (!$button.IsEnabled) { throw "Button is disabled: $Name" }
        $button.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Primitives.ButtonBase]::ClickEvent))
    }
    function Assert-Ui([bool]$Ok,[string]$Message) { if (!$Ok) { throw $Message } }
    $testDir = Join-Path (Join-Path $root 'data') ('.desktop-qa-' + [Guid]::NewGuid().ToString('N'))
    function Save-Window([string]$filename) {
        if (!$KeepScreenshots) { return }
        $window.UpdateLayout()
        $dispatcher.Invoke([Action]{},[Windows.Threading.DispatcherPriority]::ApplicationIdle)
        $window.UpdateLayout()
        $surface = $window.Content
        $image = [Windows.Media.Imaging.RenderTargetBitmap]::new([int]$surface.ActualWidth,[int]$surface.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32)
        $image.Render($surface)
        $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new()
        $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($image))
        $stream = [IO.File]::Create($filename)
        try { $encoder.Save($stream) } finally { $stream.Dispose() }
    }
    $expected = Get-Content -LiteralPath (Join-Path $root 'data/ledger.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $registryData = Get-Content -LiteralPath (Join-Path $root 'data/unfollow_registry.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $null = [IO.Directory]::CreateDirectory($testDir)

    $window.Show()
    Wait-Ui { $window.FindName('LedgerCount').Text -match '^[\d,]+$' -and $window.FindName('Refresh').IsEnabled }
    Assert-Ui ($window.FindName('Rows').Items.Count -eq $expected.Count) ("Ledger count " + $window.FindName('Rows').Items.Count + " vs " + $expected.Count)
    Assert-Ui ($window.Title -eq '关序') 'Window title is incorrect'
    Assert-Ui ($null -ne $window.Icon -and [object]::ReferenceEquals($window.Icon,$window.FindName('BrandIcon').Source)) 'Header and title bar must share the application icon'
    if ($registryData.refollow_alerts -and $registryData.refollow_alerts.Count -gt 0) {
        Assert-Ui ($window.FindName('Warnings').Text.Contains('重新出现在大号关注中')) 'Refollow alert warning is missing on dashboard'
        Assert-Ui ($window.FindName('AcceptRefollow').Visibility -eq 'Visible' -and $window.FindName('AcceptRefollow').IsEnabled) 'AcceptRefollow button should be visible and enabled when refollow alerts exist'
    }
    $screen = Join-Path $testDir 'overview.png'
    Save-Window $screen
    $window.FindName('NavLedger').IsChecked = $true
    Save-Window (Join-Path $testDir 'ledger.png')
    $window.FindName('Search').Text = '__no_match__'
    Assert-Ui ($window.FindName('Rows').Items.Count -eq 0) 'Ledger search failed'
    $window.FindName('Search').Clear()
    $window.FindName('PendingOnly').IsChecked = $true
    $pending = @($expected | Where-Object {
        $done = ($_.alt_unfollow -eq 'done') -or (($_.main_follow -in @('done','already')) -and ($_.alt_unfollow -eq 'skip_not_following'))
        $held = (!$done) -and (($_.main_follow -in @('skip_restricted','skip_protected','skip_unknown','id_check_fail')) -or ($_.alt_unfollow -eq 'skip_id_fail'))
        (!$done) -and (!$held)
    })
    Assert-Ui ($window.FindName('Rows').Items.Count -eq $pending.Count) 'Pending filter failed'
    if ($useFixture) {
        Assert-Ui ($window.FindName('ResetHeld').IsEnabled) 'ResetHeld button should be enabled when retryable held rows exist'
        Click-Button 'ResetHeld'
        Wait-Ui { $window.FindName('Status').Text -eq '重置异常挂起记录 · 已完成' -and $window.FindName('Refresh').IsEnabled }
        $window.FindName('NavLedger').IsChecked = $true
        Assert-Ui ($window.FindName('Rows').Items.Count -eq ($pending.Count + 1)) 'ResetHeld did not restore id_check_fail row to pending'
        Assert-Ui (!$window.FindName('ResetHeld').IsEnabled) 'ResetHeld should disable after resetting all retryable rows'
        $afterReset = Get-Content -LiteralPath (Join-Path $root 'data/ledger.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-Ui (($afterReset | Where-Object { $_.sec_uid -eq 'fx-idfail' }).main_follow -eq '') 'id_check_fail row was not cleared on disk'
    }
    $window.FindName('NavHome').IsChecked = $true
    $previousPath = Join-Path $root 'data/snapshot_previous.json'
    if ((Test-Path -LiteralPath $previousPath) -and (Get-Content -LiteralPath $previousPath -Encoding UTF8 -Raw | ConvertFrom-Json).exported_at) {
        Click-Button 'Compare'
        Wait-Ui { $window.FindName('Status').Text -eq '快照变化对比 · 已完成' -and $window.FindName('Refresh').IsEnabled }
        Assert-Ui ($window.FindName('Output').Text.Contains('snapshot_changes.csv')) 'Snapshot comparison did not produce a report'
        $window.FindName('NavHome').IsChecked = $true
    } else {
        Assert-Ui (!$window.FindName('Compare').IsEnabled) 'Comparison must wait for two snapshots'
    }
    if (!(Test-Path -LiteralPath (Join-Path $root 'data/snapshot_latest.json'))) {
        Assert-Ui (!$window.FindName('Rebuild').IsEnabled) 'Rebuild must wait for the first snapshot'
    }
    Click-Button 'Check'
    Wait-Ui { $window.FindName('Status').Text -match '项目自检 · (已完成|完成，有提醒)' -and $window.FindName('Refresh').IsEnabled }
    Assert-Ui ($window.FindName('Output').Text.Contains('自检报告')) 'CLI output is missing'
    Save-Window (Join-Path $testDir 'task-log.png')
    $window.FindName('NavActions').IsChecked = $true
    Save-Window (Join-Path $testDir 'actions.png')
    $list = Join-Path $testDir '带空格 & (测试).txt'
    [IO.File]::WriteAllText($list,"test-fixture-a" + [char]9 + "测试A" + [char]9 + "123" + [char]9 + "取关")
    $window.FindName('ListFile').Text = $list
    Click-Button 'Preview'
    Wait-Ui { $window.FindName('Status').Text -eq '本地名单预览 · 已完成' -and $window.FindName('Refresh').IsEnabled }
    Assert-Ui ($window.FindName('Output').Text.Contains('测试A')) 'Preview did not resolve the exact filename'
    [IO.File]::WriteAllText($list,'invalid file')
    Click-Button 'Preview'
    Wait-Ui { $window.FindName('Status').Text.Contains('失败') -and $window.FindName('Refresh').IsEnabled }
    Assert-Ui ($window.FindName('Output').Text.Contains('四列决定名单')) 'Failure reason is missing'
    $window.FindName('NavHome').IsChecked = $true
    $window.Width = $window.MinWidth
    $window.Height = $window.MinHeight
    $window.UpdateLayout()
    Save-Window (Join-Path $testDir 'overview-small.png')
    Assert-Ui ($window.FindName('Home').ViewportWidth -gt 470) 'Minimum window width is unusable'
    # Exercise cancellation against a harmless process tree inside the QA directory.
    $childScript = Join-Path $testDir 'tree.mjs'
    $childMarker = Join-Path $testDir 'child.pid'
    [IO.File]::WriteAllText($childScript,"import {spawn} from 'node:child_process'; import fs from 'node:fs'; const p=spawn(process.execPath,['-e','setInterval(()=>{},60000)']); fs.writeFileSync('child.pid',String(p.pid)); setInterval(()=>{},60000);")
    $runner = $assembly.GetType('FollowDesk.TaskRunner').GetConstructors($flags)[0].Invoke([object[]]@([string]$testDir))
    $console = [Delegate]::CreateDelegate([Action[string]],[Console].GetMethod('WriteLine',[type[]]@([string])))
    try {
        $task = $runner.Run([string[]]@('tree.mjs'),$console,$console)
        Wait-Ui { (Test-Path -LiteralPath $childMarker) -or $task.IsCompleted }
        Assert-Ui (Test-Path -LiteralPath $childMarker) 'Test worker did not start'
        $worker = [Diagnostics.Process]::GetProcessById([int]([IO.File]::ReadAllText($childMarker)))
        $runner.Stop()
        Wait-Ui { $task.IsCompleted }
        Assert-Ui ($task.Result -ne 0 -and $worker.WaitForExit(3000)) 'Stopped task left a worker running'
    } finally { $runner.Dispose() }
    $cancelArgs = [System.ComponentModel.CancelEventArgs]::new($true)
    $stopMethod = $desk.GetType().GetMethod('Stop', $flags)
    $null = $stopMethod.Invoke($desk, [object[]]@($true, $cancelArgs))
    Assert-Ui (!$cancelArgs.Cancel) 'Stop during Window.Closing when idle should clear Cancel without calling Close()'
    Write-Output "PASS: dashboard, refollow alerts, ledger search, pending filter, reset-held, self-check, warning output, preview, invalid input, minimum size, child-process cancellation"
    if ($KeepScreenshots -and !$useFixture) { Write-Output $screen }
} finally {
    try { if ($null -ne $window) { $window.Close() } } finally {
        if ($null -ne $testDir -and (Test-Path -LiteralPath $testDir)) {
            foreach ($name in '带空格 & (测试).txt','tree.mjs','child.pid') {
                $file = Join-Path $testDir $name
                if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -ErrorAction Stop }
            }
            if (!(Get-ChildItem -LiteralPath $testDir -Force)) { [IO.Directory]::Delete($testDir) }
        }
        if ($null -ne $tempRoot -and (Test-Path -LiteralPath $tempRoot)) {
            $junction = Join-Path $tempRoot 'node_modules'
            if ((Test-Path -LiteralPath $junction) -and ((Get-Item -LiteralPath $junction -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                [IO.Directory]::Delete($junction)
            }
            [IO.Directory]::Delete($tempRoot, $true)
        }
    }
}
