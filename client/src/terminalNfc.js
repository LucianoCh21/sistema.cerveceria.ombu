/**
 * Ombú - Cervecería de Barrio | Módulo Frontend de Terminal Autoservicio NFC
 * Módulo de Lucrecia Sabrina Mencia (ae2/lecturas-nfc)
 * Días 3 y 5: Simulación de Tap, Cuenta Regresiva TTL (45s), Servido e Idempotencia y Ticket PDF.
 */

const API_BASE = 'http://localhost:3000/api';

// Estado reactivo de la terminal
const terminalState = {
    canillaSeleccionada: 1,
    tarjetaSeleccionada: 'A1B2C3D4E5',
    sesionActiva: null,
    timerInterval: null,
    segundosRestantes: 45,
    formatoSeleccionado: { id: 2, nombre: 'Pinta', ml: 500, precio: 3500 },
    ultimoDespacho: null
};

// Tarjetas preconfiguradas para pruebas rápidas
const TARJETAS_PRESET = [
    { uid: 'A1B2C3D4E5', titular: 'Juan Pérez', saldo: 6500, tipo: 'Nominada' },
    { uid: 'C3D4E5F6A1', titular: 'María Gómez', saldo: 4200, tipo: 'Nominada' },
    { uid: 'F6G7H8I9J0', titular: 'Consumidor Final', saldo: 5000, tipo: 'Anónima' },
    { uid: 'B2C3D4E5F6', titular: 'Carlos López (Bloqueada)', saldo: 8000, tipo: 'Inactiva' },
    { uid: 'D4E5F6A1B2', titular: 'Ana Torres (Sin Fondos)', saldo: 0, tipo: 'Sin Saldo' }
];

// Canillas del Tap Wall
const CANILLAS_INFO = [
    { id: 1, estilo: 'Caravana IPA', ibu: 48, abv: 5.8 },
    { id: 2, estilo: 'Cruz Diablo', ibu: 62, abv: 7.2 },
    { id: 3, estilo: 'Golden Ale', ibu: 20, abv: 4.5 },
    { id: 4, estilo: 'Porter Robust', ibu: 35, abv: 5.5 },
    { id: 5, estilo: 'Honey Beer', ibu: 18, abv: 5.0 },
    { id: 6, estilo: 'Red Ale', ibu: 25, abv: 5.2 },
    { id: 7, estilo: 'APA Citra', ibu: 40, abv: 5.4 }
];

// Formatos de servicio disponibles
const FORMATOS_DISPONIBLES = [
    { id: 1, nombre: 'Media Pinta', ml: 250, precio: 1800, icon: '🍺' },
    { id: 2, nombre: 'Pinta', ml: 500, precio: 3500, icon: '🍻' },
    { id: 3, nombre: 'Litro', ml: 1000, precio: 6500, icon: '🛢️' }
];

/**
 * Inicialización de la Terminal NFC
 */
function inicializarTerminalNFC() {
    renderizarSelectores();
    asignarEventosNFC();
}

/**
 * Renderiza los botones de canillas y tarjetas preset en el DOM
 */
function renderizarSelectores() {
    // 1. Selector de canillas
    const canillasContainer = document.getElementById('canillas-selector-grid');
    if (canillasContainer) {
        canillasContainer.innerHTML = CANILLAS_INFO.map(c => `
            <button type="button" class="canilla-btn-chip ${c.id === terminalState.canillaSeleccionada ? 'selected' : ''}" data-canilla="${c.id}">
                <span class="canilla-chip-num">Canilla #${c.id}</span>
                <span class="canilla-chip-name">${c.estilo}</span>
            </button>
        `).join('');
    }

    // 2. Selector de tarjetas rápidas
    const tarjetasContainer = document.getElementById('preset-cards-list');
    if (tarjetasContainer) {
        tarjetasContainer.innerHTML = TARJETAS_PRESET.map(t => `
            <div class="preset-card-item ${t.uid === terminalState.tarjetaSeleccionada ? 'selected' : ''}" data-uid="${t.uid}">
                <div>
                    <span class="preset-card-uid">${t.uid}</span>
                    <span style="margin-left: 0.5rem; color: var(--text-secondary); font-size: 0.78rem;">${t.titular}</span>
                </div>
                <div style="font-weight: 700; color: ${t.saldo > 0 ? 'var(--color-success)' : 'var(--color-error)'};">
                    $${t.saldo.toLocaleString('es-AR')}
                </div>
            </div>
        `).join('');
    }

    // 3. Selector de formatos de servicio
    renderizarFormatos();
}

