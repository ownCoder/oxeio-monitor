#Requires -Version 5.1
<#
.SYNOPSIS
    oXeio এজেন্টের জন্য Microsoft Defender-এ ছাড় (exclusion) বসায় (H09)।

.DESCRIPTION
    এজেন্ট সারাদিন ধরে ছোট ছোট ফাইল লেখে — প্রতি ৫ মিনিটে .webp স্ক্রিনশট,
    আর SQLite আউটবক্সে অবিরাম INSERT। Defender-এর real-time scanning প্রতিটা
    লেখায় ঢুকে পড়ে, ফলে CPU খরচ হয় আর মাঝে মাঝে ফাইল লক হয়ে এজেন্টের
    লেখা ব্যর্থ হয়।

    ┌──────────────────────────────────────────────────────────────────────┐
    │ ⚠️  এটা একটা নিরাপত্তা-সিদ্ধান্ত, নিছক পারফরম্যান্স টিউনিং নয়।       │
    │                                                                      │
    │ অ্যান্টিভাইরাসে ছাড় দেওয়া মানে ওই জায়গাটুকু আর পাহারায় থাকে না।   │
    │ না বুঝে চালাবেন না। স্ক্রিপ্ট কী করবে সেটা আগে ছেপে দেখায়, আর       │
    │ প্রতিটা ধাপে অনুমতি চায়।                                            │
    │                                                                      │
    │ আগে `-WhatIf` দিয়ে চালিয়ে দেখুন — তখন কিচ্ছু বদলায় না।             │
    └──────────────────────────────────────────────────────────────────────┘

    ⭐ ডিফল্টে **প্রসেস-ভিত্তিক** ছাড় দেওয়া হয়, ফোল্ডার-ভিত্তিক নয় (দুটো
       ছাড়া)। কারণটা নিচে `-IncludeDataFolder`-এ লেখা আছে — এটাই এই
       স্ক্রিপ্টের সবচেয়ে গুরুত্বপূর্ণ সিদ্ধান্ত।

    ডিফল্টে যা বসে:
      · প্রসেস  oXeio.Agent.exe
      · প্রসেস  oXeio.Watchdog.exe
      · ফোল্ডার  C:\Program Files\oXeio   (শুধু অ্যাডমিন লিখতে পারে)

.PARAMETER IncludeDataFolder
    %ProgramData%\oXeio-কেও ছাড়ের তালিকায় তোলে।

    ⚠️⚠️ ডিফল্টে **বন্ধ**, আর সেটা ইচ্ছাকৃত। ওই ফোল্ডারে সাধারণ ইউজারের
    "Modify" অধিকার আছে (এজেন্টকে স্টাফের অ্যাকাউন্টে চলতে হয়, তাই দিতেই
    হয়েছে — `AgentDataDirectory.cs` দেখুন)। ফোল্ডারটা Defender থেকে বাদ
    দিলে অফিসের যেকোনো ইউজার ওখানে একটা .exe রেখে দিতে পারে, আর Defender
    সেটা আর দেখবেই না। অর্থাৎ ছাড়টা কার্যত একটা "ভাইরাস লুকানোর জায়গা"
    বানিয়ে দেয়।

    দরকারও সাধারণত পড়ে না: উপরের প্রসেস-ছাড় দুটো এজেন্টের **নিজের লেখা
    ফাইলগুলো** এমনিতেই স্ক্যানের বাইরে রাখে। তাই আগে ছাড়াই চালান; সত্যিই
    ধীরগতি দেখলে তবেই এটা দিন।

.PARAMETER Remove
    ছাড়গুলো তুলে দেয় (আনইনস্টলের পরে, বা ভুল করে বসিয়ে ফেললে)।

