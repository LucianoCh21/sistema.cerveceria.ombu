/**
 * Ombú - Cervecería de Barrio | Módulo Frontend de Terminal Autoservicio NFC
 * Módulo de Lucrecia Sabrina Mencia (ae2/lecturas-nfc)
 * Días 3 y 5: Simulación de Tap, Cuenta Regresiva TTL (45s), Servido e Idempotencia y Ticket PDF.
 * Conexión dinámica 100% a OmbuDB (Canillas, Tarjetas NFC, Formatos y Precios vigentes).
 */

const API_BASE = 'http://localhost:3000/api';

// Estado reactivo de la terminal
const terminalState = {
    canillas: [],
    tarjetas: [],
    formatos: [],
    canillaSeleccionada: null,
    tarjetaSeleccionada: null,
    sesionActiva: null,
    timerInterval: null,
    segundosRestantes: 45,
    formatoSeleccionado: null,
    ultimoDespacho: null
};

/**
 * Inicialización de la Terminal NFC
 */
async function inicializarTerminalNFC() {
    asignarEventosNFC();
    await cargarDatosDesdeServidor();
}

/**
 * Consulta la base de datos para cargar canillas, tarjetas emitidas y precios vigentes
 */
async function cargarDatosDesdeServidor() {
    try {
        // 1. Cargar canillas reales desde SQL Server
        const resCanillas = await fetch(`${API_BASE}/canillas`);
        if (resCanillas.ok) {
            terminalState.canillas = await resCanillas.json();
            // Buscar la primera canilla con barril conectado y activa
            const canillaOptima = terminalState.canillas.find(c => c.estado === 'Activa' && c.id_barril) || terminalState.canillas[0];
            if (!terminalState.canillaSeleccionada && canillaOptima) {
                terminalState.canillaSeleccionada = canillaOptima.id_canilla || canillaOptima.numero;
            }
        }

        // 2. Cargar tarjetas NFC reales desde OmbuDB
        const resTarjetas = await fetch(`${API_BASE}/nfc/tarjetas`);
        if (resTarjetas.ok) {
            const dataTarjetas = await resTarjetas.json();
            terminalState.tarjetas = dataTarjetas.data || [];
            if (!terminalState.tarjetaSeleccionada && terminalState.tarjetas.length > 0) {
                terminalState.tarjetaSeleccionada = terminalState.tarjetas[0].uid;
                const inputCustom = document.getElementById('input-nfc-custom');
                if (inputCustom) inputCustom.value = terminalState.tarjetaSeleccionada;
            }
        }

        // 3. Cargar formatos y precios vigentes para la canilla seleccionada
        if (terminalState.canillaSeleccionada) {
            await cargarFormatosCanilla(terminalState.canillaSeleccionada);
        }

        // 4. Renderizar selectores en pantalla
        renderizarSelectores();
    } catch (err) {
        console.error('Error al cargar datos desde la base de datos para la terminal NFC:', err);
    }
}

/**
 * Consulta a la base de datos los formatos de servicio y precios vigentes de la cerveza conectada
 */
async function cargarFormatosCanilla(idCanilla) {
    if (!idCanilla) return;
    try {
        const res = await fetch(`${API_BASE}/nfc/formatos?id_canilla=${idCanilla}`);
        if (res.ok) {
            const data = await res.json();
            terminalState.formatos = data.formatos || [];
            if (terminalState.formatos.length > 0) {
                // Conservar selección previa si existe en la nueva lista, o elegir la Pinta (500ml)
                const anteriorId = terminalState.formatoSeleccionado?.id;
                terminalState.formatoSeleccionado = terminalState.formatos.find(f => f.id === anteriorId) ||
                    terminalState.formatos.find(f => f.ml === 500) ||
                    terminalState.formatos[0];
            }
        }
    } catch (err) {
        console.error('Error al consultar formatos y precios desde OmbuDB:', err);
    }
}

/**
 * Renderiza los botones de canillas, tarjetas preset y formatos en el DOM
 */
