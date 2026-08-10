#Requires -Version 5.1
<#
.SYNOPSIS
    oXeio API-র জন্য self-signed TLS সার্টিফিকেট বানায় (I01)।

.DESCRIPTION
    অফিসের LAN-এ কোনো পাবলিক ডোমেইন নেই, তাই Let's Encrypt চলে না। এই
    স্ক্রিপ্ট একটা self-signed সার্টিফিকেট আর তার প্রাইভেট কী বানায় —
    Node সরাসরি যেটা পড়তে পারে (TLS_CERT / TLS_KEY)।

    বেরোয় চারটে ফাইল:

      oxeio-cert.pem   সার্টিফিকেট (PEM)      → TLS_CERT
      oxeio-key.pem    প্রাইভেট কী (PKCS#8)   → TLS_KEY   ⚠️ গোপন
      oxeio.pfx        দুটো একসাথে            → Windows-এ ইমপোর্ট করার জন্য,
                                                আর -ReuseKey-র জন্য ⚠️ গোপন
      oxeio-pin.txt    SPKI পিন + তথ্য        → এজেন্টে বসানোর মান

    ⚠️ এই স্ক্রিপ্ট **কিছু ইনস্টল করে না** — সার্টিফিকেট স্টোরে ঢোকায় না,
       সার্ভার রিস্টার্ট করে না, কোনো সেটিং বদলায় না। শুধু ফাইল লেখে।
       বাকি ধাপগুলো README.md-তে, হাতে করার জন্য।

.PARAMETER Hostname
    সার্টিফিকেটের প্রধান নাম (CN ও প্রথম SAN)। না দিলে এই মেশিনের নাম।

.PARAMETER IpAddress
    SAN-এ যাওয়া IP। না দিলে মেশিনের সব LAN IPv4 নিজে খুঁজে নেয়।

.PARAMETER AlsoDns
    বাড়তি DNS নাম (alias, FQDN)।

.PARAMETER Days
    মেয়াদ। ডিফল্ট ৮২৫ দিন — কারণ README § ৭ দেখুন।

.PARAMETER ReuseKey
    আগের oxeio.pfx থেকে **একই প্রাইভেট কী** নিয়ে নতুন সার্টিফিকেট বানায়।
    ⭐ নবায়নের সময় এটাই ব্যবহার করতে হবে — কী এক থাকলে SPKI পিনও এক
    থাকে, অর্থাৎ ১৫টা PC-র একটাতেও হাত দিতে হয় না।

.PARAMETER Force
    বিদ্যমান ফাইল ঢেকে দেওয়ার অনুমতি। ⚠️ নতুন কী মানে নতুন পিন।

.EXAMPLE
    # প্রথমবার — নাম আর IP নিজে খুঁজে নেবে
    powershell -ExecutionPolicy Bypass -File deploy\make-cert.ps1

.EXAMPLE
    # স্পষ্ট করে বলে দেওয়া (সুপারিশ করা হয়)
    powershell -ExecutionPolicy Bypass -File deploy\make-cert.ps1 `
        -Hostname oxeio.office.local -IpAddress 192.168.0.10

.EXAMPLE
    # নবায়ন — এজেন্টে কিছু বদলাতে হবে না
    powershell -ExecutionPolicy Bypass -File deploy\make-cert.ps1 -ReuseKey
#>
[CmdletBinding()]
param(
    [string]$Hostname,
    [string[]]$IpAddress,
    [string[]]$AlsoDns = @(),
    [ValidateRange(1, 3650)][int]$Days = 825,
    [ValidateSet(2048, 3072, 4096)][int]$KeySize = 2048,
    [string]$OutDir,
    [switch]$ReuseKey,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ══════════════════════════════════════════════════════════════════════════
#  DER এনকোডার
#
#  ⚠️ হাতে লিখতে হচ্ছে, কারণ Windows PowerShell 5.1 চলে .NET Framework-এ,
#     আর সেখানে `RSA.ExportPkcs8PrivateKey()` **নেই** (ওটা .NET Core 3.0+)।
#     এই মেশিনে pwsh 7 বসানো নেই, আর শুধু সার্ট বানানোর জন্য মালিককে
#     PowerShell 7 বসাতে বলা মানে রোলআউটের আগেই একটা বাড়তি ধাপ।
#
#  ⭐ যতটা সম্ভব কম নিজে লেখা হয়েছে: **পাবলিক** কী-র কঠিন অংশটা .NET-এর
#     নিজের এনকোডার থেকে নেওয়া হয় ($cert.PublicKey.EncodedKeyValue), তাই
#     এখানে শুধু মোড়কটুকু লিখতে হয়। প্রাইভেট কী-তে উপায় নেই — ৯টা
#     INTEGER নিজে এনকোড করতে হয়।
# ══════════════════════════════════════════════════════════════════════════
class Der {
    # DER-এর দৈর্ঘ্য: ১২৮-এর কম হলে এক বাইট, নইলে "কয় বাইট" + বাইটগুলো।
    static [byte[]] Length([int]$n) {
        if ($n -lt 0x80) { return [byte[]]@([byte]$n) }
        $tmp = New-Object 'System.Collections.Generic.List[byte]'
        $v = $n
        while ($v -gt 0) { $tmp.Insert(0, [byte]($v -band 0xFF)); $v = $v -shr 8 }
        $out = New-Object 'System.Collections.Generic.List[byte]'
        $out.Add([byte](0x80 -bor $tmp.Count))
        $out.AddRange($tmp)
        return $out.ToArray()
    }

    static [byte[]] Tlv([byte]$tag, [byte[]]$content) {
        $out = New-Object 'System.Collections.Generic.List[byte]'
        $out.Add($tag)
        $out.AddRange([Der]::Length($content.Length))
        $out.AddRange($content)
        return $out.ToArray()
    }

    # ⚠️ DER-এর INTEGER **সাইনড**। RSA-র সংখ্যাগুলো সবসময় ধনাত্মক, কিন্তু
    #    সবচেয়ে বাঁয়ের বিট ১ হলে DER সেটাকে ঋণাত্মক ধরে নেয় — তাই সামনে
    #    একটা 0x00 বসাতে হয়। এটা বাদ পড়লে কী-টা দেখতে ঠিকই লাগত, অথচ
    #    OpenSSL/Node "bad decrypt"-জাতীয় দুর্বোধ্য ভুল দিত।
    static [byte[]] Integer([byte[]]$unsigned) {
        $i = 0
        while ($i -lt ($unsigned.Length - 1) -and $unsigned[$i] -eq 0) { $i++ }
        $body = New-Object 'System.Collections.Generic.List[byte]'
        if (($unsigned[$i] -band 0x80) -ne 0) { $body.Add([byte]0) }
        for ($j = $i; $j -lt $unsigned.Length; $j++) { $body.Add($unsigned[$j]) }
        return [Der]::Tlv(0x02, $body.ToArray())
    }

    # ⚠️ নাম `Seq`, `Sequence` নয়। `sequence` Windows PowerShell 5.1-এর একটা
    #    সংরক্ষিত workflow কীওয়ার্ড, আর ক্লাসের মেথডের নাম হিসেবে দিলে পুরো
    #    ফাইলটাই পার্স হয় না — ভুল বার্তা আসে "Missing statement body after
    #    keyword 'Sequence'", যেটা পড়ে আসল কারণ বোঝার উপায় নেই।
    static [byte[]] Seq([byte[]]$content) { return [Der]::Tlv(0x30, $content) }

    static [byte[]] OctetString([byte[]]$content) { return [Der]::Tlv(0x04, $content) }

    # BIT STRING-এর প্রথম বাইট = "শেষে কয়টা বিট অব্যবহৃত"। কী-র ক্ষেত্রে সবসময় ০।
    static [byte[]] BitString([byte[]]$content) {
        $body = New-Object 'System.Collections.Generic.List[byte]'
        $body.Add([byte]0)
        $body.AddRange($content)
        return [Der]::Tlv(0x03, $body.ToArray())
    }

    static [byte[]] Cat([byte[][]]$parts) {
        $out = New-Object 'System.Collections.Generic.List[byte]'
        foreach ($p in $parts) { $out.AddRange($p) }
        return $out.ToArray()
    }
}

# AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL } — ধ্রুবক।
# RSA-র জন্য এটা কখনো বদলায় না, তাই এনকোড না করে সরাসরি বাইটেই লেখা।
$RsaAlgId = [byte[]]@(
    0x30, 0x0D, 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86,
    0xF7, 0x0D, 0x01, 0x01, 0x01, 0x05, 0x00
)

function ConvertTo-Pem {
    param([Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][byte[]]$Bytes)

    $b64 = [Convert]::ToBase64String($Bytes)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("-----BEGIN $Label-----`n")
    for ($i = 0; $i -lt $b64.Length; $i += 64) {
        $len = [Math]::Min(64, $b64.Length - $i)
        [void]$sb.Append($b64.Substring($i, $len)).Append("`n")
    }
    [void]$sb.Append("-----END $Label-----`n")
    return $sb.ToString()
}