.PARAMETER Force
    প্রতিটা ধাপে "হ্যাঁ/না" জিজ্ঞেস করা বন্ধ করে — রোলআউট স্ক্রিপ্ট থেকে
    চালানোর জন্য। কী কী বসছে সেটা তবু ছাপা হয়।

    ⚠️ `-WhatIf` তবু জেতে: `-Force -WhatIf` দিলে কিছুই বদলায় না।

.EXAMPLE
    # ১· আগে দেখে নিন — কিচ্ছু বদলাবে না
    powershell -ExecutionPolicy Bypass -File deploy\defender-exclusions.ps1 -WhatIf

.EXAMPLE
    # ২· সত্যিই বসানো (অ্যাডমিন হিসেবে) — প্রতিটা ধাপে অনুমতি চাইবে
    powershell -ExecutionPolicy Bypass -File deploy\defender-exclusions.ps1

.EXAMPLE
    # ৩· রোলআউট স্ক্রিপ্ট থেকে, প্রশ্ন ছাড়া — জেনেবুঝে
    #
    # ⚠️ এখানে `-Confirm:$false` **চলবে না**। `powershell -File` তার পরের
    #    সব যুক্তিকে নিছক স্ট্রিং ধরে, তাই `$false` আক্ষরিক "$false" হয়ে
    #    যায় আর PowerShell বলে "Cannot convert 'System.String' to
    #    ... SwitchParameter"। সেজন্যই আলাদা `-Force` সুইচ রাখা হয়েছে।
    powershell -ExecutionPolicy Bypass -File deploy\defender-exclusions.ps1 -Force

.EXAMPLE
    # ৪· তুলে দেওয়া
    powershell -ExecutionPolicy Bypass -File deploy\defender-exclusions.ps1 -Remove
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$InstallDir,
    [string]$DataDir,
    [switch]$IncludeDataFolder,
    [switch]$Remove,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ⚠️ `ConfirmImpact = 'High'` থাকায় ডিফল্টে প্রতিটা ধাপে অনুমতি চাওয়া হয় —
#    ইচ্ছাকৃত, যাতে কেউ না বুঝে চালিয়ে না দেয়। রোলআউট স্ক্রিপ্টে সেটা
#    আটকে যেত, তাই `-Force`।
#
#    ⭐ `$WhatIfPreference` এখানে ছোঁয়া হয় না, তাই `-Force -WhatIf` দিলেও
#       -WhatIf-ই জেতে — "দেখে নেওয়া" কখনো "করে ফেলা" হয়ে যায় না।
if ($Force) { $ConfirmPreference = 'None' }

# ══════════════════════════════════════════════════════════════════════════
#  ১· কোন ফোল্ডার, কোন প্রসেস
# ══════════════════════════════════════════════════════════════════════════

# ⚠️ রেজিস্ট্রি ৬৪-বিট ভিউতে **জোর করে** খোলা হয়, ঠিক যেভাবে
#    `AgentSettings.cs` করে। কেউ ৩২-বিট PowerShell থেকে চালালে Windows
#    নীরবে WOW6432Node-এ পাঠাত, যেখানে MSI কিছু লেখেইনি — তখন স্ক্রিপ্ট
#    ডিফল্ট পথে নেমে যেত আর অন্য ড্রাইভে বসানো এজেন্টের ছাড় ভুল জায়গায় বসত।
function Get-AgentInstallDir {
    try {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
        try {
            $key = $base.OpenSubKey('SOFTWARE\oXeio\Agent')
            if ($key) {
                try {
                    $value = $key.GetValue('InstallDir')
                    if ($value) { return ([string]$value) }
                }
                finally { $key.Dispose() }
            }
        }
        finally { $base.Dispose() }
    }
    catch { Write-Verbose "রেজিস্ট্রি পড়া গেল না: $($_.Exception.Message)" }
    return $null
}