function renderizarSelectores() {
    renderizarCanillas();
    renderizarTarjetasPreset();
    renderizarFormatos();
}

function renderizarCanillas() {
    const canillasContainer = document.getElementById('canillas-selector-grid');
    if (!canillasContainer) return;

    if (!terminalState.canillas || terminalState.canillas.length === 0) {
        canillasContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">Consultando canillas en la base de datos...</span>`;
        return;
    }

    canillasContainer.innerHTML = terminalState.canillas.map(c => {
        const id = c.id_canilla || c.numero;
        const nombreCerveza = c.nombre_cerveza || c.estilo || 'Sin Barril';
        const isSelected = id === terminalState.canillaSeleccionada;
        const hasBarril = Boolean(c.id_barril && c.estado === 'Activa');
        return `
            <button type="button" class="canilla-btn-chip ${isSelected ? 'selected' : ''} ${!hasBarril ? 'inactiva' : ''}" data-canilla="${id}">
                <span class="canilla-chip-num">Canilla #${c.numero || id}</span>
                <span class="canilla-chip-name">${nombreCerveza}</span>
            </button>
        `;
    }).join('');
}

function renderizarTarjetasPreset() {
    const tarjetasContainer = document.getElementById('preset-cards-list');
    if (!tarjetasContainer) return;

    if (!terminalState.tarjetas || terminalState.tarjetas.length === 0) {
        tarjetasContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">No hay tarjetas registradas en OmbuDB.</span>`;
        return;
    }

    tarjetasContainer.innerHTML = terminalState.tarjetas.map(t => {
        const isSelected = t.uid === terminalState.tarjetaSeleccionada;
        const saldoNum = Number(t.saldo) || 0;
        return `
            <div class="preset-card-item ${isSelected ? 'selected' : ''}" data-uid="${t.uid}">
                <div>
                    <span class="preset-card-uid">${t.uid}</span>
                    <span style="margin-left: 0.5rem; color: var(--text-secondary); font-size: 0.78rem;">${t.titular}</span>
                </div>
                <div style="font-weight: 700; color: ${saldoNum > 0 ? 'var(--color-success)' : 'var(--color-error)'};">
                    $${saldoNum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </div>
            </div>
        `;
    }).join('');
}

function renderizarFormatos() {
    const formatosContainer = document.getElementById('formatos-selector-grid');
    if (!formatosContainer) return;

    if (!terminalState.formatos || terminalState.formatos.length === 0) {
        formatosContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">Consultando precios vigentes de la base de datos...</span>`;
        return;
    }

    formatosContainer.innerHTML = terminalState.formatos.map(f => {
        const isSelected = terminalState.formatoSeleccionado && f.id === terminalState.formatoSeleccionado.id;
        const precioNum = Number(f.precio) || 0;
        return `
            <button type="button" class="formato-btn ${isSelected ? 'selected' : ''}" data-formato-id="${f.id}">
                <span class="formato-icon">${f.icon || '🍺'}</span>
                <span class="formato-nombre">${f.nombre}</span>
                <span class="formato-volumen">${f.ml} ml</span>
                <span class="formato-precio">$${precioNum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
            </button>
        `;
    }).join('');
}

/**
 * Asigna los event listeners
 */