# RSAParameters → PKCS#8 (`BEGIN PRIVATE KEY`)।
# PKCS#1-ও Node পড়তে পারত, কিন্তু PKCS#8-ই আজকের সব টুলের সাধারণ ভাষা।
function ConvertTo-Pkcs8 {
    param([Parameter(Mandatory)][System.Security.Cryptography.RSAParameters]$P)

    $pkcs1 = [Der]::Seq([Der]::Cat([byte[][]]@(
        [Der]::Integer([byte[]]@(0)),
        [Der]::Integer($P.Modulus),
        [Der]::Integer($P.Exponent),
        [Der]::Integer($P.D),
        [Der]::Integer($P.P),
        [Der]::Integer($P.Q),
        [Der]::Integer($P.DP),
        [Der]::Integer($P.DQ),
        [Der]::Integer($P.InverseQ)
    )))

    return [Der]::Seq([Der]::Cat([byte[][]]@(
        [Der]::Integer([byte[]]@(0)),
        $RsaAlgId,
        [Der]::OctetString($pkcs1)
    )))
}

# ⭐ SPKI = পিনের ভিত্তি। সার্টিফিকেটের নয়, **কী-র** পরিচয় — তাই কী এক
#    রাখলে নবায়নের পরেও পিন এক থাকে।
function Get-SpkiBytes {
    param([Parameter(Mandatory)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert)

    $rsaPublicKey = $Cert.PublicKey.EncodedKeyValue.RawData
    return [Der]::Seq([Der]::Cat([byte[][]]@(
        $RsaAlgId,
        [Der]::BitString($rsaPublicKey)
    )))
}

function Get-Sha256Base64 {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($Bytes)) }
    finally { $sha.Dispose() }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($Bytes) | ForEach-Object { $_.ToString('X2') }) -join ':') }
    finally { $sha.Dispose() }
}

