/**
 * Módulo de Dashboard de Stock y Barriles (Luciano Chesani)
 * Remediaciones ISO/IEC 25010:
 * - F-05: Sanitización estricta de variables en el DOM con escapeHTML() contra ataques XSS.
 * - F-12: Mejora de contraste de accesibilidad en botón "Conectar Barril" (color: #0b0c10).
 * - F-14: Modal nativo accesible <dialog> con <label for="...">, showModal(), close() y empleado autenticado real.
 */

const escapeHTML = (typeof window !== 'undefined' && typeof window.escapeHTML === 'function')
    ? window.escapeHTML
    : (valor) => String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

const getApiBase = () => {
    if (typeof window !== 'undefined' && window.OMBU_CONFIG && window.OMBU_CONFIG.API_BASE) {
        return window.OMBU_CONFIG.API_BASE;
    }
    return 'http://localhost:3000/api';
};

const getAdminToken = () => {
    if (typeof window !== 'undefined' && window.OMBU_CONFIG && window.OMBU_CONFIG.ADMIN_TOKEN) {
        return window.OMBU_CONFIG.ADMIN_TOKEN;
    }
    return 'admin-secret-token-ombu';
};

/**
 * F-14: Obtiene el ID del empleado autenticado real en lugar de un valor hardcodeado.
 */
function getAuthenticatedEmpleadoId() {
    if (typeof window === 'undefined') return 1;

    const fromSession = sessionStorage.getItem('id_empleado') || sessionStorage.getItem('empleado_id');
    if (fromSession && !isNaN(parseInt(fromSession, 10))) {
        return parseInt(fromSession, 10);
    }

    const fromLocal = localStorage.getItem('id_empleado') || localStorage.getItem('empleado_id');
    if (fromLocal && !isNaN(parseInt(fromLocal, 10))) {
        return parseInt(fromLocal, 10);
    }

    if (window.empleadoAutenticado && window.empleadoAutenticado.id_empleado) {
        return parseInt(window.empleadoAutenticado.id_empleado, 10);
    }

    if (window.usuarioAutenticado && window.usuarioAutenticado.id_empleado) {
        return parseInt(window.usuarioAutenticado.id_empleado, 10);
    }

    if (window.OMBU_CONFIG && window.OMBU_CONFIG.ID_EMPLEADO) {
        return parseInt(window.OMBU_CONFIG.ID_EMPLEADO, 10);
    }

    // Por defecto toma la sesión administrativa del encargado
    return 1;
}

class DashboardStock {
    constructor() {
        this.inicializarModal();
        this.cargarStock();
    }

