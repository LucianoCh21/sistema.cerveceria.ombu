# Despliegue de Cervecería Ombú en 3 pasos

Todo corre en tu laptop con Docker y queda publicado en una URL pública `https://….trycloudflare.com` mediante Cloudflare Tunnel. No hace falta abrir puertos en el router ni tener cuenta en Cloudflare.

**Requisitos:**
- Docker funcionando, con `docker compose` **v2**.
- `cloudflared` instalado.
- Unos **3 GB de RAM libres**.
- En **Windows**, todo (repo, comandos y `cloudflared`) va **dentro de WSL** (Ubuntu).

## 1. Traer el código y el `.env`

```bash
cd ~/sistema.cerveceria.ombu          # en Windows: el clon dentro de WSL, NO en /mnt/c/...
git fetch origin
git checkout feature/iso25010-luciano
git pull
```

Guardá el archivo `.env` que te pasaron **en privado** como `deploy/.env`, en la misma carpeta que este LEEME. No lo subas a git: ya está en `.gitignore`.

## 2. Levantar

- **Primera vez en esta laptop** (crea y carga la base; pide escribir `BORRAR`):
  ```bash
  ./deploy/levantar.sh --primera-vez
  ```
- **Todas las demás veces** (conserva los datos):
  ```bash
  ./deploy/levantar.sh
  ```

La primera vez tarda varios minutos, porque descarga la imagen de SQL Server (~1,6 GB) y construye la API.

## 3. Abrir la URL

Al final, el script imprime un recuadro `CERVECERÍA OMBÚ PUBLICADA` con la **URL**. Entrá con el usuario `tribunal` y la contraseña `BASIC_AUTH_PASSWORD` de `deploy/.env`.

- **La URL cambia cada vez que se reinicia el túnel.** Pasale al profesor la que esté activa.
- Para apagar: `./deploy/apagar.sh`. Apaga el túnel y los contenedores **sin borrar los datos**.

---

## ¿Cómo sé que funciona?

1. El script termina con el recuadro `CERVECERÍA OMBÚ PUBLICADA`.
2. `https://<URL>/api/health` responde `{"ok":true,...}`.
3. En el navegador (después del usuario y la contraseña) se ve el muro de canillas, y la terminal NFC lista 2 tarjetas.

⚠️ **Nunca** uses `docker compose down -v`, porque borra la base. **No** vuelvas a usar `--primera-vez` después de cargar datos de la demo.

---

## Problemas frecuentes la primera vez

### `permission denied while trying to connect to the docker API` / `Docker no responde…`

- **Linux:**
  1. `sudo usermod -aG docker $USER`.
  2. Cerrá sesión y volvé a entrar (o abrí una terminal nueva).
  3. `docker ps` tiene que andar sin `sudo`.
- **Windows (WSL):**
  1. Abrí Docker Desktop y esperá a que diga *Engine running*.
  2. Andá a *Settings → Resources → WSL integration* y activá tu distro (Ubuntu).
  3. Cerrá y volvé a abrir la terminal de WSL.
- Confirmá con `docker ps`.

### `Falta 'docker compose' v2` (docker compose v1 vs v2)

- El script usa **`docker compose`** (con espacio, v2). El viejo **`docker-compose`** (con guion, v1.x) **no sirve**.
- Verificá con `docker compose version`: tiene que decir `v2.x`.
- **Linux (Ubuntu):** `sudo apt-get install -y docker-compose-v2`.
- **Docker Desktop:** ya lo trae; si no, actualizalo.

### `No se encontró 'cloudflared'`

Se instala **en el mismo lugar donde corrés el script**. En Windows eso es dentro de WSL: el `cloudflared` de Windows (`winget`) no lo ve WSL.

```bash
curl -fL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

En macOS: `brew install cloudflared`. Para probar sin túnel (solo local): `./deploy/levantar.sh --sin-tunel`.

### `port is already allocated` / `address already in use`

- El stack **no usa los puertos 80 ni 8081**. Publica todo **solo en `127.0.0.1`**, en estos puertos:

  | Servicio | Puerto local |
  |---|---|
  | Caddy (entrada del túnel) | 8088 |
  | Caddy HTTPS | 8443 |
  | API | 13000 |
  | SQL Server | 14330 |
  | RabbitMQ | 15680 |
  | Panel de RabbitMQ | 15690 |
  | Redis | 16380 |
  | Cliente | 18080 |

- Si alguno está ocupado:
  1. Fijate quién lo usa: Linux/WSL `ss -ltnp | grep 8088`; Windows (PowerShell) `netstat -ano | findstr 8088`.
  2. Cerrá ese programa, o cambiá el puerto en `deploy/.env`. Por ejemplo, `CADDY_HTTP_PORT=127.0.0.1:8089`.
  3. Volvé a correr el script.
- Si el choque es con otro stack de este proyecto (`container name "/sqlserver" is already in use`), detené el de desarrollo **sin borrar datos**: `docker compose down` (sin `-v`) en la raíz del repo.

### Poca RAM: `SQL Server no arrancó a tiempo`, contenedores que se reinician, o la PC se pone lenta

- SQL Server necesita unos **2 GB** y el stack completo unos **3 GB**.
- Cerrá el navegador con muchas pestañas, el IDE y otros contenedores (`docker ps`).
- **Windows:** WSL limita la memoria. Creá o editá `C:\Users\<vos>\.wslconfig` con:
  ```ini
  [wsl2]
  memory=6GB
  swap=4GB
  ```
  Después, en PowerShell: `wsl --shutdown`, reabrí Docker Desktop y volvé a correr el script.
- Logs: `docker compose -p ombu-deploy logs sqlserver`.

### Windows: correr todo dentro de WSL

- **Git Bash o PowerShell no sirven** para este script. Usá una terminal de **Ubuntu (WSL)**.
- Cloná el repo **dentro de WSL** (`~/`), no en `/mnt/c/...`. Ahí es más rápido y evita problemas de permisos y de fin de línea.
- `bash\r: No such file or directory` o `$'\r': command not found` aparecen si el repo se clonó desde Windows con fin de línea CRLF. Volvé a clonarlo dentro de WSL.
- Si el script dice que `deploy/.env` tiene fin de línea de Windows (CRLF), por ejemplo porque se guardó con el Bloc de notas, corregilo con `sed -i 's/\r$//' deploy/.env`.

### Otros mensajes del script

| Mensaje | Qué hacer |
|---|---|
| `Falta deploy/.env` | Guardá el archivo privado como `deploy/.env` |
| `La API no quedó sana` | Primera vez en esta laptop: `./deploy/levantar.sh --primera-vez`. Si no, revisá `docker compose -p ombu-deploy logs api` |
| `cloudflared no devolvió una URL` | ¿Hay internet? Revisá `deploy/runtime/cloudflared.log`, corré `./deploy/apagar.sh` y después `./deploy/levantar.sh` |
