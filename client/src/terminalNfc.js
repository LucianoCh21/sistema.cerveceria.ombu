/**
 * Ombú - Cervecería de Barrio | Módulo Frontend de Terminal Autoservicio NFC
 * Módulo de Lucrecia Sabrina Mencia (ae2/lecturas-nfc)
 * Días 3 y 5: Simulación de Tap, Cuenta Regresiva TTL (45s), Servido e Idempotencia y Ticket PDF.
 * Conexión dinámica 100% a OmbuDB (Canillas, Tarjetas NFC, Formatos y Precios vigentes).
 */

const API_BASE = (window.OMBU_CONFIG && window.OMBU_CONFIG.API_BASE) || 'http://localhost:3000/api';
const TERMINAL_TOKEN = (window.OMBU_CONFIG && window.OMBU_CONFIG.TERMINAL_TOKEN) || 'terminal-secret-token-ombu';
const AUTH_HEADERS = {
    'Authorization': `Bearer ${TERMINAL_TOKEN}`
};

// F-11: Diccionario amigable para el cliente (sin jerga técnica ni códigos de servidor)
const MENSAJES = {
    CARD_NOT_FOUND:     'No reconocemos esta tarjeta. Acercate a la barra para registrarla.',
    CARD_INACTIVE:      'Esta tarjeta está bloqueada. Consultá en la barra.',
    INSUFFICIENT_FUNDS: 'No tenés saldo suficiente. Recargá tu tarjeta en la barra.',
    SESSION_EXPIRED:    'Se terminó el tiempo para servirte. Volvé a apoyar la tarjeta.',
    SESSION_TAP_MISMATCH: 'La tarjeta fue habilitada en otra canilla. Volvé a apoyarla en esta.',
    SESSION_UNAVAILABLE: 'No pudimos habilitar el grifo en este momento. Intentá de nuevo en unos segundos.',
    INSUFFICIENT_STOCK: 'Esta canilla se está quedando sin cerveza. Elegí otra.',
    NO_ACTIVE_BARREL:   'Esta canilla no está disponible en este momento.',
    INVALID_FORMAT:     'Por favor, seleccioná un formato de servido válido.',
    PRICE_NOT_FOUND:    'Este formato no tiene precio vigente configurado.',
    TRANSACTION_FAILED: 'No pudimos procesar el servido. Intentá nuevamente.',
    DEFAULT:            'No pudimos completar la operación. Intentá de nuevo.'
};

