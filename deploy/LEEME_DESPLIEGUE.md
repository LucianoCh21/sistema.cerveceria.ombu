# Despliegue de Cervecería Ombú en 3 pasos

Todo corre en tu máquina con Docker y queda publicado en una URL pública `https://….trycloudflare.com` mediante Cloudflare Tunnel. No hace falta abrir puertos ni tener cuenta en Cloudflare.

**Requisitos:** Docker Desktop abierto, con `docker compose` v2; `cloudflared` instalado; unos 3 GB de RAM libres.

## 1. Traer el código y el `.env`

```bash
git checkout feature/iso25010-luciano && git pull
```

Guardá el archivo `.env` que te pasaron **en privado** como `deploy/.env`. No lo subas a git: ya está en `.gitignore`.

## 2. Levantar

- **Primera vez en esta máquina** (crea y carga la base; pide escribir `BORRAR`):
  ```bash
  ./deploy/levantar.sh --primera-vez
  ```
- **Todas las demás veces** (conserva los datos):
  ```bash
  ./deploy/levantar.sh
  ```

En Windows, ejecutalo desde **Git Bash** o **WSL**.

## 3. Abrir la URL

Al final, el script imprime un recuadro con la **URL**. Entrá con el usuario `tribunal` y la contraseña `BASIC_AUTH_PASSWORD` de `deploy/.env`. La URL cambia cada vez que se reinicia el túnel.

Para apagar: `./deploy/apagar.sh`. Apaga el túnel y los contenedores **sin borrar los datos**.

---

## ¿Cómo sé que funciona?

1. El script termina mostrando `CERVECERÍA OMBÚ PUBLICADA`.
2. `https://<URL>/api/health` responde `{"ok":true,...}`.
3. En el navegador se ve el muro de canillas y la terminal NFC lista las tarjetas.

## Si algo falla

| Mensaje del script | Qué hacer |
|---|---|
| `Docker no responde…` | Abrí Docker Desktop y esperá a que diga *Running*. |
| `Falta 'docker compose' v2` | Actualizá Docker Desktop. |
| `No se encontró 'cloudflared'` | Instalalo: Windows `winget install Cloudflare.cloudflared`, macOS `brew install cloudflared`. Para probar sin túnel: `./deploy/levantar.sh --sin-tunel`. |
| `Falta deploy/.env` | Pedí el archivo privado y guardalo en `deploy/.env`. |
| `SQL Server no arrancó a tiempo` | Liberá memoria (cerrá programas) y volvé a correr el script. Logs: `docker compose -p ombu-deploy logs sqlserver`. |
| `La API no quedó sana` | Si es la primera vez en esa máquina: `./deploy/levantar.sh --primera-vez`. Si no, revisá `docker compose -p ombu-deploy logs api`. |
| `container name "/sqlserver" is already in use` | Hay contenedores de desarrollo con el mismo nombre. Detenelos **sin borrar datos**: `docker compose down` (sin `-v`) en la raíz del repo, y volvé a correr el script. |
| `cloudflared no devolvió una URL` | Revisá `deploy/runtime/cloudflared.log` (¿hay internet?). Corré `./deploy/apagar.sh` y después `./deploy/levantar.sh`. |

⚠️ **Nunca** uses `docker compose down -v`, porque borra la base. **No** vuelvas a usar `--primera-vez` después de cargar datos de la demo.
