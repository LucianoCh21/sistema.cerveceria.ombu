#!/usr/bin/env bash
# Se ejecuta EN la VM (Ubuntu 24.04 x64), como el usuario con sudo (azureuser).
# Instala Docker, agrega 2 GB de swap y clona/actualiza el repo. Es idempotente.
#   ssh azureuser@<IP> 'bash -s' < deploy/preparar_vm.sh
set -euo pipefail

REPO="https://github.com/LucianoCh21/sistema.cerveceria.ombu.git"
RAMA="feature/iso25010-luciano"
DESTINO="$HOME/ombu"

echo "==> Arquitectura: $(uname -m)"
[ "$(uname -m)" = "x86_64" ] || { echo "ERROR: la imagen de SQL Server requiere x86_64." >&2; exit 1; }

echo "==> Docker"
if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"
sudo docker compose version

echo "==> Swap de 2 GB"
if ! sudo swapon --show | grep -q /swapfile; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -h

echo "==> Repositorio ($RAMA)"
if [ -d "$DESTINO/.git" ]; then
    git -C "$DESTINO" fetch origin
    git -C "$DESTINO" checkout "$RAMA"
    git -C "$DESTINO" pull --ff-only origin "$RAMA"
else
    git clone --branch "$RAMA" "$REPO" "$DESTINO"
fi
git -C "$DESTINO" log --oneline -1
echo "OK: VM preparada. Falta copiar deploy/.env y ejecutar ./deploy/levantar.sh --vm --primera-vez"
