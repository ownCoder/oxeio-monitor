@echo off
title oXeio VPS - SSH key setup
echo Current oXeio VPS: 165.101.189.253:2222
echo If prompted, type the existing VPS root password here. Input is hidden.
echo Existing authorized keys will be preserved.
echo awaiting-login>"%~dp0ssh-access-status.txt"
"C:\Windows\System32\OpenSSH\ssh.exe" -t -p 2222 -i "C:\Users\Server\.ssh\oxeio_vps" -o IdentitiesOnly=yes -o ConnectTimeout=20 root@165.101.189.253 "umask 077; mkdir -p /root/.ssh && touch /root/.ssh/authorized_keys && chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys && (grep -qxF 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP/MUEzVYttjhmlyPiwEIWsWAASoAABdI4RukzNePuew' /root/.ssh/authorized_keys || echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP/MUEzVYttjhmlyPiwEIWsWAASoAABdI4RukzNePuew' >> /root/.ssh/authorized_keys) && echo Public-key-installed"
if errorlevel 1 (
  echo login-or-key-install-failed>"%~dp0ssh-access-status.txt"
  echo Login or key setup did not complete. Leave this window open.
  exit /b 1
)
"C:\Windows\System32\OpenSSH\ssh.exe" -p 2222 -i "C:\Users\Server\.ssh\oxeio_vps" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 root@165.101.189.253 "echo SSH-key-access-verified"
if errorlevel 1 (
  echo key-verification-failed>"%~dp0ssh-access-status.txt"
  exit /b 1
)
echo verified>"%~dp0ssh-access-status.txt"
echo SSH key access is ready. Codex can continue deployment.
