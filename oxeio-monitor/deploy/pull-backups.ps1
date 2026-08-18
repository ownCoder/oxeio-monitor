<#
    R5 · G39 — ব্যাকআপ **অফিসের PC-তে টেনে আনা**।

    ⭐⭐ কেন এই দ্বিতীয় পথটা: `offsite-backup.sh` (rclone) সবচেয়ে ভালো,
    কিন্তু তার জন্য একটা ক্লাউড অ্যাকাউন্ট ও তার ক্রেডেনশিয়াল লাগে। এই
    স্ক্রিপ্টের জন্য **নতুন কিছুই লাগে না** — যে SSH কী দিয়ে আপনি এমনিতেই
    সার্ভারে ঢোকেন, সেটাই যথেষ্ট। তাই "কপি একটাই মেশিনে" ঝুঁকিটা আজই কাটে,
    ক্লাউড ঠিক করার জন্য অপেক্ষা না করে।

    ⚠️⚠️ **এটা rclone-এর বিকল্প নয়, পরিপূরক।** ঘরের PC আর সার্ভার একই
    শহরে; আগুন-বন্যা-চুরিতে দুটোই যেতে পারে। ক্লাউড রিমোট বসানোর পরও এটা
    চালু রাখা যায় — দুই জায়গায় কপি থাকা কখনো খারাপ নয়।

    ⭐ ফাইলগুলো **আগে থেকেই এনক্রিপটেড** (AES-256-CBC)। তাই ল্যাপটপ
    হারালেও কারো ঘণ্টা/বেতন/স্ক্রিনশট পড়া যায় না।
    ⚠️ কিন্তু এর মানে **পাসফ্রেজ হারালে ব্যাকআপও হারাল** — `BACKUP_PASSPHRASE`
    সার্ভারের বাইরে আলাদা করে রাখা আপনার কাজ, আর সেটা এই স্ক্রিপ্টের বাইরে।

    চালানো:
        powershell -ExecutionPolicy Bypass -File deploy\pull-backups.ps1

    রোজ নিজে থেকে চালাতে (একবার, আপনার নিজের অ্যাকাউন্টে):
        $s = "$PWD\oxeio-monitor\deploy\pull-backups.ps1"
        schtasks /create /tn "oXeio backup pull" /sc daily /st 21:30 `
                 /tr "powershell -ExecutionPolicy Bypass -File `"$s`""
#>

[CmdletBinding()]
param(
    # ⚠️ ডিফল্টগুলো এই সার্ভারের — অন্য কোথাও চালালে প্যারামিটারে দিন
    [string]$ServerHost = '107.167.94.222',
    [int]$Port = 2222,
    [string]$User = 'root',
    [string]$KeyPath = "$HOME\.ssh\oxeio",
    [string]$RemoteDir = '/opt/oxeio/oxeio-monitor/.data/backups',

    # ⭐ ডিফল্টে ব্যবহারকারীর নিজের ফোল্ডারে — Documents নয়, কারণ ওটা
    #    প্রায়ই OneDrive-এ সিঙ্ক হয়, আর ব্যাকআপ নিজে থেকে ক্লাউডে যাওয়া
    #    একটা সচেতন সিদ্ধান্ত হওয়া উচিত, দুর্ঘটনা নয়।
    [string]$LocalDir = "$HOME\oXeio-backups",

    # স্থানীয় কপি কত সপ্তাহ রাখা হবে (০ = কিছুই ছাঁটা হবে না)
    [int]$KeepWeeks = 8
)

$ErrorActionPreference = 'Stop'

function Say  { param($m) Write-Host "   [ok] $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "   [!] $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "`n[x] $m`n" -ForegroundColor Red; exit 1 }

Write-Host "`n-- R5 - backup pull --" -ForegroundColor Cyan

# ── ১· যা ছাড়া চলবে না ──────────────────────────────────────────────────────
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Die 'ssh পাওয়া গেল না (Windows-এ OpenSSH ক্লায়েন্ট চালু করুন)'
}
if (-not (Test-Path $KeyPath)) { Die "SSH কী নেই: $KeyPath" }

if (-not (Test-Path $LocalDir)) {
    New-Item -ItemType Directory -Path $LocalDir | Out-Null
    Say "ফোল্ডার তৈরি: $LocalDir"
}

$ssh = @('-i', $KeyPath, '-p', "$Port", '-o', 'ConnectTimeout=20',
         '-o', 'BatchMode=yes', "$User@$ServerHost")

# ── ২· সার্ভারে কী কী আছে ───────────────────────────────────────────────────
#
# ⚠️ `ls` নয়, `find -printf` — নামের মধ্যে ফাঁকা থাকলে `ls`-এর আউটপুট
#    ভেঙে যেত। এখানে নাম নিরাপদ, তবু অভ্যাসটা ঠিক রাখা।
$remoteList = & ssh @ssh "find '$RemoteDir' -maxdepth 1 -type f -printf '%f\n' | sort" 2>&1
if ($LASTEXITCODE -ne 0) { Die "সার্ভারে পৌঁছানো গেল না — $remoteList" }

$remote = @($remoteList | Where-Object { $_ -match '\.(dump\.enc|sha256|txt)$' })
if ($remote.Count -eq 0) { Die "সার্ভারে একটাও ব্যাকআপ ফাইল নেই ($RemoteDir)" }

$dumps = @($remote | Where-Object { $_ -like '*.dump.enc' })
Say "সার্ভারে $($dumps.Count) টা ডাম্প, মোট $($remote.Count) টা ফাইল"

