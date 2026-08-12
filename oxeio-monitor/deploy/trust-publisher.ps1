#Requires -Version 5.1
<#
.SYNOPSIS
    oXeio-র কোড-সাইনিং সার্টটা এই PC-তে বিশ্বাসযোগ্য করে তোলে (ADR-014)।

.DESCRIPTION
    ┌──────────────────────────────────────────────────────────────────┐
    │ এটা প্রতিটা স্টাফের PC-তে একবার চালাতে হয়, অ্যাডমিন হিসেবে।       │
    │ আগে `-WhatIf` দিয়ে চালিয়ে দেখুন — তখন কিচ্ছু বদলায় না।           │
    └──────────────────────────────────────────────────────────────────┘

    ⚠️⚠️ **সার্টটা দুই জায়গায় বসাতে হয়, এক জায়গায় নয়** — আর এটাই এই
    স্ক্রিপ্টের একমাত্র জটিল সিদ্ধান্ত:

      Trusted Root          "এই সার্টটা আসল"     — নইলে চেইন ভাঙা থাকে
      Trusted Publishers    "এর সই মানে ঠিক আছে" — নইলে ডায়ালগ আসে

    ⭐ কেনা সার্টে প্রথমটা লাগে না, কারণ তার ইস্যুকারী (DigiCert ইত্যাদি)
    Windows-এ আগে থেকেই বসানো। ⚠️ কিন্তু self-signed সার্ট **নিজেই নিজের
    ইস্যুকারী** — Root-এ না বসালে Windows বলবে "signature is invalid" বা
    "certificate not trusted", আর Trusted Publishers-এ থাকা সত্ত্বেও
    ডায়ালগটা আসতেই থাকবে। শুধু Publishers-এ বসিয়ে "কাজ হলো না কেন"
    খুঁজতে গিয়ে অনেক সময় নষ্ট হয়।

    ⚠️ **LocalMachine, CurrentUser নয়** — এজেন্ট বসে সব ইউজারের জন্য, আর
    MSI চলে অ্যাডমিনের অ্যাকাউন্টে। CurrentUser-এ বসালে যিনি বসিয়েছেন
    শুধু তাঁর অ্যাকাউন্টেই কাজ হতো।

    ⚠️ এই স্ক্রিপ্ট এজেন্ট **ইনস্টল করে না**, MSI চালায় না। শুধু সার্ট
    বসায়, আর কী বসাচ্ছে সেটা আগে দেখিয়ে নেয়।

.PARAMETER CerPath
    সার্ট ফাইল। না দিলে এই স্ক্রিপ্টের পাশে `certs\oxeio-code.cer`।

.PARAMETER Remove
    উল্টো কাজ — দুই স্টোর থেকেই সার্টটা তুলে নেয় (এজেন্ট সরানোর দিন)।

.EXAMPLE
    # আগে দেখে নেওয়া — কিছুই বদলায় না, অ্যাডমিনও লাগে না
    powershell -ExecutionPolicy Bypass -File deploy\trust-publisher.ps1 -WhatIf

.EXAMPLE
    # সত্যিই বসানো (অ্যাডমিন হিসেবে)
    powershell -ExecutionPolicy Bypass -File deploy\trust-publisher.ps1

.EXAMPLE
    # এজেন্ট সরানোর দিন
    powershell -ExecutionPolicy Bypass -File deploy\trust-publisher.ps1 -Remove
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$CerPath,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $CerPath) { $CerPath = Join-Path $here 'certs\oxeio-code.cer' }

if (-not (Test-Path $CerPath)) {
    throw @"
সার্ট ফাইলটা পাওয়া যায়নি: $CerPath

⚠️ এটা সার্ভার-PC-তে make-code-cert.ps1 চালিয়ে তৈরি হয় (deploy\certs\)।
   ওই .cer ফাইলটা এই মেশিনে কপি করে আনুন — MSI-র সাথেই আনতে পারেন।
   ⚠️ .pfx আনবেন না, ওতে প্রাইভেট কী আছে আর এখানে ওটার দরকার নেই।
"@
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $CerPath

# ⚠️ দুটো স্টোরই লাগে — উপরের ডকে কেন লেখা আছে
$stores = @(
    @{ Name = 'Root';             Label = 'Trusted Root  ("সার্টটা আসল")' },
    @{ Name = 'TrustedPublisher'; Label = 'Trusted Publishers ("সই মানে ঠিক আছে")' }
)

# ── ১· কী করতে যাচ্ছি — সবসময় ছাপা হয়, -WhatIf-এও ──────────────────────

Write-Host ''
Write-Host '── সার্টিফিকেট ──────────────────────────────' -ForegroundColor Cyan
Write-Host "   Subject    : $($cert.Subject)"
Write-Host "   Thumbprint : $($cert.Thumbprint)"
Write-Host "   মেয়াদ শেষ  : $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "   ফাইল       : $CerPath"
Write-Host ''

if ($cert.NotAfter -lt (Get-Date)) {
    Write-Host '   ⚠️⚠️ এই সার্টের মেয়াদ শেষ। বসানো যাবে, কিন্তু নতুন সই আর' -ForegroundColor Yellow
    Write-Host '        গ্রহণযোগ্য হবে না — সার্ভার-PC-তে নতুন সার্ট বানান।' -ForegroundColor Yellow
    Write-Host ''
}

$verb = if ($Remove) { 'তুলে নেওয়া হবে' } else { 'বসানো হবে' }
Write-Host "── যা $verb ────────────────────" -ForegroundColor Cyan
foreach ($s in $stores) {
    $present = @(Get-ChildItem "Cert:\LocalMachine\$($s.Name)" -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $cert.Thumbprint }).Count -gt 0

    $state = if ($present) { 'আছে' } else { 'নেই' }
    Write-Host ("   {0,-42} — এখন {1}" -f $s.Label, $state)
}
Write-Host ''