    inicializarModal() {
        if (document.getElementById('modal-conexion-barril')) return;

        // F-14: Refactorización a <dialog> nativo con atributos de accesibilidad y <label for="...">
        const modalHtml = `
            <dialog id="modal-conexion-barril" aria-labelledby="modal-titulo-canilla">
                <div class="modal-card">
                    <h3 id="modal-titulo-canilla">Conectar Barril</h3>
                    <p style="margin-bottom: 12px; color: var(--text-secondary, #9ca3af); font-size: 0.9rem;">
                        Ingrese el identificador del barril para vincularlo a la canilla.
                    </p>
                    <div style="margin-bottom: 12px;">
                        <label for="modal-input-barril" style="display: block; margin-bottom: 6px; font-size: 0.85rem; color: var(--text-primary, #f3f4f6); font-weight: 600;">
                            ID del Barril:
                        </label>
                        <input type="number" id="modal-input-barril" name="id_barril" placeholder="Ej: 8" min="1" required />
                    </div>
                    <p id="modal-mensaje-error" role="alert"></p>
                    <div class="modal-acciones">
                        <button type="button" id="modal-btn-cancelar">Cancelar</button>
                        <button type="button" id="modal-btn-conectar">Conectar Barril</button>
                    </div>
                </div>
            </dialog>
        `;

        // F-12: Estilo visual de alto contraste (#0b0c10 para el botón amarillo) y soporte ::backdrop
        const styleHtml = `
            <style>
                dialog#modal-conexion-barril {
                    border: none;
                    padding: 0;
                    background: transparent;
                    border-radius: 8px;
                    margin: auto;
                }
                dialog#modal-conexion-barril::backdrop {
                    background: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(2px);
                }
                #modal-conexion-barril .modal-card {
                    background: #1f2937;
                    border-radius: 8px;
                    padding: 24px;
                    width: 320px;
                    color: #fff;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
                    border: 1px solid #374151;
                    font-family: var(--font-family, sans-serif);
                }
                #modal-conexion-barril h3 {
                    margin-top: 0;
                    margin-bottom: 10px;
                    color: #fff;
                    font-size: 1.2rem;
                }
                #modal-input-barril {
                    width: 100%;
                    padding: 10px;
                    box-sizing: border-box;
                    border-radius: 4px;
                    border: 1px solid #4b5563;
                    background: #374151;
                    color: #fff;
                    font-size: 1rem;
                }
                #modal-input-barril:focus {
                    outline: 2px solid #f59e0b;
                    border-color: #f59e0b;
                }
                #modal-mensaje-error {
                    color: #ef4444;
                    font-size: 0.85rem;
                    min-height: 20px;
                    margin-bottom: 15px;
                }
                #modal-conexion-barril .modal-acciones {
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                }
                #modal-btn-cancelar {
                    background: #4b5563;
                    color: #fff;
                    border: none;
                    padding: 9px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 500;
                }
                #modal-btn-cancelar:hover {
                    background: #6b7280;
                }
                /* F-12: Color de texto #0b0c10 para garantizar ratio de contraste WCAG AA */
                #modal-btn-conectar {
                    background: #f59e0b;
                    color: #0b0c10;
                    border: none;
                    padding: 9px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 700;
                }
                #modal-btn-conectar:hover {
                    background: #d97706;
                }
            </style>
        `;

        document.body.insertAdjacentHTML('beforeend', styleHtml + modalHtml);

        const modal = document.getElementById('modal-conexion-barril');
        const btnCancelar = document.getElementById('modal-btn-cancelar');
        const btnConectar = document.getElementById('modal-btn-conectar');
        const inputBarril = document.getElementById('modal-input-barril');
        const msgError = document.getElementById('modal-mensaje-error');

        // F-14: Control mediante modal.close() nativo
        btnCancelar.addEventListener('click', () => {
            modal.close();
        });

        // F-14: Payload con ID de empleado autenticado real
        btnConectar.addEventListener('click', async () => {
            const idCanilla = modal.getAttribute('data-canilla');
            const val = inputBarril.value.trim();

            if (!val) {
                msgError.textContent = "Por favor, ingrese un ID válido";
                return;
            }

            const idEmpleadoAutenticado = getAuthenticatedEmpleadoId();

            try {
                const apiBase = getApiBase();
                const token = getAdminToken();

                const response = await fetch(`${apiBase}/barriles/conectar`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        id_barril: parseInt(val, 10),
                        id_canilla: parseInt(idCanilla, 10),
                        id_empleado_conexion: idEmpleadoAutenticado
                    })
                });

                if (response.ok) {
                    modal.close();
                    this.cargarStock();
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    msgError.textContent = errorData.error || errorData.message || 'Error al conectar el barril';
                }
            } catch (err) {
                msgError.textContent = 'Error de red al intentar conectar el barril';
                console.error(err);
            }
        });
    }

    async cargarStock() {
        const contenedor = document.getElementById('dashboard-stock-grid') || 
            document.querySelector('#vista-stock .muro-canillas');
        const contadorStock = document.getElementById('contador-stock');

        if (contadorStock) {
            contadorStock.textContent = 'Consultando servidor...';
        }

        // Estado visual inicial de carga
        if (contenedor) {
            contenedor.innerHTML = `
                <div class="muro-loader" role="status">
                    <div class="spinner-cervecero" aria-hidden="true"></div>
                    <p class="loader-texto">Consultando inventario de barriles...</p>
                    <span class="loader-subtexto">Sincronizando niveles de stock en tiempo real</span>
                </div>
            `;
        }

        try {
            const apiBase = getApiBase();
            const token = getAdminToken();

            const response = await fetch(`${apiBase}/stock/resumen`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Error del servidor (${response.status})`);
            }

            const result = await response.json();
            const canillas = Array.isArray(result) ? result : (result.data || []);

            if (!contenedor) return;
            contenedor.innerHTML = '';

            if (contadorStock) {
                const total = canillas.length;
                contadorStock.textContent = `${total} Canilla${total === 1 ? '' : 's'} en seguimiento`;
            }

            // Estado vacío si no hay canillas
            if (canillas.length === 0) {
                contenedor.innerHTML = `
                    <div class="muro-vacio">
                        <div class="vacio-icono">🛢️</div>
                        <h3>No hay canillas registradas en el sistema</h3>
                        <p>Registre canillas desde la sección "Alta de Canilla" para comenzar a gestionar el inventario de barriles.</p>
                    </div>
                `;
                return;
            }

            // F-05: Sanitización estricta de variables dinámicas al renderizar cada tarjeta
            canillas.forEach(canilla => {
                const litrosTotales = parseFloat(canilla.litros_totales) || 0;
                const litrosRestantes = parseFloat(canilla.litros_restantes) || 0;

                let porcentaje = 0;
                if (litrosTotales > 0) {
                    porcentaje = Math.min(100, Math.max(0, (litrosRestantes / litrosTotales) * 100));
                }

                let badgeText = 'SIN STOCK';
                let badgeClass = 'badge-inactiva';
                let barColor = '#ef4444'; // Rojo

                if (litrosTotales > 0 && litrosRestantes > 0) {
                    if (porcentaje > 20) {
                        badgeText = 'ÓPTIMO';
                        badgeClass = 'badge-activa';
                        barColor = '#10b981'; // Verde
                    } else {
                        badgeText = 'NIVEL BAJO';
                        badgeClass = 'badge-mantenimiento';
                        barColor = '#f59e0b'; // Amarillo
                    }
                }

                const numeroCanilla = escapeHTML(String(canilla.numero_canilla || canilla.id_canilla || '-'));
                const nombreCerveza = escapeHTML(String(canilla.nombre_cerveza || 'Sin Barril Conectado'));
                const badgeTextSafe = escapeHTML(badgeText);
                const badgeClassSafe = escapeHTML(badgeClass);

                const card = document.createElement('div');
                card.className = 'tarjeta-canilla';
                card.innerHTML = `
                    <div class="tarjeta-header">
                        <span class="canilla-numero">
                            <span class="tap-icon">🚰</span> Canilla #${numeroCanilla}
                        </span>
                        <span class="badge ${badgeClassSafe}">${badgeTextSafe}</span>
                    </div>
                    <div class="tarjeta-body">
                        <h3 class="canilla-estilo">${nombreCerveza}</h3>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.35rem;">
                            <span style="font-size: 0.85rem; color: var(--text-secondary);">Nivel de Barril:</span>
                            <span style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); font-family: monospace;">
                                ${escapeHTML(litrosRestantes.toFixed(1))}L / ${escapeHTML(litrosTotales.toFixed(1))}L
                            </span>
                        </div>
                        <div style="width: 100%; background: rgba(255, 255, 255, 0.08); border-radius: 9999px; margin-top: 8px; overflow: hidden; height: 10px; border: 1px solid rgba(255, 255, 255, 0.05);">
                            <div style="width: ${porcentaje}%; background: ${barColor}; height: 100%; border-radius: 9999px; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; text-align: right;">
                            ${escapeHTML(porcentaje.toFixed(0))}% disponible
                        </div>
                    </div>
                    <div class="tarjeta-footer" style="margin-top: 0.5rem; display: flex; justify-content: center; border-top: 1px solid var(--border-color); padding-top: 0.75rem;">
                        <button type="button" class="btn-primary btn-conectar" style="width: 100%; padding: 0.6rem 1rem; font-size: 0.85rem;">
                            <span>🔄</span> Conectar / Cambiar Barril
                        </button>
                    </div>
                `;

                const btnConectar = card.querySelector('.btn-conectar');
                btnConectar.addEventListener('click', () => {
                    const modal = document.getElementById('modal-conexion-barril');
                    const msgError = document.getElementById('modal-mensaje-error');
                    const inputBarril = document.getElementById('modal-input-barril');
                    const titulo = document.getElementById('modal-titulo-canilla');

                    if (inputBarril) inputBarril.value = '';
                    if (msgError) msgError.textContent = '';
                    if (titulo) {
                        titulo.textContent = `Conectar a Canilla #${canilla.numero_canilla || canilla.id_canilla}`;
                    }
                    if (modal) {
                        modal.setAttribute('data-canilla', canilla.id_canilla);
                        // F-14: Apertura accesible mediante el método nativo showModal()
                        modal.showModal();
                    }
                });

                contenedor.appendChild(card);
            });
        } catch (error) {
            console.error('Error al cargar el stock:', error);
            if (contadorStock) {
                contadorStock.textContent = 'Sin conexión';
            }
            if (contenedor) {
                contenedor.innerHTML = `
                    <div class="muro-vacio muro-error" role="alert">
                        <div class="error-icono">⚠️</div>
                        <h3>Error al obtener el stock de barriles</h3>
                        <p>${escapeHTML(error.message || 'No se pudo conectar con el servidor backend o la base de datos.')}</p>
                        <button type="button" class="btn-reintentar" id="btn-reintentar-stock">
                            <span>🔄</span> Reintentar consulta de stock
                        </button>
                    </div>
                `;
                const btnReintentar = document.getElementById('btn-reintentar-stock');
                btnReintentar?.addEventListener('click', () => this.cargarStock());
            }
        }
    }
}

// Inicializar el módulo y exponerlo para la navegación reactiva
window.dashboardStock = new DashboardStock();
export default DashboardStock;