# ══════════════════════════════════════════════════════════════════════════
#  ১· কোন নাম, কোন IP
# ══════════════════════════════════════════════════════════════════════════

# ⚠️ `powershell -File` **অ্যারে বোঝে না** — `-IpAddress 10.0.0.1,10.0.0.2`
#    পুরোটা একটাই স্ট্রিং হয়ে ঢোকে, আর তখন "বৈধ IP নয়" বলে থেমে যেত।
#    README-তে `-File`-ই বলা আছে (সেটাই সবচেয়ে সহজ), তাই স্ক্রিপ্টই কমা
#    ভেঙে নেয়। বিকল্প ছিল মালিককে `-Command` আর উদ্ধৃতির প্যাঁচ শেখানো।
function Split-List {
    param([string[]]$Values)
    $out = @()
    foreach ($v in @($Values)) {
        if (-not $v) { continue }
        foreach ($part in ($v -split '[,;\s]+')) {
            $p = $part.Trim()
            if ($p) { $out += $p }
        }
    }
    return $out
}

$IpAddress = Split-List $IpAddress
$AlsoDns = Split-List $AlsoDns

if (-not $Hostname) { $Hostname = $env:COMPUTERNAME.ToLowerInvariant() }

if (-not $IpAddress -or $IpAddress.Count -eq 0) {
    $found = @()
    try {
        # ⚠️ APIPA (169.254.x) আর loopback বাদ — ওগুলো SAN-এ থাকার মানে নেই।
        #    ভার্চুয়াল অ্যাডাপ্টারের (Docker/WSL/Hyper-V) IP **বাদ দেওয়া হয় না**:
        #    বাড়তি একটা SAN ক্ষতি করে না, কিন্তু আসলটা বাদ পড়লে ব্রাউজার
        #    সংযোগই করতে পারবে না। তাই বেশি রাখা, কম নয়।
        $found = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
            Select-Object -ExpandProperty IPAddress -Unique)
    }
    catch {
        $found = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
            ForEach-Object { $_.IPAddressToString } |
            Where-Object { $_ -notmatch '^(127\.|169\.254\.)' })
    }
    $IpAddress = $found
}

