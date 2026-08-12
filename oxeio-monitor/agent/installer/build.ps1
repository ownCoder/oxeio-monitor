<#
.SYNOPSIS
  oXeio এজেন্টের MSI বানায় (H03)।

.DESCRIPTION
  তিনটে ধাপ:
    ১· দুটো প্রজেক্ট **একই ফোল্ডারে** self-contained publish
    ২· wix build — ফাইলের তালিকা WiX নিজেই <Files Include> দিয়ে বানায়

  ⚠️ দুটো প্রজেক্ট একই ফোল্ডারে publish করা হয় ইচ্ছাকৃতভাবে — আলাদা করলে
     .NET রানটাইম দুবার বসত (৩৭৯ MB বনাম ১৯৯ MB)।

.EXAMPLE
  pwsh installer/build.ps1
  pwsh installer/build.ps1 -Version 0.2.0
#>
[CmdletBinding()]
param(
    # ⚠️ ডিফল্ট **হার্ডকোড করা নয়** — Directory.Build.props থেকে পড়া হয়
    #    (নিচে)। আগে এখানে '0.1.0' লেখা ছিল আর Program.cs-এও আলাদা করে
    #    একই সংখ্যা; দুটো আলাদা হলে MSI এক ভার্সন বসাত আর এজেন্ট
    #    heartbeat-এ আরেকটা বলত, ফলে H04 চিরকাল একই আপডেট অফার করত।
    [string]$Version,
    [string]$Configuration = 'Release',
    [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $here
$publishDir = Join-Path $here 'obj\publish'
$outDir = Join-Path $here 'bin'
$msi = Join-Path $outDir 'oXeioAgent.msi'

# ── ভার্সন — একমাত্র উৎস Directory.Build.props ───────────────────────────────
# ⚠️ হাতে -Version দিলে সেটাই জেতে (হটফিক্স বিল্ডের জন্য), কিন্তু তখন
#    assembly-র ভার্সন আর MSI-র ভার্সন আলাদা হয়ে যাবে — নিচে সতর্ক করা হয়।
$propsPath = Join-Path $agentRoot 'Directory.Build.props'
$propsVersion = ([xml](Get-Content $propsPath)).Project.PropertyGroup.Version

if (-not $propsVersion) {
    throw "Directory.Build.props-এ <Version> পাওয়া গেল না: $propsPath"
}

if (-not $Version) {
    $Version = $propsVersion
} elseif ($Version -ne $propsVersion) {
    Write-Warning @"
MSI বসবে $Version দিয়ে, কিন্তু এজেন্টের assembly বলবে $propsVersion।
⚠️ সার্ভার heartbeat-এর ভার্সন দেখেই আপডেট অফার করবে কি না ঠিক করে (G59) —
   দুটো আলাদা হলে ওই মেশিনকে একই আপডেট বারবার অফার করা হবে।
   Directory.Build.props-এ <Version> বদলে আবার চালানোই ঠিক পথ।
"@
}

Write-Host "   version: $Version" -ForegroundColor DarkGray

Write-Host '── ১· publish ────────────────────────────────' -ForegroundColor Cyan

if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
New-Item -ItemType Directory -Path $publishDir -Force | Out-Null

foreach ($project in 'oXeio.Agent', 'oXeio.Watchdog') {
    Write-Host "   $project"
    # ⚠️ DebugType=none — নইলে libSkiaSharp.pdb একাই ৮৬ MB যোগ করে।
    #    ডিবাগ সিম্বল স্টাফের PC-তে যাওয়ার কোনো কারণ নেই।
    & dotnet publish (Join-Path $agentRoot "src\$project") `
        -c $Configuration -r $Runtime --self-contained true `
        -p:DebugType=none -p:DebugSymbols=false `
        -o $publishDir --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw "$project publish ব্যর্থ" }
}

Get-ChildItem $publishDir -Filter *.pdb | Remove-Item -Force

$size = [math]::Round((Get-ChildItem $publishDir -Recurse | Measure-Object Length -Sum).Sum / 1MB, 1)
$count = (Get-ChildItem $publishDir -Recurse -File).Count
Write-Host "   $count ফাইল · $size MB"

Write-Host '── ২· wix build ─────────────────────────────' -ForegroundColor Cyan

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

& wix build `
    (Join-Path $here 'Package.wxs') `
    -arch x64 `
    -d "PublishDir=$publishDir" `
    -d "Version=$Version" `
    -o $msi

if ($LASTEXITCODE -ne 0) { throw 'wix build ব্যর্থ' }

$msiSize = [math]::Round((Get-Item $msi).Length / 1MB, 1)
Write-Host ''
Write-Host "✅ $msi · $msiSize MB" -ForegroundColor Green
Write-Host ''
Write-Host 'সাইলেন্ট ইনস্টল:' -ForegroundColor Yellow
Write-Host '  msiexec /i oXeioAgent.msi /qn SERVERURL="https://oxeio.office.local" ENROLLCODE="OXEIO-XXXXXXXX"'
