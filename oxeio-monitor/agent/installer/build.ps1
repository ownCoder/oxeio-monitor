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
  powershell -File installer\build.ps1
  powershell -File installer\build.ps1 -Version 0.3.0

.NOTES
  ⚠️⚠️ এই ফাইলটা **UTF-8 BOM সহ** সংরক্ষিত। BOM মুছে ফেলবেন না।

  Windows PowerShell 5.1 (স্টক উইন্ডোজে যেটা থাকে) BOM ছাড়া ফাইলকে ANSI
  ধরে, আর তখন নিচের বাংলা মন্তব্যগুলো ভেঙে গিয়ে স্ক্রিপ্টটা **পার্সই হয়
  না** — `Unexpected token` ধরনের তিন-চারটে এরর দিয়ে থেমে যায়।

  ⚠️ ফাইলটা প্রথম দিন থেকে BOM ছাড়াই ছিল, আর ধরা পড়েনি কারণ আগের বিল্ডটা
  `pwsh` (PowerShell 7) দিয়ে হয়েছিল — সে BOM ছাড়াই UTF-8 ধরে নেয়।
  ⚠️ অর্থাৎ যে মেশিনে PowerShell 7 নেই (যেমন অফিসের সার্ভার PC), সেখানে
  MSI বানানোই যেত না। `deploy/*.ps1` দুটোতে নিয়মটা আগেই লেখা ছিল
  ([deploy/README](../../deploy/README.md) § স্ক্রিপ্ট সম্পর্কে দুটো কথা) —
  শুধু এই ফাইলটাতেই বসানো হয়নি।