$dnsNames = @($Hostname)
foreach ($d in $AlsoDns) { if ($d -and $dnsNames -notcontains $d) { $dnsNames += $d } }

# ⚠️ FQDN নিজে যোগ করা হয় — অনেক সময় ব্রাউজারে ছোট নাম আর এজেন্টে পুরো
#    নাম ব্যবহার হয়, আর একটা বাদ পড়লে শুধু সেই একটাই ভাঙে।
try {
    $fqdn = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName
    if ($fqdn -and $dnsNames -notcontains $fqdn) { $dnsNames += $fqdn }
}
catch { Write-Verbose "FQDN পাওয়া গেল না — সমস্যা নেই" }

# localhost — সার্ভারের মেশিন থেকে নিজেই smoke-test করার জন্য
if ($dnsNames -notcontains 'localhost') { $dnsNames += 'localhost' }
$ipList = @($IpAddress) + @('127.0.0.1') | Select-Object -Unique

if ($ipList.Count -le 1) {
    Write-Warning 'কোনো LAN IP পাওয়া যায়নি — শুধু 127.0.0.1 বসছে।'
    Write-Warning 'এজেন্টগুলো IP দিয়ে সংযোগ করলে -IpAddress দিয়ে হাতে বলে দিন।'
}

# ══════════════════════════════════════════════════════════════════════════
#  ২· ফাইলের জায়গা, আর ঢেকে দেওয়ার পাহারা
# ══════════════════════════════════════════════════════════════════════════

if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'certs' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$OutDir = (Resolve-Path $OutDir).Path

$certPath = Join-Path $OutDir 'oxeio-cert.pem'
$keyPath = Join-Path $OutDir 'oxeio-key.pem'
$pfxPath = Join-Path $OutDir 'oxeio.pfx'
$pinPath = Join-Path $OutDir 'oxeio-pin.txt'

if ($ReuseKey) {
    if (-not (Test-Path $pfxPath)) {
        throw "-ReuseKey দেওয়া হয়েছে, কিন্তু $pfxPath নেই। প্রথমবার -ReuseKey ছাড়া চালান।"
    }
}
elseif ((Test-Path $keyPath) -and -not $Force) {
    # ⚠️ এই পাহারাটা এই স্ক্রিপ্টের সবচেয়ে দরকারি অংশ।
    #    নতুন কী = নতুন পিন = ১৫টা PC-র এজেন্ট সংযোগ করা বন্ধ করে দেবে,
    #    আর সেটা টের পাওয়া যাবে অনেক পরে (এজেন্ট চুপচাপ কিউ জমাতে থাকে)।
    #    নবায়ন করতে চাইলে -ReuseKey; সত্যিই কী বদলাতে চাইলে -Force।
    throw @"
$keyPath ইতিমধ্যেই আছে।

  নবায়ন করতে চান?          -ReuseKey  দিন (পিন এক থাকে, PC-তে হাত দিতে হবে না)
  সত্যিই নতুন কী চান?      -Force     দিন (⚠️ পিন বদলাবে — README § ৭.২ পড়ুন)
"@
}

# ══════════════════════════════════════════════════════════════════════════
#  ৩· কী ও সার্টিফিকেট
# ══════════════════════════════════════════════════════════════════════════

Write-Host ''
Write-Host '── সার্টিফিকেট বানানো হচ্ছে ─────────────────' -ForegroundColor Cyan