function renderizarFormatos() {
    const formatosContainer = document.getElementById('formatos-selector-grid');
    if (formatosContainer) {
        formatosContainer.innerHTML = FORMATOS_DISPONIBLES.map(f => `
            <button type="button" class="formato-btn ${f.id === terminalState.formatoSeleccionado.id ? 'selected' : ''}" data-formato-id="${f.id}">
                <span class="formato-icon">${f.icon}</span>
                <span class="formato-nombre">${f.nombre}</span>
                <span class="formato-volumen">${f.ml} ml</span>
                <span class="formato-precio">$${f.precio.toLocaleString('es-AR')}</span>
            </button>
        `).join('');
    }
}

/**
 * Asigna los event listeners
 */
function asignarEventosNFC() {
    // Selección de canilla
    document.getElementById('canillas-selector-grid')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.canilla-btn-chip');
        if (!chip) return;
        terminalState.canillaSeleccionada = Number(chip.getAttribute('data-canilla'));
        document.querySelectorAll('.canilla-btn-chip').forEach(el => el.classList.remove('selected'));
        chip.classList.add('selected');
    });

    // Selección de tarjeta preset
    document.getElementById('preset-cards-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('.preset-card-item');
        if (!item) return;
        const uid = item.getAttribute('data-uid');
        terminalState.tarjetaSeleccionada = uid;
        const inputCustom = document.getElementById('input-nfc-custom');
        if (inputCustom) inputCustom.value = uid;
        document.querySelectorAll('.preset-card-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
    });

    // Input personalizado de UID
    document.getElementById('input-nfc-custom')?.addEventListener('input', (e) => {
        terminalState.tarjetaSeleccionada = e.target.value.trim().toUpperCase();
        document.querySelectorAll('.preset-card-item').forEach(el => el.classList.remove('selected'));
    });

    // Botón de Tap NFC (Aproximar Tarjeta)
    document.getElementById('btn-tap-nfc')?.addEventListener('click', () => {
        const uid = terminalState.tarjetaSeleccionada || document.getElementById('input-nfc-custom')?.value.trim();
        if (!uid) {
            alert('Por favor seleccione o ingrese el UID de una tarjeta NFC.');
            return;
        }
        ejecutarTapNFC(uid, terminalState.canillaSeleccionada);
    });

    // Cancelar sesión
    document.getElementById('btn-cancelar-sesion')?.addEventListener('click', () => {
        finalizarSesion('Sesión cancelada manualmente por el usuario.');
    });

    // Selección de formato
    document.getElementById('formatos-selector-grid')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.formato-btn');
        if (!btn) return;
        const fId = Number(btn.getAttribute('data-formato-id'));
        const fObj = FORMATOS_DISPONIBLES.find(x => x.id === fId);
        if (fObj) {
            terminalState.formatoSeleccionado = fObj;
            renderizarFormatos();
        }
    });

    // Botón de Servir Cerveza
    document.getElementById('btn-servir-cerveza')?.addEventListener('click', () => {
        ejecutarDespacho();
    });

    // Cerrar modal de ticket
    document.getElementById('btn-cerrar-modal')?.addEventListener('click', () => {
        const modal = document.getElementById('ticket-modal');
        if (modal) modal.style.display = 'none';
        finalizarSesion('Servido finalizado con éxito.');
    });

    // Descargar PDF de ticket
    document.getElementById('btn-descargar-pdf')?.addEventListener('click', () => {
        if (terminalState.ultimoDespacho && terminalState.ultimoDespacho.id_despacho) {
            window.open(`${API_BASE}/despachos/${terminalState.ultimoDespacho.id_despacho}/comprobante`, '_blank');
        }
    });
}

