$ErrorActionPreference = 'Stop'
$sshExe = Join-Path $env:WINDIR 'System32/OpenSSH/ssh.exe'
$keyFile = Join-Path $env:USERPROFILE '.ssh/oxeio_vps'
$publicKey = (Get-Content -LiteralPath ($keyFile + '.pub') -Raw).Trim()
$statusPath = Join-Path $PSScriptRoot 'ssh-access-status.json'

function Save-Status([string]$State) {
    @{ state = $State; host = '165.101.189.253'; at = (Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding utf8
}

if ($publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9@._-]+)?$') {
    throw 'Unexpected public-key format. No server changes were attempted.'
}
$keyParts = $publicKey -split ' '
$keyToInstall = $keyParts[0] + ' ' + $keyParts[1]
$remoteCommand = "umask 077; mkdir -p /root/.ssh && touch /root/.ssh/authorized_keys && chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys && (grep -qxF '$keyToInstall' /root/.ssh/authorized_keys || printf '%s\n' '$keyToInstall' >> /root/.ssh/authorized_keys) && printf 'Public key is installed.\n'"

Write-Host 'Current oXeio VPS: 165.101.189.253:2222' -ForegroundColor Cyan
Write-Host 'If prompted, type the existing VPS root password here. Input is hidden.'
Write-Host 'This preserves existing authorized keys and adds your PC public key.'
Save-Status 'awaiting-login'
& $sshExe -t -p 2222 -i $keyFile -o IdentitiesOnly=yes -o ConnectTimeout=20 root@165.101.189.253 $remoteCommand
if ($LASTEXITCODE -ne 0) {
    Save-Status 'login-or-key-install-failed'
    Write-Host 'Login/key setup did not complete. Do not paste your password into chat.' -ForegroundColor Yellow
    return
}
& $sshExe -p 2222 -i $keyFile -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 root@165.101.189.253 'printf "SSH key access verified\n"'
if ($LASTEXITCODE -eq 0) {
    Save-Status 'verified'
    Write-Host 'SSH key access is ready. Codex can now continue deployment.' -ForegroundColor Green
} else {
    Save-Status 'key-verification-failed'
    Write-Host 'Key login still failed; leave this window open for diagnosis.' -ForegroundColor Yellow
}