$rsa = $null
$oldPfx = $null
try {
    if ($ReuseKey) {
        # ⚠️ বাইটগুলো `[System.IO.File]::ReadAllBytes` দিয়ে পড়া হয়, আলাদা
        #    `[byte[]]` চলকে। `Get-Content -Encoding Byte` ব্যবহার করা হয়নি
        #    দু'টো কারণে: (১) ওই প্যারামিটার PowerShell 7-এ নেই (সেখানে
        #    `-AsByteStream`), (২) ফলটা `object[]` হয়ে আসে, আর তখন
        #    X509Certificate2-এর কনস্ট্রাক্টর `(string path, ...)` ওভারলোডটা
        #    বেছে নিয়ে অ্যারেটাকে "System.Byte[]" স্ট্রিং বানিয়ে ফেলে —
        #    ভুল বার্তা আসে "The system cannot find the file specified",
        #    অর্থাৎ মনে হয় pfx ফাইলটাই নেই, অথচ সে দিব্যি জায়গামতো আছে।
        [byte[]]$pfxBytes = [System.IO.File]::ReadAllBytes($pfxPath)

        # ⚠️ Exportable, কিন্তু PersistKeySet **নয়** — নইলে কী-টা Windows-এর
        #    CNG স্টোরে থেকে যেত আর কেউ কোনোদিন মুছত না।
        $oldPfx = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
            $pfxBytes,
            '',
            [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)

        # ⚠️⚠️ কী-টা এখানে **কপি করা হয় না**, সরাসরি ব্যবহার হয়।
        #
        # স্বাভাবিক মনে হতো `$rsa.ImportParameters($old.ExportParameters($true))`
        # দিয়ে একটা নিজের কপি বানানো। কিন্তু সেটা চলে না: PFX থেকে ফেরত আসা
        # কী একটা CNG কী, আর `Exportable` ফ্ল্যাগ তাকে দেয় শুধু
        # `AllowExport` (মানে **এনক্রিপ্টেড** রপ্তানি, যেমন আবার PFX-এ) —
        # `AllowPlaintextExport` নয়। তাই `ExportParameters($true)` ছুড়ে বসে
        # "The requested operation is not supported", আর বার্তাটা পড়ে মনে
        # হয় pfx ফাইলটাই নষ্ট।
        #
        # ⭐ দরকারও নেই। নতুন সার্টিফিকেট বানাতে কী-টাকে শুধু **সই করতে**
        #    হয় — সেটা CNG কী দিব্যি পারে। আর প্রাইভেট কী-র PEM ফাইলটা
        #    নবায়নে **ছোঁয়াই হয় না**: কী তো একই, ফাইলটাও একই থাকে।
        #    ফলে নবায়নের সময় গোপন ফাইলটা নতুন করে লেখার ঝুঁকিই থাকে না।
        $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($oldPfx)
        if (-not $rsa) { throw "$pfxPath-এ প্রাইভেট কী নেই।" }

        if (-not (Test-Path $keyPath)) {
            throw "$keyPath নেই। -ReuseKey কী-র ফাইলটা নতুন করে লেখে না, তাই ওটা থাকতেই হবে।"
        }

        Write-Host '   কী: আগেরটাই — পিন বদলাবে না, PC-তে হাত দিতে হবে না' -ForegroundColor Green
    }
    else {
        $rsa = [System.Security.Cryptography.RSA]::Create($KeySize)
        Write-Host "   কী: নতুন RSA-$KeySize"
    }

    $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest(
        "CN=$Hostname",
        $rsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)

    $san = New-Object System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder
    foreach ($d in $dnsNames) { $san.AddDnsName($d) }
    foreach ($ip in $ipList) {
        $parsed = [System.Net.IPAddress]::Any
        if (-not [System.Net.IPAddress]::TryParse($ip, [ref]$parsed)) {
            throw "'$ip' একটা বৈধ IP নয়।"
        }
        $san.AddIpAddress($parsed)
    }
    $req.CertificateExtensions.Add($san.Build())

    # CA নয় — এই সার্ট দিয়ে অন্য সার্ট সই করা যাবে না
    $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension(
                $false, $false, 0, $true)))

    $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension(
        ([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
                    [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment), $true)))

    # EKU serverAuth. ⚠️ না থাকলে Windows/Chrome সার্টটাকে সার্ভারের জন্য
    #    অবৈধ ধরে, আর ভুল বার্তাটা এতটাই দুর্বোধ্য যে কারণ খুঁজতে দিন যায়।
    $ekus = New-Object System.Security.Cryptography.OidCollection
    [void]$ekus.Add((New-Object System.Security.Cryptography.Oid('1.3.6.1.5.5.7.3.1', 'Server Authentication')))
    $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension(
                $ekus, $false)))

    $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension(
                $req.PublicKey, $false)))

    # ⚠️ ৫ মিনিট পিছিয়ে শুরু — অফিসের PC-র ঘড়ি সার্ভারের সাথে হুবহু মেলে না।
    #    এটা না থাকলে সার্ট বানানোর পরের কয়েক মিনিট কিছু মেশিনে
    #    "not yet valid" আসত, আর কেউ বুঝত না কেন।
    $notBefore = [DateTimeOffset]::UtcNow.AddMinutes(-5)
    $notAfter = $notBefore.AddDays($Days)

    $cert = $req.CreateSelfSigned($notBefore, $notAfter)

    # ══════════════════════════════════════════════════════════════════════
    #  ৪· ফাইলে লেখা
    # ══════════════════════════════════════════════════════════════════════

    $certPem = ConvertTo-Pem -Label 'CERTIFICATE' -Bytes $cert.RawData
    $spki = Get-SpkiBytes -Cert $cert
    $pin = Get-Sha256Base64 -Bytes $spki

    # ⚠️ BOM ছাড়া UTF-8, বাধ্যতামূলক। `Set-Content -Encoding utf8` 5.1-এ BOM
    #    বসায়, আর BOM থাকলে Node PEM-টা পড়তে পারে না — ভুল বার্তা হয়
    #    "error:0909006C:PEM routines:get_name:no start line", যেটা পড়ে
    #    কারো পক্ষে বোঝা সম্ভব নয় যে দোষটা তিনটে অদৃশ্য বাইটের।
    #
    # ⚠️ অথচ **এই স্ক্রিপ্ট ফাইলটা নিজে** UTF-8 BOM **সহ** থাকতে হয় —
    #    উল্টো নিয়ম। Windows PowerShell 5.1 BOM ছাড়া ফাইলকে ANSI ধরে, আর
    #    তখন নিচের বাংলা লেখাগুলো ভেঙে গিয়ে স্ক্রিপ্টই পার্স হয় না।
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($certPath, $certPem, $utf8NoBom)

    # ⭐ নবায়নে প্রাইভেট কী-র ফাইল **ছোঁয়া হয় না** (উপরের ব্যাখ্যা দেখুন)।
    #    কী একই, তাই ফাইলও একই — আর গোপন ফাইলটা অকারণে নতুন করে লিখলে
    #    শুধু নষ্ট হওয়ার সুযোগ তৈরি হতো।
    if (-not $ReuseKey) {
        $keyPem = ConvertTo-Pem -Label 'PRIVATE KEY' -Bytes (ConvertTo-Pkcs8 -P $rsa.ExportParameters($true))
        [System.IO.File]::WriteAllText($keyPath, $keyPem, $utf8NoBom)
    }

    [System.IO.File]::WriteAllBytes($pfxPath, $cert.Export(
            [System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))

    $thumb = Get-Sha256Hex -Bytes $cert.RawData

    $pinText = @"
oXeio TLS — এজেন্টে বসানোর তথ্য
================================

SPKI পিন (এটাই MSI-র SERVERPIN):
  $pin

সার্টিফিকেটের SHA-256 (ব্রাউজারে মিলিয়ে দেখার জন্য):
  $thumb

নাম (SAN):  $($dnsNames -join ', ')
IP  (SAN):  $($ipList -join ', ')
মেয়াদ:      $($notBefore.ToLocalTime().ToString('yyyy-MM-dd')) থেকে $($notAfter.ToLocalTime().ToString('yyyy-MM-dd'))
বানানো:     $([DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm'))

⚠️ SPKI পিন গোপন নয় — এটা পাবলিক কী-র হ্যাশ। নির্ভয়ে ইমেইলে পাঠানো যায়।
⚠️ oxeio-key.pem আর oxeio.pfx **গোপন** — কখনো git-এ বা ইমেইলে নয়।
"@
    [System.IO.File]::WriteAllText($pinPath, $pinText, $utf8NoBom)

    # ── প্রাইভেট কী-র ACL ─────────────────────────────────────────────────
    # ⚠️ ব্যর্থ হলে throw করা হয় না — সার্ট বানানো হয়ে গেছে, সেটা ফেলে দেওয়ার
    #    মানে হয় না। কিন্তু সতর্কবার্তা যেন চোখ এড়ায় না।
    foreach ($secret in @($keyPath, $pfxPath)) {
        try {
            # ⚠️ `Get-Acl` + `Set-Acl` **নয়**, একদম নতুন FileSecurity।
            #
            # Get-Acl যা ফেরায় তাতে DACL ছাড়াও owner/group/SACL-এর ঘর থাকে,
            # আর Set-Acl সেগুলোও লিখতে যায় — তখন প্রশাসক-অধিকার ছাড়া চললে
            # "The process does not possess the 'SeSecurityPrivilege'
            # privilege" এসে অনুমতি বসানোই ব্যর্থ হয়। খালি অবজেক্টে শুধু
            # DACL-টাই বদলানো থাকে, তাই শুধু সেটাই লেখা হয় — সাধারণ
            # ইউজার হিসেবেও কাজ করে।
            $acl = New-Object System.Security.AccessControl.FileSecurity

            # উত্তরাধিকার বন্ধ — নইলে ফোল্ডার থেকে "Users: Read" নেমে আসত,
            # আর প্রাইভেট কী অফিসের যেকোনো অ্যাকাউন্ট পড়ে ফেলতে পারত।
            $acl.SetAccessRuleProtection($true, $false)
            foreach ($who in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators', "$env:USERDOMAIN\$env:USERNAME")) {
                $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
                            $who, 'FullControl', 'Allow')))
            }
            (Get-Item -LiteralPath $secret).SetAccessControl($acl)
        }
        catch {
            Write-Warning "$secret-এর অনুমতি শক্ত করা গেল না: $($_.Exception.Message)"
            Write-Warning 'ফাইলটা হাতে দেখে নিন — সাধারণ ইউজার যেন পড়তে না পারে।'
        }
    }

    # ══════════════════════════════════════════════════════════════════════
    #  ৫· কী হলো, এখন কী করতে হবে
    # ══════════════════════════════════════════════════════════════════════

    Write-Host ''
    Write-Host '✅ তৈরি' -ForegroundColor Green
    Write-Host "   $certPath"
    if ($ReuseKey) {
        Write-Host "   $keyPath      (অপরিবর্তিত — আগের কী-ই)"
    }
    else {
        Write-Host "   $keyPath      ⚠️ গোপন"
    }
    Write-Host "   $pfxPath          ⚠️ গোপন"
    Write-Host "   $pinPath"
    Write-Host ''
    Write-Host '── সার্টিফিকেটে যা আছে ──────────────────────' -ForegroundColor Cyan
    Write-Host "   নাম : $($dnsNames -join ', ')"
    Write-Host "   IP  : $($ipList -join ', ')"
    Write-Host "   মেয়াদ: $($notAfter.ToLocalTime().ToString('yyyy-MM-dd')) পর্যন্ত ($Days দিন)"
    Write-Host ''
    Write-Host '   ⚠️ উপরের তালিকাটা মিলিয়ে দেখুন। এজেন্ট বা ব্রাউজার যে ঠিকানা' -ForegroundColor Yellow
    Write-Host '      ব্যবহার করবে সেটা এখানে না থাকলে সংযোগ হবে না।' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '── SPKI পিন (MSI-র SERVERPIN) ───────────────' -ForegroundColor Cyan
    Write-Host "   $pin" -ForegroundColor Green
    Write-Host ''
    Write-Host '── পরের ধাপ ─────────────────────────────────' -ForegroundColor Cyan
    Write-Host '   deploy/README.md § ৩ থেকে এগোন।'
    Write-Host ''
}
finally {
    if ($rsa) { $rsa.Dispose() }
    if ($oldPfx) { $oldPfx.Dispose() }
}