#>
[CmdletBinding()]
param(
    # ⚠️ ডিফল্ট **হার্ডকোড করা নয়** — Directory.Build.props থেকে পড়া হয়
    #    (নিচে)। আগে এখানে '0.1.0' লেখা ছিল আর Program.cs-এও আলাদা করে
    #    একই সংখ্যা; দুটো আলাদা হলে MSI এক ভার্সন বসাত আর এজেন্ট
    #    heartbeat-এ আরেকটা বলত, ফলে H04 চিরকাল একই আপডেট অফার করত।
    [string]$Version,

    # ⭐ ঠিকানাটা MSI-র ভেতরেই বসে যায়, আর তখন **ডাবল-ক্লিকেই ইনস্টল হয়** —
    #   অফিসের ১৫টা PC-তে লম্বা কমান্ড টাইপ করতে হয় না।
    #
    # ⚠️⚠️ ডিফল্টটা ইচ্ছাকৃতভাবে **বসানো আছে**, খালি নয়। আগে খালি ছিল আর
    #   `-ServerUrl` না দিলে চুপচাপ এমন MSI বেরোত যেটা ডাবল-ক্লিকে
    #   "This MSI was built without a server address" বলে আটকে যেত। ঠিক
    #   সেটাই ০.৩.২-এ ঘটেছে — বিল্ড সফল, সতর্কবাণী DarkGray-তে এক লাইন,
    #   আর ভুলটা ধরা পড়েছে মালিকের ইনস্টল করার সময় ([09 § ৩ন]।
    #
    #   এই প্রোডাক্টের ঠিকানা একটাই, তাই ডিফল্টই ঠিক আচরণ। ব্যতিক্রম
    #   চাইলে সেটা এখন **স্পষ্ট করে** চাইতে হয় — `-NoServerUrl`।
    #   ⭐ ১৩ আগস্ট: `oxeio.office.local` → `hub.oxeio.com` (ADR-026)।
    #   এখন এটাই আসল ঠিকানা — VPS, Let's Encrypt-এর সার্ট, পাবলিক DNS।
    [string]$ServerUrl = 'https://hub.oxeio.com',

    # ⚠️ ঠিকানা ছাড়া MSI — শুধু তখনই, যখন একাধিক অফিসে আলাদা ঠিকানায়
    #   `msiexec /qn SERVERURL=...` দিয়ে বসানো হবে।
    [switch]$NoServerUrl,

    # ⭐ ADR-014 — নিজে সই করা সার্টের thumbprint (make-code-cert.ps1 ছাপে)।
    #   না দিলে বিল্ড আগের মতোই চলে, কোনো ভুল ছাড়া — নইলে ডেভ মেশিনে
    #   বিল্ড করাই আটকে যেত।
    [string]$SignWith,

    # ⚠️ টাইমস্ট্যাম্প ছাড়া সই করা। **সাধারণত দেবেন না** — কারণ নিচে।
    [switch]$NoTimestamp,

    [string]$TimestampUrl = 'http://timestamp.digicert.com',

    [string]$Configuration = 'Release',
    [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $here
$publishDir = Join-Path $here 'obj\publish'
$outDir = Join-Path $here 'bin'
# ⚠️ ফাইলের নামেই ভার্সন — নিচে $msi বসে ভার্সন ঠিক হওয়ার পর

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

<#
  ⭐⭐ ফাইলের নামেই ভার্সন — `oXeioAgent-0.3.0.msi`।

  ⚠️⚠️ আগে নাম ছিল স্থির `oXeioAgent.msi`, আর ১২ আগস্ট ঠিক সেটাই কামড়ে
  দিয়েছে: একই দিনে **তিনটে আলাদা বাইনারি** বেরিয়ে গেছে একই নামে ও একই
  ভার্সনে (০৯:৪৮ · ১৫:৫৩ · ১৬:৪৩)। মালিক পুরোনোটা চালিয়ে ভাবছিলেন নতুন
  ফিচারটা আসেইনি, আর কোনটা কোনটা বলার কোনো উপায় ছিল না।

  ⭐ এখন প্রতিটা বিল্ড `bin/`-এ আলাদা ফাইল হয়ে থাকে, তাই পাশাপাশি রাখা
  যায় আর ভুল ফাইল বিলি হওয়ার সুযোগ থাকে না।
#>
$msi = Join-Path $outDir "oXeioAgent-$Version.msi"

Write-Host "   version: $Version" -ForegroundColor DarkGray

# ⚠️ একই ভার্সন আবার বিল্ড করা মানে দুটো আলাদা বাইনারি এক নামে — ঠিক যে
#    ভুলটা এই নামকরণটা ঠেকাতে এসেছে। থামানো হয় না (ডেভে বারবার বিল্ড
#    করতেই হয়), কিন্তু চোখে পড়ার মতো করে বলা হয়।
if (Test-Path $msi) {
    Write-Warning @"
$Version আগে থেকেই আছে — ঢেকে দেওয়া হচ্ছে।
⚠️ ফাইলটা যদি ইতিমধ্যে কাউকে দিয়ে থাকেন, Directory.Build.props-এ
   <Version> বাড়িয়ে নিন। এক নম্বরে দুটো বাইনারি = কোনটা কোথায় চলছে
   সেটা আর জানা যাবে না।
"@
}

# ⚠️ -NoServerUrl জেতে — সুইচটার পুরো উদ্দেশ্যই ডিফল্ট ঠিকানাটা ফেলে দেওয়া
if ($NoServerUrl) { $ServerUrl = '' }

if ($ServerUrl) {
    # ⚠️ আকৃতিটা এখানেই যাচাই — ভুল ঠিকানা MSI-তে বেক হয়ে গেলে সেটা ধরা
    #    পড়ত ১৫টা PC-তে বসানোর পর, "সার্ভারে পৌঁছাচ্ছে না" দিয়ে।
    if ($ServerUrl -notmatch '^https?://[^/\s]+/?$') {
        throw "ServerUrl-টা এরকম হওয়া উচিত: https://oxeio.office.local (পথ বা শেষে স্ল্যাশ ছাড়া) — পাওয়া গেল: $ServerUrl"
    }
    Write-Host "   server : $ServerUrl (MSI-তে বেক করা — ডাবল-ক্লিকেই ইনস্টল হবে)" -ForegroundColor DarkGray
} else {
    # ⚠️ DarkGray নয় — এই MSI ডাবল-ক্লিকে **চলবে না**, আর ঠিক এই এক লাইন
    #    চোখ এড়িয়ে যাওয়াতেই ০.৩.২ ভুলভাবে বেরিয়েছিল।
    Write-Host "   server : ⚠️ বেক করা হয়নি (-NoServerUrl) — ডাবল-ক্লিকে ইনস্টল হবে না," -ForegroundColor Yellow
    Write-Host "            msiexec-এ SERVERURL= দিতে হবে" -ForegroundColor Yellow
}

Write-Host '── ১· publish ────────────────────────────────' -ForegroundColor Cyan

# ⚠️⚠️ চলন্ত এজেন্ট obj\publish-এর DLL-গুলো **লক করে রাখে**, আর তখন নিচের
#    Remove-Item "Access denied" দিয়ে থামে। বার্তাটা Accessibility.dll নিয়ে,
#    তাই আসল কারণটা ("তুমি নিজেই ওটা চালাচ্ছ") কোথাও লেখা থাকে না।
#
# ⚠️ এটা নিছক অসুবিধা নয় — বিল্ড থেমে গেলেও bin/-এ **আগের** MSI পড়ে থাকে,
#    আর obj\publish-এ **আগের** exe। ১২ আগস্ট রাতে ঠিক এই ফাঁদে পড়ে দুবার
#    পুরোনো বাইনারি মেপে "ফিক্স কাজ করছে" ভাবা হয়েছিল।
# ⚠️ শর্তটা "oXeio চলছে" নয়, "**obj\publish থেকে** চলছে"। ইনস্টল করা এজেন্ট
#    (Program Files) বা পরীক্ষার আলাদা কপি এই ফোল্ডারের কিছুই লক করে না —
#    ওগুলোতেও থামালে বিল্ড করতে হলে প্রতিবার নিজের ইনস্টলেশন বন্ধ করতে হতো।
$locking = @(
    Get-Process -Name 'oXeio.Agent', 'oXeio.Watchdog' -ErrorAction SilentlyContinue |
        Where-Object {
            # ⚠️ Path পড়তে গিয়ে ছুড়তে পারে (অন্য ইউজারের প্রসেস) — তখন
            #    ধরে নেওয়া হয় এটা আমাদের ফোল্ডারের নয়, নইলে বিল্ড অকারণে আটকাত
            $p = try { $_.Path } catch { $null }
            $p -and $p.StartsWith($publishDir, [StringComparison]::OrdinalIgnoreCase)
        }
)
if ($locking) {
    throw @"
oXeio চলছে ($(($locking | ForEach-Object { "$($_.Name)#$($_.Id)" }) -join ', ')) —
publish ফোল্ডারের ফাইল লক করা, তাই বিল্ড করা যাবে না।

    Stop-Process -Name oXeio.Agent, oXeio.Watchdog -Force

⚠️ পরীক্ষার জন্য এজেন্ট চালাতে হলে obj\publish থেকে **নয়** — আগে অন্য
   ফোল্ডারে কপি করে নিন, নইলে পরের বিল্ডটা চুপচাপ পুরোনো বাইনারি রেখে দেবে।
"@
}

# ══════════════════════════════════════════════════════════════════════════
#  সই করা (ADR-014)
#
#  ⚠️⚠️ সার্টটা **আগে** খুঁজে নেওয়া হয়, publish শুরুর আগেই। thumbprint ভুল
#     হলে সেটা এখনই জানা দরকার — নইলে ৬২ MB বিল্ড শেষ করে তবে ভুল ধরা পড়ত।
# ══════════════════════════════════════════════════════════════════════════
$signCert = $null
if ($SignWith) {
    $signCert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $SignWith.Replace(' ', '') } |
        Select-Object -First 1

    if (-not $signCert) {
        throw @"
এই thumbprint-এর সার্ট পাওয়া যায়নি: $SignWith

⚠️ সার্টটা **এই ইউজারের** স্টোরে থাকতে হয় (প্রাইভেট কী সহ)। যে মেশিনে
   make-code-cert.ps1 চালানো হয়েছে, সই করাও সেখানেই হবে।

   অন্য মেশিনে সই করতে হলে .pfx ইমপোর্ট করুন:
       Import-PfxCertificate -FilePath deploy\certs\oxeio-code.pfx ``
           -CertStoreLocation Cert:\CurrentUser\My
"@
    }

    if (-not $signCert.HasPrivateKey) {
        throw "সার্টটা আছে কিন্তু প্রাইভেট কী নেই — .cer ইমপোর্ট করা হয়েছে, .pfx নয়।"
    }

    if ($signCert.NotAfter -lt (Get-Date)) {
        throw "সার্টের মেয়াদ শেষ ($($signCert.NotAfter.ToString('yyyy-MM-dd'))) — নতুন সার্ট বানান।"
    }

    Write-Host "   সই     : $($signCert.Subject) ($($signCert.NotAfter.ToString('yyyy-MM-dd')) পর্যন্ত)" -ForegroundColor DarkGray
    if ($NoTimestamp) {
        Write-Host '   ⚠️ টাইমস্ট্যাম্প ছাড়া — সার্টের মেয়াদ শেষ হলে সইগুলোও অচল হবে' -ForegroundColor Yellow
    }
}
else {
    Write-Host '   সই     : করা হবে না (-SignWith দিলে হবে)' -ForegroundColor DarkGray
}

<#
.SYNOPSIS
    একটা ফাইলে Authenticode সই বসায় আর ফল যাচাই করে।
#>
function Invoke-Sign {
    param([Parameter(Mandatory)][string]$Path)

    if (-not $signCert) { return }

    $args = @{ FilePath = $Path; Certificate = $signCert; HashAlgorithm = 'SHA256' }

    # ⚠️⚠️ টাইমস্ট্যাম্প **থাকা চাই**। ছাড়া সই করলে সার্টের মেয়াদ শেষ হওয়ার
    #    দিন আগের সব বিল্ডের সই একসাথে অচল হয়ে যায় — অর্থাৎ ৫ বছর পর
    #    পুরোনো MSI দিয়ে কোনো মেশিন আর ঠিক করা যেত না। টাইমস্ট্যাম্প থাকলে
    #    "সই করার সময় সার্টটা বৈধ ছিল" — সেটাই যথেষ্ট, চিরকাল।
    if (-not $NoTimestamp) { $args.TimestampServer = $TimestampUrl }

    $result = Set-AuthenticodeSignature @args
    $name = Split-Path $Path -Leaf

    # ⚠️⚠️ **`Status` মানে "এই মেশিন সইটা যাচাই করতে পারল কি না", "সই বসেছে
    #    কি না" নয়** — আর এই দুটো self-signed সার্টে আলাদা।
    #
    #    বিল্ড-মেশিন নিজের সার্টটা Trusted Root-এ না বসালে Windows বলে
    #    `UnknownError` — "chain terminated in a root certificate which is
    #    not trusted"। অথচ ফাইলে সই **বসে গেছে**, টাইমস্ট্যাম্পও হয়েছে, আর
    #    যে PC-গুলোতে trust-publisher.ps1 চলেছে সেখানে সেটা পুরোপুরি বৈধ।
    #
    #    ⚠️ প্রথমে এখানে `Status -ne 'Valid'` হলেই throw করা ছিল, আর তাতে
    #    সার্ট বানানোর পরেই বিল্ড আটকে যেত — সই করা **অসম্ভব** হয়ে যেত,
    #    অথচ আসল সমস্যা কিছুই ছিল না। (মাপতে গিয়ে ধরা পড়েছে, ১২ আগস্ট।)
    #
    #    তাই আসল প্রশ্নটা করা হয়: **আমাদের সার্ট দিয়ে সই বসেছে তো?**
    $signed = Get-AuthenticodeSignature $Path
    $mine = $signed.SignerCertificate -and
            $signed.SignerCertificate.Thumbprint -eq $signCert.Thumbprint

    if (-not $mine) {
        $hint = if (-not $NoTimestamp) {
            "`n⚠️ টাইমস্ট্যাম্প সার্ভারে পৌঁছাতে না পারলেও এটা হয় ($TimestampUrl)।" +
            "`n   অফলাইনে বিল্ড করতে হলে -NoTimestamp, কিন্তু উপরের সতর্কবাণীটা পড়ুন।"
        } else { '' }

        throw "সই ব্যর্থ ($name): $($result.Status) — $($result.StatusMessage)$hint"
    }

    # ⚠️ টাইমস্ট্যাম্প চাওয়া হয়েছিল অথচ বসেনি — এটা নীরবে যেতে দেওয়া যাবে না।
    #    সার্টের মেয়াদ শেষ হলে তখন সব পুরোনো বিল্ডের সই একসাথে অচল হতো।
    if (-not $NoTimestamp -and -not $signed.TimeStamperCertificate) {
        throw "সই হয়েছে কিন্তু টাইমস্ট্যাম্প বসেনি ($name) — $TimestampUrl-এ পৌঁছানো যায়নি।"
    }

    $script:LocalTrustWarning = $script:LocalTrustWarning -or ($signed.Status -ne 'Valid')

    Write-Host "   ✍ $name" -ForegroundColor DarkGray
}

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

# ⚠️⚠️ exe-তে সই **wix build-এর আগে**, ইচ্ছাকৃতভাবে। পরে করলে MSI-র ভেতরে
#    সই-ছাড়া কপিটাই বসে থাকত, আর ইনস্টলের পর ডিস্কে যেত সই-ছাড়া exe —
#    অথচ MSI-তে সই দেখে মনে হতো সব ঠিক আছে।
#
# ⭐ ADR-014: AV মোড়কের চেয়ে ভেতরের oXeio.Agent.exe-কেই বেশি সন্দেহ করে,
#    তাই দুটো exe-তেই সই দরকার — শুধু MSI-তে নয়।
foreach ($exe in 'oXeio.Agent.exe', 'oXeio.Watchdog.exe') {
    Invoke-Sign (Join-Path $publishDir $exe)
}

Write-Host '── ২· wix build ─────────────────────────────' -ForegroundColor Cyan

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# ⚠️⚠️ -bindpath — Package.wxs-এ `oxeio.ico` **আপেক্ষিক** পথে লেখা। এটা ছাড়া
#    wix ফাইলটা cwd থেকে খোঁজে, Package.wxs-এর পাশ থেকে নয় — তাই installer/
#    বাদে অন্য কোনো ফোল্ডার থেকে বিল্ড করলে `Cannot find oxeio.ico` দিয়ে
#    থামত। ঠিক এটাই ঘটেছে ১৮ আগস্ট (agent/ নয়, web/ cwd থেকে চালানো হয়েছিল),
#    আর ডকের `powershell -File installer\build.ps1`-ও (agent/ cwd) একইভাবে
#    ভাঙত। bindpath দিলে cwd যেখানেই হোক wix installer/-এ ফাইল খুঁজে পায়।
& wix build `
    (Join-Path $here 'Package.wxs') `
    -arch x64 `
    -bindpath "$here" `
    -d "PublishDir=$publishDir" `
    -d "Version=$Version" `
    -d "ServerUrlDefault=$($ServerUrl.TrimEnd('/'))" `
    -o $msi

if ($LASTEXITCODE -ne 0) { throw 'wix build ব্যর্থ' }

# ⚠️ MSI-তে সই **wix build-এর পরে** — মোড়কটা তৈরি হওয়ার পর। এটাই সেই সই
#    যেটা ডাবল-ক্লিকের UAC ডায়ালগে "Verified publisher" দেখায়।
Invoke-Sign $msi

$msiName = Split-Path $msi -Leaf
$msiSize = [math]::Round((Get-Item $msi).Length / 1MB, 1)
Write-Host ''
Write-Host "✅ $msi · $msiSize MB" -ForegroundColor Green

# ⭐ সই হয়েছে কি না সেটা **ফাইল থেকে পড়ে** বলা হয়, "আমরা সই করেছি" ধরে
#    নিয়ে নয়। ঠিক এই ধরনের অনুমানেই ১২ আগস্ট তিনবার ভুল বিল্ড বেরিয়েছিল।
$sig = Get-AuthenticodeSignature $msi
if ($sig.SignerCertificate) {
    $stamped = if ($sig.TimeStamperCertificate) { 'টাইমস্ট্যাম্প সহ' } else { '⚠️ টাইমস্ট্যাম্প ছাড়া' }
    Write-Host "   ✍ সই: $($sig.SignerCertificate.Subject) · $stamped" -ForegroundColor Green

    # ⚠️ এই মেশিন সইটা যাচাই করতে পারেনি — প্রায় সবসময়ই এর মানে বিল্ড-মেশিনে
    #    নিজের সার্টটা Trusted Root-এ বসানো নেই। MSI-তে দোষ নেই; স্টাফের
    #    PC-তে (যেখানে trust-publisher.ps1 চলেছে) এটা বৈধই দেখাবে।
    if ($script:LocalTrustWarning) {
        Write-Host ''
        Write-Host '   ⚠️ এই মেশিন সইটা যাচাই করতে পারছে না — সার্টটা এখানে' -ForegroundColor Yellow
        Write-Host '      Trusted Root-এ বসানো নেই। MSI ঠিক আছে; যে PC-তে' -ForegroundColor Yellow
        Write-Host '      trust-publisher.ps1 চলেছে সেখানে বৈধ দেখাবে।' -ForegroundColor Yellow
        Write-Host '      এখানেও যাচাই করতে চাইলে এই মেশিনেও ওটা একবার চালান।' -ForegroundColor Yellow
    }
}
else {
    Write-Host '   ⚠️ সই করা হয়নি — ইনস্টলে "Unknown publisher" আসবে' -ForegroundColor Yellow
    Write-Host '      (সই করতে: -SignWith <thumbprint>, দেখুন deploy/make-code-cert.ps1)' -ForegroundColor Yellow
}

Write-Host ''
if ($ServerUrl) {
    Write-Host 'ইনস্টল — স্টাফ নিজের ইমেইল-পাসওয়ার্ড দিয়ে সাইন ইন করবে:' -ForegroundColor Yellow
    Write-Host "  ডাবল-ক্লিক, অথবা:  msiexec /i $msiName /qn"
} else {
    Write-Host 'সাইলেন্ট ইনস্টল:' -ForegroundColor Yellow
    Write-Host "  msiexec /i $msiName /qn SERVERURL=`"https://oxeio.office.local`""
}

# ⭐ bin/-এ যা যা আছে — কোনটা নতুন, কোনটা পুরোনো, এক নজরে
$all = Get-ChildItem $outDir -Filter 'oXeioAgent-*.msi' | Sort-Object LastWriteTime -Descending
if ($all.Count -gt 1) {
    Write-Host ''
    Write-Host "bin/-এ $($all.Count)টা বিল্ড:" -ForegroundColor DarkGray
    foreach ($f in $all) {
        $mark = if ($f.Name -eq $msiName) { '→' } else { ' ' }
        Write-Host ("  {0} {1,-28} {2,6:N1} MB  {3}" -f $mark, $f.Name, ($f.Length/1MB), $f.LastWriteTime)
    }
}
