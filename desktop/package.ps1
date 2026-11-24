# Build from a source checkout; include only the public runtime and documentation.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    & (Join-Path $PSScriptRoot 'build.ps1')
    $manifest = Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json
    $version = $manifest.version
    $module = Get-Content -Raw -LiteralPath 'node_modules/playwright-core/package.json' | ConvertFrom-Json
    if ($module.version -ne $manifest.dependencies.'playwright-core') {
        throw 'Run npm ci to restore the locked dependencies before packaging.'
    }
    $name = "douyin-follow-manager-$version-windows-x64.zip"
    $outDir = [IO.Directory]::CreateDirectory((Join-Path $root 'dist')).FullName
    $output = Join-Path $outDir $name
    $files = @(
        '关序.exe','README.md','README_EN.md','CHANGELOG.md','assets/dashboard.png','assets/ledger.png',
        'desktop/desk.svg','desktop/status.mjs','package.json','package-lock.json','node_modules/playwright-core',
        'scripts/account-checks.mjs', 'scripts/batch_unfollow.mjs', 'scripts/build_suspects_latest.mjs',
    'scripts/topic-change.mjs','scripts/recent-works.mjs','scripts/compare_snapshots.mjs','scripts/core.mjs', 'scripts/doctor.mjs', 'scripts/driver2.mjs',
    'scripts/final_verify.mjs', 'scripts/finalize.mjs', 'scripts/gallery-client.js','scripts/gallery-profiles.js',
    'scripts/gallery-lightbox.js', 'scripts/gallery.css', 'scripts/gallery.mjs',
    'scripts/gen_review_gallery.mjs', 'scripts/gen_stale_gallery.mjs', 'scripts/gen_suspect_gallery.mjs',
    'scripts/lib.mjs', 'scripts/local-state.mjs', 'scripts/merge_incremental.mjs',
    'scripts/open_review_env.mjs','scripts/profile-tab.mjs', 'scripts/preflight_incremental.mjs', 'scripts/prep_suspect_unfollow.mjs',
    'scripts/qa_gallery.mjs', 'scripts/qa_safety.mjs', 'scripts/read_suspect_state.mjs',
    'scripts/rebuild_latest.mjs', 'scripts/refresh_review.mjs', 'scripts/run.mjs',
    'scripts/scan_bans_latest.mjs', 'scripts/setup.mjs', 'scripts/snapshot_main.mjs',
    'scripts/sync_marks.mjs', 'scripts/transfer.mjs', 'scripts/unfollow_list.mjs',
    'scripts/update_registry.mjs'
    )
    foreach ($file in $files) { if (!(Test-Path -LiteralPath $file)) { throw "Missing package file: $file" } }
    Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
    $tmp = Join-Path $outDir ('.pack-' + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        $zip = [IO.Compression.ZipFile]::Open($tmp,'Create',[Text.Encoding]::UTF8)
        try {
            foreach ($entry in $files) {
                $items = if (Test-Path -LiteralPath $entry -PathType Container) {
                    Get-ChildItem -LiteralPath $entry -File -Recurse -Force
                } else { Get-Item -LiteralPath $entry }
                foreach ($item in $items) {
                    $nameInZip = $item.FullName.Substring($root.Length+1).Replace('\\','/')
                    $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$item.FullName,$nameInZip,'Optimal')
                }
            }
        } finally { $zip.Dispose() }
        if ([IO.File]::Exists($output)) { [IO.File]::Replace($tmp,$output,[NullString]::Value) }
        else { [IO.File]::Move($tmp,$output) }
    } finally { if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) } }
    $digest = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $outDir 'SHA256SUMS.txt'),($digest + '  ' + $name + [Environment]::NewLine),[Text.Encoding]::ASCII)
    Write-Output $output
} finally { Pop-Location }