# ── ৩· শুধু যেগুলো এখানে নেই ─────────────────────────────────────────────────
#
# ⭐ বারবার চালানো নিরাপদ — যা আছে তা আবার নামানো হয় না, তাই দিনে
#    কয়েকবার চালালেও খরচ প্রায় শূন্য।
$missing = @($remote | Where-Object { -not (Test-Path (Join-Path $LocalDir $_)) })

if ($missing.Count -eq 0) {
    Say 'নতুন কিছু নেই — সব কপি ইতিমধ্যেই এখানে'
} else {
    Write-Host "   নামানো হচ্ছে: $($missing.Count) টা ফাইল" -ForegroundColor DarkGray
    foreach ($f in $missing) {
        # ⚠️ scp-র রিমোট পথ কোট করা — নইলে ফাঁকা থাকা পাথে ভাঙত
        & scp -i $KeyPath -P $Port -o ConnectTimeout=20 -o BatchMode=yes `
              "${User}@${ServerHost}:${RemoteDir}/${f}" (Join-Path $LocalDir $f) | Out-Null
        if ($LASTEXITCODE -ne 0) { Die "নামানো ব্যর্থ: $f" }
    }
    Say "$($missing.Count) টা নতুন ফাইল নামানো হয়েছে"
}

# ── ৪· ⭐⭐ যাচাই — যে ব্যাকআপ পরীক্ষা করা হয়নি, সেটা ব্যাকআপ নয়, অনুমান ─────
#
# ⚠️⚠️ এই ধাপটাই এই স্ক্রিপ্টের আসল কারণ। ফাইল নেমেছে মানে ফাইল **অক্ষত**
#    নয় — অর্ধেক নামা ডাম্প ডিস্কে দিব্যি বসে থাকে, আর ঠিক যেদিন দরকার
#    সেদিন খুলতে গিয়ে ধরা পড়ে। প্রতিটা ডাম্পের পাশে সার্ভারের দেওয়া
#    `.sha256` আছে — মিলিয়ে দেখা হয় এখানেই।
$verified = 0; $bad = @()
foreach ($d in $dumps) {
    $local = Join-Path $LocalDir $d
    $sumFile = Join-Path $LocalDir "$d.sha256"
    if (-not (Test-Path $local) -or -not (Test-Path $sumFile)) { continue }

    # ধাঁচ: "<hash>  <filename>"
    $expected = ((Get-Content $sumFile -First 1) -split '\s+')[0]
    $actual = (Get-FileHash $local -Algorithm SHA256).Hash.ToLower()

    if ($expected -eq $actual) { $verified++ }
    else {
        $bad += $d
        # ⭐ নষ্ট কপি **মুছে দেওয়া হয়** — নইলে পরের রানে "আছে" দেখে
        #    আবার নামানো হতো না, আর ভাঙা ফাইলটাই চিরকাল থেকে যেত।
        Remove-Item $local -Force
    }
}

if ($bad.Count -gt 0) {
    Warn "$($bad.Count) টা ফাইলের হ্যাশ মেলেনি — মুছে ফেলা হয়েছে, পরের রানে আবার নামবে:"
    $bad | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow }
}
Say "$verified টা ডাম্পের হ্যাশ মিলেছে"

# ── ৫· পুরোনো স্থানীয় কপি ছাঁটা ─────────────────────────────────────────────
#
# ⚠️ ছাঁটাই কেবল **এখানে**, সার্ভারে নয় — আর কখনো "সার্ভারে নেই বলে
#    এখানেও মুছি" নিয়মে নয়। সার্ভারের ডিস্ক মুছে গেলে ওই নিয়ম ঠিক সেই
#    মুহূর্তে শেষ কপিটাও মুছে দিত (`offsite-backup.sh`-এর copy-vs-sync
#    সিদ্ধান্তের একই যুক্তি)।
if ($KeepWeeks -gt 0) {
    $cutoff = (Get-Date).AddDays(-7 * $KeepWeeks)
    $old = @(Get-ChildItem $LocalDir -File |
             Where-Object { $_.LastWriteTime -lt $cutoff -and $_.Name -like '*.dump.enc*' })
    if ($old.Count -gt 0) {
        $old | Remove-Item -Force
        Say "$($old.Count) টা পুরোনো ফাইল ছাঁটা হয়েছে ($KeepWeeks সপ্তাহের বেশি)"
    }
}

# ── ৬· ফল ───────────────────────────────────────────────────────────────────
$localDumps = @(Get-ChildItem $LocalDir -Filter '*.dump.enc' -File)
$size = [math]::Round((($localDumps | Measure-Object Length -Sum).Sum / 1MB), 1)
$newest = $localDumps | Sort-Object Name | Select-Object -Last 1

Write-Host ''
Write-Host "[ok] এখানে $($localDumps.Count) টা ডাম্প - $size MB" -ForegroundColor Green
if ($newest) { Write-Host "     সবশেষ: $($newest.Name)" -ForegroundColor Green }
Write-Host "     ঘর: $LocalDir" -ForegroundColor DarkGray
Write-Host ''

# ⚠️ হ্যাশ না মিললে exit code শূন্য নয় — scheduled task-এ ব্যর্থতাটা
#    যেন চোখে পড়ে, নইলে "রোজ চলছে" দেখেই সবাই নিশ্চিন্ত থাকত।
if ($bad.Count -gt 0) { exit 2 }
