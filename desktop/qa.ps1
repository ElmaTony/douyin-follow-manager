# Run in a fresh STA PowerShell process after building the executable.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$root = Split-Path $PSScriptRoot -Parent
$assembly = [Reflection.Assembly]::LoadFrom((Join-Path $root '关序.exe'))
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
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('followdesk-qa-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($testDir)
function Save-Window([string]$filename) {
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
try {
    $window.Show()
    Wait-Ui { $window.FindName('LedgerCount').Text -match '^[\d,]+$' -and $window.FindName('Refresh').IsEnabled }
    Assert-Ui ($window.FindName('Rows').Items.Count -eq $expected.Count) ("Ledger count " + $window.FindName('Rows').Items.Count + " vs " + $expected.Count)
    Assert-Ui ($window.Title -eq '关序') 'Window title is incorrect'
    Assert-Ui ($null -ne $window.Icon -and [object]::ReferenceEquals($window.Icon,$window.FindName('BrandIcon').Source)) 'Header and title bar must share the application icon'
    $screen = Join-Path $testDir 'overview.png'
    Save-Window $screen
    $window.FindName('NavLedger').IsChecked = $true
    Save-Window (Join-Path $testDir 'ledger.png')
    $window.FindName('Search').Text = '__no_match__'
    Assert-Ui ($window.FindName('Rows').Items.Count -eq 0) 'Ledger search failed'
    $window.FindName('Search').Clear()
    $window.FindName('PendingOnly').IsChecked = $true
    $pending = @($expected | Where-Object {$_.alt_unfollow -ne 'done' -and $_.main_follow -ne 'skip_restricted'})
    Assert-Ui ($window.FindName('Rows').Items.Count -eq $pending.Count) 'Pending filter failed'
    $window.FindName('NavHome').IsChecked = $true
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
    Write-Output "PASS: dashboard, ledger search, pending filter, self-check, warning output, preview, invalid input, minimum size, child-process cancellation"
    Write-Output $screen
} finally {
    $window.Close()
}