if (-not $InstallDir) {
    $InstallDir = Get-AgentInstallDir
    if (-not $InstallDir) {
        $InstallDir = Join-Path $env:ProgramFiles 'oXeio'
        $installSource = 'ডিফল্ট (রেজিস্ট্রিতে পাওয়া যায়নি — এজেন্ট কি বসানো হয়েছে?)'
    }
    else { $installSource = 'HKLM\SOFTWARE\oXeio\Agent\InstallDir' }
}
else { $installSource = '-InstallDir দিয়ে দেওয়া' }

if (-not $DataDir) { $DataDir = Join-Path $env:ProgramData 'oXeio' }

# ⚠️ শেষের '\' ছেঁটে ফেলা হয়। MSI `InstallDir` লেখে `[INSTALLFOLDER]` দিয়ে,
#    আর Windows Installer-এর ফোল্ডার-প্রপার্টি **সবসময় '\' দিয়ে শেষ হয়**।
#    Defender সেই পথটা আলাদা স্ট্রিং হিসেবে রাখে, ফলে তালিকায় একই ফোল্ডার
#    দুবার ঢুকত (একবার '\' সহ, একবার ছাড়া) আর -Remove কোনোদিন সবটা মুছত না।
$InstallDir = $InstallDir.TrimEnd('\')
$DataDir = $DataDir.TrimEnd('\')

$pathExclusions = @($InstallDir)
if ($IncludeDataFolder) { $pathExclusions += $DataDir }

$processExclusions = @('oXeio.Agent.exe', 'oXeio.Watchdog.exe')

# ══════════════════════════════════════════════════════════════════════════
#  ২· কী করতে যাচ্ছি — সবসময় ছাপা হয়, -WhatIf-এও
# ══════════════════════════════════════════════════════════════════════════

$action = if ($Remove) { 'তুলে নেওয়া হবে' } else { 'যোগ করা হবে' }

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ' oXeio — Microsoft Defender ছাড় (H09)' -ForegroundColor Cyan
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''
Write-Host " কাজ          : $action"
Write-Host " ইনস্টল ফোল্ডার: $InstallDir"
Write-Host "                ($installSource)"
Write-Host ''
Write-Host ' ফোল্ডার:' -ForegroundColor Yellow
foreach ($p in $pathExclusions) { Write-Host "   · $p" }
Write-Host ' প্রসেস:' -ForegroundColor Yellow
foreach ($p in $processExclusions) { Write-Host "   · $p" }
Write-Host ''

if (-not $Remove) {
    Write-Host ' ⚠️  এগুলো Defender-এর পাহারার বাইরে চলে যাবে।' -ForegroundColor Red
    if ($IncludeDataFolder) {
        Write-Host ''
        Write-Host " ⚠️⚠️ -IncludeDataFolder দেওয়া হয়েছে।" -ForegroundColor Red
        Write-Host "      $DataDir-এ সাধারণ ইউজারের লেখার অধিকার আছে," -ForegroundColor Red
        Write-Host '      অর্থাৎ যে কেউ ওখানে ফাইল রাখলে সেটাও আর স্ক্যান হবে না।' -ForegroundColor Red
        Write-Host '      সত্যিই দরকার না হলে এই সুইচটা বাদ দিন।' -ForegroundColor Red
    }
    else {
        Write-Host "      ($DataDir বাদ রাখা হয়েছে — ভালো। -IncludeDataFolder দেখুন।)" -ForegroundColor DarkGray
    }
    Write-Host ''
}

# ══════════════════════════════════════════════════════════════════════════
#  ৩· Defender আদৌ আছে তো?
# ══════════════════════════════════════════════════════════════════════════

function Write-NoDefenderHelp {
    param([string]$Detail)

    Write-Host ''
    Write-Host '── এই মেশিনে Defender দিয়ে কিছু করার নেই ────' -ForegroundColor Yellow
    Write-Host ' Microsoft Defender চলছে না বা নিষ্ক্রিয় করা আছে।'
    Write-Host ' প্রায় সবসময় এর মানে অন্য একটা অ্যান্টিভাইরাস বসানো আছে।'
    Write-Host ''
    Write-Host ' করণীয়: সেই AV-র নিজের কনসোল খুলে উপরের ফোল্ডার ও'
    Write-Host '        প্রসেসগুলো তার ছাড়ের (exclusion) তালিকায় দিন।'
    if ($Detail) { Write-Host ''; Write-Host " বিস্তারিত: $Detail" -ForegroundColor DarkGray }
    Write-Host ''
}

# ⚠️ শুধু cmdlet-টা **আছে** কি না দেখলে হয় না।
#
#    Defender-এর মডিউল Windows-এর সাথেই আসে, তাই `Get-Command
#    Add-MpPreference` প্রায় সব মেশিনেই সফল হয় — এমনকি যেখানে Defender
#    সার্ভিসটাই বন্ধ। তৃতীয় পক্ষের AV বসানো থাকলে ঠিক সেটাই হয়, আর তখন
#    আসল কলটা `0x800106ba` দিয়ে ছুড়ে বসে। `$ErrorActionPreference='Stop'`
#    থাকায় স্ক্রিপ্টটা তখন ওই দুর্বোধ্য HRESULT দেখিয়ে মরে যেত — অফিসের
#    ১৫টা PC-র মধ্যে যেগুলোয় অন্য AV আছে, ঠিক সেগুলোতেই।
#
#    তাই আসল কলটাই চেষ্টা করে দেখা হয়, আর ব্যর্থ হলে পরিষ্কার বাংলায়
#    বলে দেওয়া হয় কী করতে হবে।
if (-not (Get-Command -Name Add-MpPreference -ErrorAction SilentlyContinue)) {
    Write-NoDefenderHelp -Detail 'Defender-এর PowerShell মডিউলই নেই।'
    return
}

$current = $null
try { $current = Get-MpPreference }
catch {
    Write-NoDefenderHelp -Detail $_.Exception.Message
    return
}

# ⚠️ তৃতীয় পক্ষের AV থাকলে Defender "passive mode"-এও চলতে পারে — তখন
#    ছাড় বসানো যায় ঠিকই, কিন্তু আসল স্ক্যানটা করছে অন্য কেউ, অর্থাৎ
#    স্ক্রিপ্ট "সফল" বলত অথচ ধীরগতির সমস্যা মিটত না।
try {
    $status = Get-MpComputerStatus
    if ($status -and -not $status.RealTimeProtectionEnabled) {
        Write-Warning 'Defender-এর real-time protection বন্ধ (সম্ভবত অন্য AV চলছে)।'
        Write-Warning 'ছাড় বসানো যাবে, কিন্তু আসল স্ক্যানার অন্য কেউ হলে কাজে আসবে না।'
        Write-Host ''
    }
}
catch { Write-Verbose "Get-MpComputerStatus পাওয়া গেল না: $($_.Exception.Message)" }

# ══════════════════════════════════════════════════════════════════════════
#  ৪· অ্যাডমিন লাগবে — কিন্তু শুধু সত্যিই বদলানোর সময়
# ══════════════════════════════════════════════════════════════════════════

# ⚠️ -WhatIf-এ অ্যাডমিন চাওয়া হয় না, ইচ্ছাকৃতভাবে। "আগে দেখে নিন" বলার
#    পর যদি সেটাই elevation ছাড়া চলত না, কেউ আর দেখেই নিত না।
$isAdmin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not $WhatIfPreference) {
    throw 'অ্যাডমিন হিসেবে চালাতে হবে। (PowerShell-এ ডান-ক্লিক → "Run as administrator")'
}

# ══════════════════════════════════════════════════════════════════════════
#  ৫· বসানো / তোলা
# ══════════════════════════════════════════════════════════════════════════

$currentPaths = @($current.ExclusionPath)
$currentProcesses = @($current.ExclusionProcess)

# ⚠️ Add-MpPreference / Remove-MpPreference নিজেরা -WhatIf ঠিকমতো সামলায় না
#    (CDXML-জেনারেটেড কমান্ড)। তাই সিদ্ধান্তটা এখানে `ShouldProcess` দিয়ে
#    নিজে নেওয়া হয় আর "হ্যাঁ" না পেলে কমান্ডটা ডাকাই হয় না — এতে -WhatIf
#    আর -Confirm দুটোই নিশ্চিতভাবে কাজ করে।
function Set-Exclusion {
    param(
        [ValidateSet('Path', 'Process')][string]$Kind,
        [string]$Value,
        [string[]]$Existing
    )

    $already = $Existing -contains $Value
    $label = if ($Kind -eq 'Path') { 'ফোল্ডার' } else { 'প্রসেস' }

    if ($Remove) {
        if (-not $already) {
            Write-Host "   — $label $Value  (তালিকায় নেই, কিছু করার নেই)" -ForegroundColor DarkGray
            return
        }
        if ($PSCmdlet.ShouldProcess($Value, "Defender ছাড় থেকে $label তুলে নেওয়া")) {
            if ($Kind -eq 'Path') { Remove-MpPreference -ExclusionPath $Value }
            else { Remove-MpPreference -ExclusionProcess $Value }
            Write-Host "   ✔ তোলা হলো: $label $Value" -ForegroundColor Green
        }
    }
    else {
        if ($already) {
            Write-Host "   — $label $Value  (আগে থেকেই আছে)" -ForegroundColor DarkGray
            return
        }
        if ($PSCmdlet.ShouldProcess($Value, "Defender ছাড়ে $label যোগ করা")) {
            if ($Kind -eq 'Path') { Add-MpPreference -ExclusionPath $Value }
            else { Add-MpPreference -ExclusionProcess $Value }
            Write-Host "   ✔ যোগ হলো: $label $Value" -ForegroundColor Green
        }
    }
}

Write-Host '── কাজ চলছে ─────────────────────────────────' -ForegroundColor Cyan

foreach ($p in $pathExclusions) {
    Set-Exclusion -Kind 'Path' -Value $p -Existing $currentPaths
}
foreach ($p in $processExclusions) {
    Set-Exclusion -Kind 'Process' -Value $p -Existing $currentProcesses
}

# ══════════════════════════════════════════════════════════════════════════
#  ৬· এখন তালিকায় কী আছে
# ══════════════════════════════════════════════════════════════════════════

if ($WhatIfPreference) {
    Write-Host ''
    Write-Host '-WhatIf ছিল — কিছুই বদলানো হয়নি।' -ForegroundColor Yellow
    Write-Host 'সত্যিই বসাতে চাইলে -WhatIf ছাড়া, অ্যাডমিন হিসেবে চালান।' -ForegroundColor Yellow
    Write-Host ''
    return
}

$after = Get-MpPreference
Write-Host ''
Write-Host '── এখন Defender-এর ছাড়ের তালিকা ─────────────' -ForegroundColor Cyan
Write-Host ' ফোল্ডার:'
if (@($after.ExclusionPath).Count -eq 0) { Write-Host '   (খালি)' -ForegroundColor DarkGray }
else { foreach ($p in $after.ExclusionPath) { Write-Host "   · $p" } }
Write-Host ' প্রসেস:'
if (@($after.ExclusionProcess).Count -eq 0) { Write-Host '   (খালি)' -ForegroundColor DarkGray }
else { foreach ($p in $after.ExclusionProcess) { Write-Host "   · $p" } }
Write-Host ''
Write-Host '⚠️ উপরে oXeio-র বাইরের কিছু দেখলে থামুন — ওগুলো অন্য কারো বসানো,' -ForegroundColor Yellow
Write-Host '   আর এই স্ক্রিপ্ট সেগুলোতে হাত দেয়নি।' -ForegroundColor Yellow
Write-Host ''