# ⚠️ -WhatIf-এ অ্যাডমিন চাওয়া হয় না, ইচ্ছাকৃতভাবে (defender-exclusions.ps1-এর
#    একই যুক্তি): "আগে দেখে নিন" বলার পর দেখতেই অ্যাডমিন লাগলে কেউ দেখত না।
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not $WhatIfPreference) {
    throw @"
অ্যাডমিন অধিকার লাগবে — LocalMachine-এর সার্ট স্টোরে লিখতে হয়।

PowerShell-টা "Run as administrator" দিয়ে খুলে আবার চালান।
(আগে দেখে নিতে চাইলে -WhatIf দিয়ে চালান, তাতে অ্যাডমিন লাগে না।)
"@
}

# ── ২· কাজ ──────────────────────────────────────────────────────────────

Write-Host '── কাজ চলছে ─────────────────────────────────' -ForegroundColor Cyan

foreach ($s in $stores) {
    $storePath = "Cert:\LocalMachine\$($s.Name)"
    $found = @(Get-ChildItem $storePath -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $cert.Thumbprint })

    if ($Remove) {
        if (-not $found) {
            Write-Host "   $($s.Name)  — ছিলই না, কিছু করার নেই"
            continue
        }
        if ($PSCmdlet.ShouldProcess($s.Name, 'সার্ট তুলে নেওয়া')) {
            $found | Remove-Item -Force
            Write-Host "   $($s.Name)  — তুলে নেওয়া হয়েছে" -ForegroundColor Green
        }
        continue
    }

    # ⭐ বারবার চালানো নিরাপদ — আগে থেকে থাকলে কিছুই করা হয় না। রোলআউটে
    #    একই PC-তে দুবার চালিয়ে ফেলা খুব সাধারণ ঘটনা।
    if ($found) {
        Write-Host "   $($s.Name)  — আগে থেকেই আছে"
        continue
    }

    if ($PSCmdlet.ShouldProcess($s.Name, 'সার্ট বসানো')) {
        # ⚠️ Import-Certificate ব্যবহার করা হয়নি — ওটা PKI মডিউলের, আর
        #    কিছু Windows সংস্করণে ওই মডিউল থাকে না। X509Store .NET-এরই
        #    অংশ, তাই সব মেশিনে চলে।
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
            $s.Name, 'LocalMachine')
        try {
            $store.Open('ReadWrite')
            $store.Add($cert)
            Write-Host "   $($s.Name)  — বসানো হয়েছে" -ForegroundColor Green
        }
        finally { $store.Close() }
    }
}

if ($WhatIfPreference) {
    Write-Host ''
    Write-Host '   (-WhatIf — কিছুই বদলানো হয়নি)' -ForegroundColor Yellow
    Write-Host ''
    return
}

# ── ৩· যাচাই ────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '── যাচাই ────────────────────────────────────' -ForegroundColor Cyan

$ok = $true
foreach ($s in $stores) {
    $present = @(Get-ChildItem "Cert:\LocalMachine\$($s.Name)" -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $cert.Thumbprint }).Count -gt 0

    $want = -not $Remove
    if ($present -ne $want) { $ok = $false }

    $mark = if ($present -eq $want) { '✅' } else { '❌' }
    Write-Host "   $mark $($s.Name)"
}

Write-Host ''
if (-not $ok) {
    throw 'সার্ট স্টোরের অবস্থা প্রত্যাশিত নয় — উপরের তালিকা দেখুন।'
}

if ($Remove) {
    Write-Host '✅ তুলে নেওয়া হয়েছে' -ForegroundColor Green
}
else {
    Write-Host '✅ এই PC এখন oXeio-র সই চেনে' -ForegroundColor Green
    Write-Host ''
    Write-Host '   MSI-তে ডাবল-ক্লিক করলে "Unknown publisher" আর আসবে না।'
    Write-Host "   Publisher দেখাবে: $($cert.Subject -replace '^CN=', '')"
}
Write-Host ''