function asignarEventosNFC() {
    // Selección de canilla
    document.getElementById('canillas-selector-grid')?.addEventListener('click', async (e) => {
        const chip = e.target.closest('.canilla-btn-chip');
        if (!chip) return;
        const canillaId = Number(chip.getAttribute('data-canilla'));
        terminalState.canillaSeleccionada = canillaId;
        document.querySelectorAll('.canilla-btn-chip').forEach(el => el.classList.remove('selected'));
        chip.classList.add('selected');

        // Cargar precios y formatos de la cerveza conectada a esta canilla desde la BD
        await cargarFormatosCanilla(canillaId);
        renderizarFormatos();
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
        const fObj = terminalState.formatos.find(x => x.id === fId);
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

    // Descargar PDF de ticket (Día 5)
    document.getElementById('btn-descargar-pdf')?.addEventListener('click', () => {
        if (terminalState.ultimoDespacho && terminalState.ultimoDespacho.id_despacho) {
            if (window.ComprobanteManager) {
                window.ComprobanteManager.descargarArchivo(terminalState.ultimoDespacho.id_despacho);
            } else {
                window.open(`${API_BASE}/despachos/${terminalState.ultimoDespacho.id_despacho}/comprobante`, '_blank');
            }
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
            iniciarCuentaRegresiva(data.ttl_segundos || 45);
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
    if (terminalState.timerInterval) {
        clearInterval(terminalState.timerInterval);
    }

    terminalState.segundosRestantes = ttlInicial;

    // Actualizar interfaz a estado "Activo"
    const panelStandby = document.getElementById('session-standby');
    const panelActive = document.getElementById('session-active-content');
    if (panelStandby) panelStandby.style.display = 'none';
    if (panelActive) panelActive.style.display = 'flex';

    // Rellenar datos reales devueltos por la base de datos
    document.getElementById('lbl-titular').textContent = terminalState.sesionActiva.cliente_nombre || 'Consumidor Final';
    document.getElementById('lbl-uid').textContent = `NFC: ${terminalState.sesionActiva.id_tarjeta}`;
    document.getElementById('lbl-saldo').textContent = `$${Number(terminalState.sesionActiva.saldo_disponible).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

    const canillaObj = terminalState.canillas.find(c => (c.id_canilla || c.numero) === terminalState.canillaSeleccionada);
    const nombreCerveza = canillaObj?.nombre_cerveza || canillaObj?.estilo || 'Cerveza Artesanal';
    document.getElementById('lbl-canilla-activa').textContent = `Canilla #${terminalState.canillaSeleccionada} — ${nombreCerveza}`;

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

    if (!formatoSeleccionado) {
        alert('Por favor seleccione un formato de servicio.');
        return;
    }

    const precioMonto = Number(formatoSeleccionado.precio);

    // Validar saldo suficiente
    if (sesionActiva.saldo_disponible < precioMonto) {
        alert(`Saldo insuficiente ($${sesionActiva.saldo_disponible}) para el formato seleccionado ($${precioMonto}).`);
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
                importe: precioMonto
            })
        });

        const data = await response.json();

        // Pausa breve para animación cervecera de llenado
        await new Promise(r => setTimeout(r, 2200));

        if (response.ok && data.ok) {
            terminalState.ultimoDespacho = data;
            mostrarModalTicket(data);

            // Refrescar tarjetas de la base de datos para actualizar saldo en pantalla
            const resTarjetas = await fetch(`${API_BASE}/nfc/tarjetas`);
            if (resTarjetas.ok) {
                const dataTarjetas = await resTarjetas.json();
                terminalState.tarjetas = dataTarjetas.data || [];
                renderizarTarjetasPreset();
            }

            // Refrescar stock de barriles si el dashboard de stock está disponible
            if (window.dashboardStock && typeof window.dashboardStock.cargarStock === 'function') {
                window.dashboardStock.cargarStock();
            }
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

    document.getElementById('modal-id-despacho').textContent = `#${despacho.id_despacho}`;
    document.getElementById('modal-cerveza').textContent = despacho.cerveza || 'Cerveza Ombú';
    document.getElementById('modal-formato').textContent = `${despacho.formato} (${despacho.mililitros_servidos || (despacho.volumen_litros * 1000)} ml)`;
    document.getElementById('modal-importe').textContent = `$${Number(despacho.importe_cobrado || despacho.precio_cobrado).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('modal-saldo-restante').textContent = `$${Number(despacho.saldo_restante).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('modal-cliente').textContent = despacho.cliente || despacho.cliente_nombre || 'Consumidor Final';

    modal.style.display = 'flex';
}

// Exponer para la navegación reactiva entre vistas
window.terminalNfc = {
    cargarDatosDesdeServidor
};

// Auto-inicializar al cargar
document.addEventListener('DOMContentLoaded', inicializarTerminalNFC);
