#!/usr/bin/env bash
# Despliegue completo en la VM desde esta máquina (por SSH).
#   ./deploy/desplegar_vm.sh <IP> <FQDN> <ACME_EMAIL> [--primera-vez]
# Pasos: genera deploy/runtime/vm.env (si no existe) → prepara la VM → copia el .env → levanta en modo --vm.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IP="${1:?Uso: desplegar_vm.sh <IP> <FQDN> <ACME_EMAIL> [--primera-vez]}"
FQDN="${2:?Falta FQDN}"
EMAIL="${3:?Falta ACME_EMAIL}"
EXTRA="${4:-}"
VM="azureuser@${IP}"
SSH_OPTS=(-i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=accept-new)

echo "==> 1/4 Generando .env de la VM"
"$RAIZ/deploy/generar_env_vm.sh" "$FQDN" "$EMAIL"

echo "==> 2/4 Preparando la VM (Docker, swap, repo)"
ssh "${SSH_OPTS[@]}" "$VM" 'bash -s' < "$RAIZ/deploy/preparar_vm.sh"

echo "==> 3/4 Copiando deploy/.env (privado) a la VM"
scp "${SSH_OPTS[@]}" -q "$RAIZ/deploy/runtime/vm.env" "$VM:ombu/deploy/.env"
ssh "${SSH_OPTS[@]}" "$VM" 'chmod 600 ~/ombu/deploy/.env'

echo "==> 4/4 Levantando en modo VM"
# sg docker: el grupo recién agregado no aplica a la sesión SSH actual. -t para la confirmación BORRAR.
ssh "${SSH_OPTS[@]}" -t "$VM" "cd ~/ombu && sg docker -c './deploy/levantar.sh --vm ${EXTRA}'"