/**
 * DÍA 2 & 3: Llama al endpoint de autenticación e inicia el TTL en el frontend
 */
async function ejecutarTapNFC(idTarjeta, idCanilla) {
    const btnTap = document.getElementById('btn-tap-nfc');
    if (btnTap) {
        btnTap.disabled = true;
        btnTap.innerHTML = '<span>⏳</span> Leyendo tarjeta NFC...';
    }

    try {
        const response = await fetch(`${API_BASE}/nfc/autenticar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_tarjeta: idTarjeta,
                id_canilla: idCanilla
            })
        });

        const data = await response.json();

        if (response.ok && data.ok) {
            // Éxito: Activar panel de sesión y cuenta regresiva
            terminalState.sesionActiva = data;
            iniciarCuentaRegresiva(data.ttl || 45);
        } else {
            // Manejo de errores específicos (Inactiva, Saldo Insuficiente, Inexistente)
            const msg = data.error || 'No se pudo autenticar la tarjeta NFC.';
            alert(`⚠️ Error NFC (${data.codigo || response.status}):\n${msg}`);
        }
    } catch (err) {
        console.error('Error de red al autenticar NFC:', err);
        alert('Error de conexión con el servidor backend en http://localhost:3000');
    } finally {
        if (btnTap) {
            btnTap.disabled = false;
            btnTap.innerHTML = '<span>📲</span> Aproximar Tarjeta (Tap NFC)';
        }
    }
}

/**
 * DÍA 3: Temporizador visual regresivo sincronizado con el TTL de Redis (45 segundos)
 */
function iniciarCuentaRegresiva(ttlInicial = 45) {
    // Limpiar intervalo previo si existiese
    if (terminalState.timerInterval) {
        clearInterval(terminalState.timerInterval);
    }

    terminalState.segundosRestantes = ttlInicial;

    // Actualizar interfaz a estado "Activo"
    const panelStandby = document.getElementById('session-standby');
    const panelActive = document.getElementById('session-active-content');
    if (panelStandby) panelStandby.style.display = 'none';
    if (panelActive) panelActive.style.display = 'flex';

    // Rellenar datos del usuario
    document.getElementById('lbl-titular').textContent = terminalState.sesionActiva.cliente_nombre || 'Consumidor Final';
    document.getElementById('lbl-uid').textContent = `NFC: ${terminalState.sesionActiva.id_tarjeta}`;
    document.getElementById('lbl-saldo').textContent = `$${Number(terminalState.sesionActiva.saldo_disponible).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

    const beerInfo = CANILLAS_INFO.find(c => c.id === terminalState.canillaSeleccionada);
    document.getElementById('lbl-canilla-activa').textContent = `Canilla #${terminalState.canillaSeleccionada} — ${beerInfo ? beerInfo.estilo : 'Cerveza Artesanal'}`;

    actualizarVisualTimer(ttlInicial, ttlInicial);

    terminalState.timerInterval = setInterval(() => {
        terminalState.segundosRestantes--;

        actualizarVisualTimer(terminalState.segundosRestantes, ttlInicial);

        if (terminalState.segundosRestantes <= 0) {
            clearInterval(terminalState.timerInterval);
            terminalState.timerInterval = null;
            finalizarSesion('⚠️ La sesión ha expirado (TTL de 45 segundos agotado en Redis). Grifo cerrado por seguridad.');
        }
    }, 1000);
}

function actualizarVisualTimer(segundos, total) {
    const numDisplay = document.getElementById('countdown-number');
    const fillBar = document.getElementById('countdown-progress-fill');
    const box = document.getElementById('countdown-box');

    if (numDisplay) numDisplay.textContent = `${segundos}s`;

    const porcentaje = Math.max(0, (segundos / total) * 100);
    if (fillBar) fillBar.style.width = `${porcentaje}%`;

    if (box) {
        box.classList.remove('warning', 'danger');
        if (segundos <= 5) {
            box.classList.add('danger');
        } else if (segundos <= 15) {
            box.classList.add('warning');
        }
    }
}

/**
 * Finaliza la sesión actual y regresa la terminal a standby
 */
function finalizarSesion(mensajeNotificacion = null) {
    if (terminalState.timerInterval) {
        clearInterval(terminalState.timerInterval);
        terminalState.timerInterval = null;
    }

    terminalState.sesionActiva = null;

    const panelStandby = document.getElementById('session-standby');
    const panelActive = document.getElementById('session-active-content');
    const animationBox = document.getElementById('pouring-animation');

    if (panelStandby) panelStandby.style.display = 'block';
    if (panelActive) panelActive.style.display = 'none';
    if (animationBox) animationBox.style.display = 'none';

    if (mensajeNotificacion) {
        alert(mensajeNotificacion);
    }
}

/**
 * DÍA 4 & 5: Ejecución del Despacho Transaccional e Idempotente con Emisión de PDF
 */
async function ejecutarDespacho() {
    if (!terminalState.sesionActiva) {
        alert('No hay una sesión NFC activa para autorizar el servido.');
        return;
    }

    const { formatoSeleccionado, canillaSeleccionada, sesionActiva } = terminalState;

    // Validar saldo suficiente
    if (sesionActiva.saldo_disponible < formatoSeleccionado.precio) {
        alert(`Saldo insuficiente ($${sesionActiva.saldo_disponible}) para el formato seleccionado ($${formatoSeleccionado.precio}).`);
        return;
    }

    // Generar clave de Idempotencia estricta (UUID / token único)
    const idempotencyKey = `idem-tap-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Mostrar animación de servido
    const panelActive = document.getElementById('session-active-content');
    const animationBox = document.getElementById('pouring-animation');
    if (panelActive) panelActive.style.display = 'none';
    if (animationBox) animationBox.style.display = 'flex';

    try {
        const response = await fetch(`${API_BASE}/despachos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify({
                id_tarjeta: sesionActiva.id_tarjeta,
                id_canilla: canillaSeleccionada,
                id_formato: formatoSeleccionado.id,
                formato: formatoSeleccionado.nombre,
                mililitros: formatoSeleccionado.ml,
                importe: formatoSeleccionado.precio
            })
        });

        const data = await response.json();

        // Pausa breve para disfrutar la animación de llenado de cerveza
        await new Promise(r => setTimeout(r, 2200));

        if (response.ok && data.ok) {
            terminalState.ultimoDespacho = data;
            mostrarModalTicket(data);
        } else {
            alert(`⚠️ Error al servir cerveza (${data.codigo || response.status}):\n${data.error || 'Error en la transacción.'}`);
            finalizarSesion();
        }
    } catch (err) {
        console.error('Error al ejecutar despacho:', err);
        alert('Error de conexión al procesar el servido.');
        finalizarSesion();
    }
}

/**
 * DÍA 5: Muestra el modal con el ticket de consumo y botón de descarga de PDF
 */
function mostrarModalTicket(despacho) {
    const modal = document.getElementById('ticket-modal');
    if (!modal) return;

    const beerInfo = CANILLAS_INFO.find(c => c.id === terminalState.canillaSeleccionada);

    document.getElementById('modal-id-despacho').textContent = `#${despacho.id_despacho}`;
    document.getElementById('modal-cerveza').textContent = beerInfo ? beerInfo.estilo : 'Cerveza Ombú';
    document.getElementById('modal-formato').textContent = `${despacho.formato} (${despacho.volumen_litros * 1000} ml)`;
    document.getElementById('modal-importe').textContent = `$${Number(despacho.precio_cobrado).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('modal-saldo-restante').textContent = `$${Number(despacho.saldo_restante).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('modal-cliente').textContent = despacho.cliente_nombre || 'Consumidor Final';

    modal.style.display = 'flex';
}

// Auto-inicializar al cargar
document.addEventListener('DOMContentLoaded', inicializarTerminalNFC);
