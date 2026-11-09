# Evidencia de despliegue y smoke test (AE4) — 09/11/2026

Despliegue con `./deploy/levantar.sh --primera-vez` en la máquina de Lucrecia (Ubuntu 24.04, Docker 29.1, Compose 2.40, cloudflared 2026.10.7), publicado por Cloudflare Tunnel (`https://….trycloudflare.com`, URL efímera). Rama `feature/iso25010-luciano`, con los fixes `669c3f4`, `12cb92f`, `b4056dc`, `4fd5dd8`, `45946d3` y `338e7b3`.

**Resumen completo:** [`00_resumen.txt`](00_resumen.txt). **Scripts usados:** `smoke_e1_e5.sh` y `smoke_verificacion_b.sh` (leen `deploy/.env`, no imprimen secretos).

| Prueba | Resultado |
|---|---|
| E1 Muro | `/` sin credenciales → 401 (basic_auth); con credenciales → 200 con `nosniff`/`DENY`; `/api/canillas` → 10 canillas; puertos internos solo en `127.0.0.1` |
| E2 Terminal | Sesión NFC con TTL 45 s en Redis; despacho 201 y repetición con la misma `Idempotency-Key` → 200 `idempotencia_aplicada` (1 sola fila); PDF con tarjeta `******D4E5` y sin saldo |
| E3 Asíncrono | Outbox publicado (7/7) y el worker registra `Evento recibido: Despacho #…` |
| E4 Panel admin | Caché `sql-server` → `redis-cache` (TTL 60 s); barril 9 → 404; canilla ocupada → 400; token de terminal → 403; al retirar un barril la clave de caché se borra |
| Padlet 1 | Misma clave en paralelo → un solo cobro (409 o respuesta previa); un tap con dos claves → un 201 y un 403 |
| E5 RabbitMQ caído | Despacho 201 igual, 3 eventos pendientes, `health` muestra `rabbitmq: caido`; al volver, 0 pendientes en ~9 s |
| E5 Redis caído | Resumen desde SQL en ~3 s; tap NFC → 503 `SESSION_UNAVAILABLE` en ~1,7 s (antes del fix `45946d3`: 43 s y 23 s/500) |
| Verificación A (UPDLOCK) | Otra sesión SQL retiene el barril 8 s → el despacho espera y responde 201 al liberarse |
| Verificación B (UPDLOCK) | Barril con 0,40 L y dos despachos simultáneos de 0,25 L → un 201 y un 409 `INSUFFICIENT_STOCK`; quedan 0,15 L |

**Hallazgos del smoke test, corregidos en el momento:** timeout de Redis (`45946d3`) y contraseña de RabbitMQ visible en los logs (`338e7b3`). Después de las pruebas se reinicializaron los datos de demo.
