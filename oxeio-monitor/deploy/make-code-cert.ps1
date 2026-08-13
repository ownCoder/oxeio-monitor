#Requires -Version 5.1
<#
.SYNOPSIS
    oXeio-র exe ও MSI-তে সই করার জন্য একটা self-signed কোড-সাইনিং
    সার্টিফিকেট বানায় (ADR-014)।

.DESCRIPTION
    ⭐ কেন কেনা সার্ট লাগছে না — ADR-014-এ তিনটে কারণ: MSI ব্রাউজার দিয়ে
    নামে না তাই SmartScreen জ্বলে না · auto-update পথেও নয় · AV-র আসল
    উত্তর exclusion, সই নয়। ১৫টা মেশিনের জন্য নিজে সই করাই যথেষ্ট, আর
    খরচ শূন্য।

    বেরোয় তিনটে জিনিস:

      oxeio-code.cer   পাবলিক সার্ট       → ১৫টা PC-তে বিলি (trust-publisher.ps1)
      oxeio-code.pfx   কী সহ ব্যাকআপ      → ⚠️ গোপন, আর ⚠️⚠️ হারালে সর্বনাশ
      thumbprint       ৪০ অক্ষরের আঙুলছাপ → build.ps1 -SignWith <এটা>

    ⚠️⚠️ **pfx হারালে একই পরিচয়ে আর কোনোদিন সই করা যাবে না।** নতুন সার্ট
    মানে নতুন পরিচয়, অর্থাৎ ১৫টা PC-র প্রতিটাতে আবার গিয়ে নতুন `.cer`
    বসাতে হবে। ফাইলটা যেখানেই রাখুন, ব্যাকআপ রাখুন।

    ⚠️ এই স্ক্রিপ্ট সার্টটা **এই ইউজারের** সার্ট-স্টোরে (`Cert:\CurrentUser\My`)
    বসায়, কারণ সই করতে প্রাইভেট কী ওখানেই লাগে। অ্যাডমিন অধিকার লাগে না,
    আর অন্য কোনো মেশিনে বা স্টোরে কিছুই বদলায় না।

    ⚠️ এটা TLS সার্ট **নয়**। ওটা `make-cert.ps1` — দুটোর কাজ আলাদা, আর
    একটা দিয়ে অন্যটা চলে না (EKU আলাদা)।

.PARAMETER Subject
    সার্টে যে নামটা লেখা থাকবে — ইনস্টলের সময় "Publisher" হিসেবে এটাই
    দেখা যাবে। ডিফল্ট "oXeio"।

.PARAMETER Years
    মেয়াদ। ডিফল্ট ৫ বছর।

    ⚠️ TLS সার্টের ৮২৫ দিনের সীমাটা এখানে খাটে না — ওটা ব্রাউজারের নিয়ম।
    কোড সাইনিংয়ে লম্বা মেয়াদই সুবিধা, কারণ মেয়াদ শেষ হলে ১৫টা PC-তে
    আবার যেতে হয়।

.PARAMETER OutDir
    কোথায় ফাইল লেখা হবে। ডিফল্ট এই স্ক্রিপ্টের পাশে `certs\`।

.PARAMETER Force
    বিদ্যমান ফাইল ঢেকে দেওয়ার অনুমতি।

    ⚠️⚠️ নতুন সার্ট = নতুন পরিচয়। আগেরটা দিয়ে সই করা MSI-গুলো তখনো
    বৈধ থাকবে, কিন্তু নতুন সইগুলো ১৫টা PC-র কেউ চিনবে না যতক্ষণ না নতুন
    `.cer` বিলি করা হয়।

.EXAMPLE
    # প্রথমবার
    powershell -ExecutionPolicy Bypass -File deploy\make-code-cert.ps1

.EXAMPLE
    # আগে দেখে নেওয়া — কিছুই বদলায় না
    powershell -ExecutionPolicy Bypass -File deploy\make-code-cert.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$Subject = 'oXeio',
    [ValidateRange(1, 20)][int]$Years = 5,
    [string]$OutDir,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutDir) { $OutDir = Join-Path $here 'certs' }

$cerPath = Join-Path $OutDir 'oxeio-code.cer'
$pfxPath = Join-Path $OutDir 'oxeio-code.pfx'
$infoPath = Join-Path $OutDir 'oxeio-code.txt'

# ── ১· কী করতে যাচ্ছি — সবসময় ছাপা হয়, -WhatIf-এও ──────────────────────

Write-Host ''
Write-Host '── কোড-সাইনিং সার্টিফিকেট ───────────────────' -ForegroundColor Cyan
Write-Host "   নাম    : CN=$Subject"
Write-Host "   মেয়াদ  : $Years বছর"
Write-Host "   স্টোর   : Cert:\CurrentUser\My  (অ্যাডমিন লাগে না)"
Write-Host "   ফাইল   : $cerPath"
Write-Host "            $pfxPath  ⚠️ গোপন"
Write-Host ''

$existing = @($cerPath, $pfxPath) | Where-Object { Test-Path $_ }
if ($existing -and -not $Force) {
    throw @"
আগের ফাইল আছে — ঢাকা হয়নি:
$($existing -join "`n")

⚠️⚠️ নতুন সার্ট মানে **নতুন পরিচয়**। আগের সার্ট দিয়ে সই করা MSI-গুলো
   তখনো বৈধ থাকবে, কিন্তু নতুন সইগুলো ১৫টা PC-র কেউ চিনবে না — প্রতিটাতে
   আবার গিয়ে নতুন .cer বসাতে হবে (trust-publisher.ps1)।

   সত্যিই নতুন সার্ট চাইলে: -Force
"@
}

# ── ২· বানানো ───────────────────────────────────────────────────────────