function mostrarAviso(texto, tipo = 'error') {
    const aviso = document.getElementById('terminal-aviso');
    if (!aviso) {
        console.warn(`[Aviso ${tipo}]`, texto);
        return;
    }
    aviso.className = `alerta alerta-${tipo}`;
    aviso.textContent = texto;
    aviso.hidden = false;
    clearTimeout(mostrarAviso._t);
    mostrarAviso._t = setTimeout(() => {
        aviso.hidden = true;
    }, 6000);
}

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
        const resTarjetas = await fetch(`${API_BASE}/nfc/tarjetas`, {
            headers: { ...AUTH_HEADERS }
        });
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
        const res = await fetch(`${API_BASE}/nfc/formatos?id_canilla=${idCanilla}`, {
            headers: { ...AUTH_HEADERS }
        });
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

    const esc = window.escapeHTML || ((v) => v);

    canillasContainer.innerHTML = terminalState.canillas.map(c => {
        const id = c.id_canilla || c.numero;
        const nombreCerveza = c.nombre_cerveza || c.estilo || 'Sin Barril';
        const isSelected = id === terminalState.canillaSeleccionada;
        const hasBarril = Boolean(c.id_barril && c.estado === 'Activa');
        return `
            <button type="button" class="canilla-btn-chip ${isSelected ? 'selected' : ''} ${!hasBarril ? 'inactiva' : ''}" 
                    data-canilla="${esc(id)}" aria-pressed="${isSelected}">
                <span class="canilla-chip-num">Canilla #${esc(c.numero || id)}</span>
                <span class="canilla-chip-name">${esc(nombreCerveza)}</span>
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

    const esc = window.escapeHTML || ((v) => v);

    tarjetasContainer.innerHTML = terminalState.tarjetas.map(t => {
        const isSelected = t.uid === terminalState.tarjetaSeleccionada;
        const saldoNum = Number(t.saldo) || 0;
        const textoSaldo = saldoNum > 0 
            ? `$${saldoNum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` 
            : '$0,00 (Sin saldo)';

        return `
            <button type="button" class="preset-card-item ${isSelected ? 'selected' : ''}" 
                    data-uid="${esc(t.uid)}" aria-pressed="${isSelected}" style="width: 100%; text-align: left; background: var(--bg-card); border: 1px solid var(--border-color); cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.8rem; border-radius: var(--radius-sm); margin-bottom: 0.4rem;">
                <div>
                    <span class="preset-card-uid" style="font-family: monospace; font-weight: 700; color: var(--primary);">${esc(t.uid)}</span>
                    <span style="margin-left: 0.5rem; color: var(--text-secondary); font-size: 0.78rem;">${esc(t.titular)}</span>
                </div>
                <div style="font-weight: 700; color: ${saldoNum > 0 ? 'var(--color-success)' : 'var(--color-error)'}; font-size: 0.85rem;">
                    ${textoSaldo}
                </div>
            </button>
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

    const esc = window.escapeHTML || ((v) => v);

    formatosContainer.innerHTML = terminalState.formatos.map(f => {
        const isSelected = terminalState.formatoSeleccionado && f.id === terminalState.formatoSeleccionado.id;
        const precioNum = Number(f.precio) || 0;
        return `
            <button type="button" class="formato-btn ${isSelected ? 'selected' : ''}" 
                    data-formato-id="${esc(f.id)}" aria-pressed="${Boolean(isSelected)}">
                <span class="formato-icon">${esc(f.icon || '🍺')}</span>
                <span class="formato-nombre">${esc(f.nombre)}</span>
                <span class="formato-volumen">${esc(f.ml)} ml</span>
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
            mostrarAviso('Por favor seleccione o ingrese el UID de una tarjeta NFC.', 'info');
            return;
        }
        ejecutarTapNFC(uid, terminalState.canillaSeleccionada);
    });

    // Cancelar sesión
    document.getElementById('btn-cancelar-sesion')?.addEventListener('click', () => {
        finalizarSesion('Sesión cancelada manualmente.');
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
        if (modal) {
            if (typeof modal.close === 'function') modal.close();
            else modal.style.display = 'none';
        }
        finalizarSesion();
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
            headers: { 
                'Content-Type': 'application/json',
                ...AUTH_HEADERS
            },
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
            mostrarAviso(`¡Bienvenido/a ${data.cliente_nombre || ''}! Grifo habilitado.`, 'exito');
        } else {
            // Manejo de errores amigables (sin alert ni códigos técnicos F-11)
            const mensajeAmigable = MENSAJES[data.codigo] || data.error || MENSAJES.DEFAULT;
            mostrarAviso(mensajeAmigable, 'error');
        }
    } catch (err) {
        console.error('Error de red al autenticar NFC:', err);
        mostrarAviso('No pudimos conectar con el servidor. Verifique la conexión.', 'error');
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
            finalizarSesion('Se terminó el tiempo para servirte. El grifo se ha cerrado por seguridad.');
        }
    }, 1000);
}

function actualizarVisualTimer(segundos, total) {
    const numDisplay = document.getElementById('countdown-number');
    const fillBar = document.getElementById('countdown-progress-fill');
    const box = document.getElementById('countdown-box');
    const anuncioLive = document.getElementById('countdown-anuncio');

    if (numDisplay) numDisplay.textContent = `${segundos}s`;

    // F-15: Anuncio accesible para lectores de pantalla en 15 y 5 segundos
    if (anuncioLive && (segundos === 15 || segundos === 5)) {
        anuncioLive.textContent = `Quedan ${segundos} segundos para servirte.`;
    }

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
        mostrarAviso(mensajeNotificacion, 'info');
    }
}

/**
 * DÍA 4 & 5: Ejecución del Despacho Transaccional e Idempotente con Emisión de PDF
 */
async function ejecutarDespacho() {
    if (!terminalState.sesionActiva) {
        mostrarAviso('No hay una sesión NFC activa para autorizar el servido.', 'error');
        return;
    }

    const { formatoSeleccionado, canillaSeleccionada, sesionActiva } = terminalState;

    if (!formatoSeleccionado) {
        mostrarAviso('Por favor seleccione un formato de servicio.', 'info');
        return;
    }

    const precioMonto = Number(formatoSeleccionado.precio);

    // Validar saldo suficiente
    if (sesionActiva.saldo_disponible < precioMonto) {
        mostrarAviso(`No tenés saldo suficiente ($${sesionActiva.saldo_disponible.toFixed(2)}) para el formato seleccionado ($${precioMonto.toFixed(2)}).`, 'error');
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
                'Idempotency-Key': idempotencyKey,
                ...AUTH_HEADERS
            },
            body: JSON.stringify({
                id_tarjeta: sesionActiva.id_tarjeta,
                id_canilla: canillaSeleccionada,
                id_formato: formatoSeleccionado.id
            })
        });

        const data = await response.json();

        if (response.ok && data.ok) {
            terminalState.ultimoDespacho = data;
            mostrarModalTicket(data);

            // Refrescar tarjetas de la base de datos para actualizar saldo en pantalla
            const resTarjetas = await fetch(`${API_BASE}/nfc/tarjetas`, {
                headers: { ...AUTH_HEADERS }
            });
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
            const mensajeError = MENSAJES[data.codigo] || data.error || MENSAJES.TRANSACTION_FAILED;
            mostrarAviso(mensajeError, 'error');
            finalizarSesion();
        }
    } catch (err) {
        console.error('Error al ejecutar despacho:', err);
        mostrarAviso('Error de conexión al procesar el servido.', 'error');
        finalizarSesion();
    }
}

/**
 * DÍA 5: Muestra el modal con el ticket de consumo y botón de descarga de PDF
 */
function mostrarModalTicket(despacho) {
    const modal = document.getElementById('ticket-modal');
    if (!modal) return;

    // Obtener importe con fallbacks seguros para evitar NaN
    const rawImporte = despacho.importe_cobrado ?? 
                       despacho.precio_cobrado ?? 
                       despacho.importe_debitado ?? 
                       despacho.importe ?? 
                       terminalState.formatoSeleccionado?.precio ?? 
                       0;
    const importeMonto = Number(rawImporte) || 0;

    const rawSaldo = despacho.saldo_restante ?? 
                     terminalState.sesionActiva?.saldo_disponible ?? 
                     0;
    const saldoMonto = Number(rawSaldo) || 0;

    const canillaObj = terminalState.canillas?.find(c => (c.id_canilla || c.numero) === terminalState.canillaSeleccionada);
    const nombreCerveza = despacho.cerveza || canillaObj?.nombre_cerveza || canillaObj?.estilo || 'Cerveza Ombú';
    const nombreFormato = despacho.formato || terminalState.formatoSeleccionado?.nombre || 'Pinta';
    const mlServidos = despacho.mililitros_servidos || (despacho.volumen_litros ? despacho.volumen_litros * 1000 : null) || terminalState.formatoSeleccionado?.ml || 500;
    const nombreCliente = despacho.cliente || despacho.cliente_nombre || terminalState.sesionActiva?.cliente_nombre || 'Consumidor Final';

    document.getElementById('modal-id-despacho').textContent = `#${despacho.id_despacho || '-'}`;
    document.getElementById('modal-cerveza').textContent = nombreCerveza;
    document.getElementById('modal-formato').textContent = `${nombreFormato} (${mlServidos} ml)`;
    document.getElementById('modal-importe').textContent = `$${importeMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('modal-saldo-restante').textContent = `$${saldoMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('modal-cliente').textContent = nombreCliente;

    // F-14: Apertura accesible mediante modal nativo <dialog>
    if (typeof modal.showModal === 'function') {
        modal.showModal();
    } else {
        modal.style.display = 'flex';
    }
}

// Exponer para la navegación reactiva entre vistas
window.terminalNfc = {
    cargarDatosDesdeServidor
};

// Auto-inicializar al cargar
document.addEventListener('DOMContentLoaded', inicializarTerminalNFC);
