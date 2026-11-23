param([string]$OutputFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '关序.exe'))
$ErrorActionPreference = 'Stop'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (!(Test-Path -LiteralPath (Join-Path $framework 'csc.exe'))) {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
}
$compiler = Join-Path $framework 'csc.exe'
$target = [IO.Path]::GetFullPath($OutputFile)
$buildExe = Join-Path ([IO.Path]::GetDirectoryName($target)) ('.followdesk-' + [Guid]::NewGuid().ToString('N') + '.exe')
$references = 'System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll','WPF\WindowsBase.dll','WPF\PresentationCore.dll','WPF\PresentationFramework.dll'
$iconFile = Join-Path $PSScriptRoot 'desk.ico'
$options = @('/nologo',('/win32icon:' + $iconFile),('/resource:' + $iconFile + ',FollowDesk.Icon'),'/target:winexe','/optimize+','/codepage:65001',("/out:" + $buildExe),("/resource:" + (Join-Path $PSScriptRoot MainWindow.xaml) + ',FollowDesk.Window'),('/resource:' + (Join-Path $PSScriptRoot 'review-art.png') + ',FollowDesk.ReviewArt'))
foreach ($name in $references) { $options += '/reference:' + (Join-Path $framework $name) }
try {
    & $compiler @options (Join-Path $PSScriptRoot Desk.cs) (Join-Path $PSScriptRoot TaskRunner.cs)
    if ($LASTEXITCODE -ne 0) { throw 'GUI compilation failed.' }
    if ([IO.File]::Exists($target)) { [IO.File]::Replace($buildExe, $target, [NullString]::Value) }
    else { [IO.File]::Move($buildExe,$target) }
    Write-Output $target
} finally {
    if ([IO.File]::Exists($buildExe)) { [IO.File]::Delete($buildExe) }
}