if (-not $PSCmdlet.ShouldProcess("CN=$Subject", 'কোড-সাইনিং সার্টিফিকেট বানানো')) {
    Write-Host '   (-WhatIf — কিছুই বদলানো হয়নি)' -ForegroundColor Yellow
    Write-Host ''
    return
}

# ⚠️⚠️ পাসওয়ার্ডটা **সার্ট বানানোর আগে** চাওয়া হয়, পরে নয়।
#
#    আগে উল্টো ছিল: সার্ট তৈরি → তারপর প্রম্পট। কেউ ওখানে Ctrl+C চাপলে
#    (বা প্রম্পট ব্যর্থ হলে) স্টোরে একটা **অনাথ সার্ট** পড়ে থাকত, অথচ
#    .cer/.pfx কিছুই লেখা হতো না। ⚠️ আর উপরের পাহারাটা **ফাইল** দেখে,
#    সার্ট নয় — তাই আবার চালালে চুপচাপ দ্বিতীয় একটা সার্ট বানাত, আর
#    কোনটা দিয়ে সই করা হয়েছে সেটা বলার উপায় থাকত না।
#
#    এখন থামলে কিছুই তৈরি হয় না।
Write-Host '   ⚠️ .pfx ব্যাকআপের জন্য একটা পাসওয়ার্ড দিন (মনে রাখুন —' -ForegroundColor Yellow
Write-Host '      এটা ছাড়া ব্যাকআপ থেকে সার্ট ফেরানো যাবে না):' -ForegroundColor Yellow
$pfxPassword = Read-Host '   পাসওয়ার্ড' -AsSecureString

if ($pfxPassword.Length -eq 0) {
    throw 'পাসওয়ার্ড খালি — .pfx ব্যাকআপ ছাড়া সার্ট বানানো হয়নি।'
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

Write-Host '── কাজ চলছে ─────────────────────────────────' -ForegroundColor Cyan

# ⚠️ -Type CodeSigningCert ইচ্ছাকৃত। এটা EKU 1.3.6.1.5.5.7.3.3 বসায়, আর
#    ওটা ছাড়া Set-AuthenticodeSignature সার্টটা **নেবেই না** — বার্তাটা
#    হয় "Cannot sign code. The specified certificate is not suitable",
#    যেটা পড়ে কারণ বোঝা কঠিন।
#
# ⚠️ -KeyExportPolicy Exportable না দিলে .pfx বানানো যেত না, অর্থাৎ
#    ব্যাকআপও নেওয়া যেত না — আর মেশিন বদলালে পরিচয়টাই হারিয়ে যেত।
# ⚠️ এখান থেকে নিচে ব্যর্থ হলে সার্টটা স্টোর থেকে তুলে নেওয়া হয় — অর্ধেক
#    হওয়া অবস্থা রেখে যাওয়ার চেয়ে কিছুই না রাখা পরিষ্কার।
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=$Subject" `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears($Years)

Write-Host "   সার্ট তৈরি — thumbprint $($cert.Thumbprint)"

# পাবলিক অংশ — এটাই ১৫টা PC-তে যাবে, এতে প্রাইভেট কী নেই
[IO.File]::WriteAllBytes($cerPath, $cert.Export('Cert'))
Write-Host "   $cerPath"

# ⚠️ pfx-এ প্রাইভেট কী আছে, তাই পাসওয়ার্ড ছাড়া লেখা যাবে না।
#    পাসওয়ার্ডটা টাইপ করতে হয় — কমান্ড লাইনে দেওয়া হয় না ইচ্ছাকৃতভাবে,
#    নইলে সেটা PowerShell-এর হিস্ট্রি ফাইলে থেকে যেত।
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pfxPassword -Force | Out-Null
Write-Host "   $pfxPath  ⚠️ গোপন"

@"
oXeio কোড-সাইনিং সার্টিফিকেট
============================

Subject     : CN=$Subject
Thumbprint  : $($cert.Thumbprint)
মেয়াদ শেষ   : $($cert.NotAfter.ToString('yyyy-MM-dd'))
তৈরি        : $(Get-Date -Format 'yyyy-MM-dd HH:mm')

সই করতে:
    powershell -File agent\installer\build.ps1 -SignWith $($cert.Thumbprint)

১৫টা PC-তে বিশ্বাস করাতে (প্রতিটাতে একবার, অ্যাডমিন হিসেবে):
    powershell -File deploy\trust-publisher.ps1

⚠️ oxeio-code.pfx হারালে একই পরিচয়ে আর সই করা যাবে না।
"@ | Set-Content -Path $infoPath -Encoding UTF8

Write-Host "   $infoPath"

# ── ৩· পরের ধাপ ─────────────────────────────────────────────────────────

Write-Host ''
Write-Host '✅ তৈরি' -ForegroundColor Green
Write-Host ''
Write-Host '── thumbprint (build.ps1 -SignWith) ─────────' -ForegroundColor Cyan
Write-Host "   $($cert.Thumbprint)" -ForegroundColor Green
Write-Host ''
Write-Host '── পরের ধাপ ─────────────────────────────────' -ForegroundColor Cyan
Write-Host "   ১· MSI বানান  :  build.ps1 -SignWith $($cert.Thumbprint)"
Write-Host '   ২· ১৫টা PC-তে :  trust-publisher.ps1  (অ্যাডমিন হিসেবে)'
Write-Host ''
Write-Host '   ⚠️ ধাপ ২ বাদ দিলে সই থাকবে ঠিকই, কিন্তু Windows সেটা চিনবে না —' -ForegroundColor Yellow
Write-Host '      "Unknown publisher" ডায়ালগটা তখনো আসবে।' -ForegroundColor Yellow
Write-Host ''
