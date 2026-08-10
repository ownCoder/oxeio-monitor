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
    [string]$Version = '0.1.0',
    [string]$Configuration = 'Release',
    [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $here
$publishDir = Join-Path $here 'obj\publish'
$outDir = Join-Path $here 'bin'
$msi = Join-Path $outDir 'oXeioAgent.msi'

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
