class DashboardStock {
    constructor() {
        this.inicializarModal();
        this.cargarStock();
    }

    inicializarModal() {
        if (document.getElementById('modal-conexion-barril')) return;
        
        const modalHtml = `
            <div id="modal-conexion-barril">
                <div class="modal-card">
                    <h3 id="modal-titulo-canilla">Conectar Barril</h3>
                    <p style="margin-bottom: 15px; color: #ccc; font-size: 0.9rem;">Ingrese el ID del barril a conectar.</p>
                    <input type="number" id="modal-input-barril" placeholder="Ej: 8" />
                    <p id="modal-mensaje-error"></p>
                    <div class="modal-acciones">
                        <button id="modal-btn-cancelar">Cancelar</button>
                        <button id="modal-btn-conectar">Conectar Barril</button>
                    </div>
                </div>
            </div>
        `;
        
        const styleHtml = `
            <style>
                #modal-conexion-barril {
                    display: none;
                    position: fixed;
                    top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    z-index: 9999;
                    justify-content: center;
                    align-items: center;
                    font-family: sans-serif;
                }
                #modal-conexion-barril .modal-card {
                    background: #1f2937;
                    border-radius: 8px;
                    padding: 20px;
                    width: 300px;
                    color: #fff;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                }
                #modal-conexion-barril h3 {
                    margin-top: 0;
                    margin-bottom: 10px;
                    color: #fff;
                }
                #modal-input-barril {
                    width: 100%;
                    padding: 10px;
                    box-sizing: border-box;
                    border-radius: 4px;
                    border: 1px solid #374151;
                    background: #374151;
                    color: #fff;
                    margin-bottom: 10px;
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
                    padding: 8px 15px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                #modal-btn-conectar {
                    background: #f59e0b;
                    color: #fff;
                    border: none;
                    padding: 8px 15px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                }
            </style>
        `;
        
        document.body.insertAdjacentHTML('beforeend', styleHtml + modalHtml);
        
        const modal = document.getElementById('modal-conexion-barril');
        const btnCancelar = document.getElementById('modal-btn-cancelar');
        const btnConectar = document.getElementById('modal-btn-conectar');
        const inputBarril = document.getElementById('modal-input-barril');
        const msgError = document.getElementById('modal-mensaje-error');
        
        btnCancelar.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        btnConectar.addEventListener('click', async () => {
            const idCanilla = modal.getAttribute('data-canilla');
            const val = inputBarril.value.trim();
            
            if (!val) {
                msgError.textContent = "Por favor, ingrese un ID válido";
                return;
            }
            
            try {
                const response = await fetch('http://localhost:3000/api/barriles/conectar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id_barril: parseInt(val, 10),
                        id_canilla: parseInt(idCanilla, 10),
                        id_empleado_conexion: 1
                    })
                });
                
                if (response.ok) {
                    modal.style.display = 'none';
                    this.cargarStock();
                } else {
                    const errorData = await response.json();
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

        // Estado visual inicial de carga (spinner cervecero)
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
            const response = await fetch('http://localhost:3000/api/stock/resumen');
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Error del servidor (${response.status})`);
            }
            
            const result = await response.json();
            const canillas = Array.isArray(result) ? result : (result.data || []);

            if (!contenedor) return;
            contenedor.innerHTML = '';

            if (contadorStock) {
                contadorStock.textContent = `${canillas.length} Canilla${canillas.length === 1 ? '' : 's'} en seguimiento`;
            }

            // Estado vacío si no hay canillas registradas
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

            // Recorremos y renderizamos
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

                const card = document.createElement('div');
                card.className = 'tarjeta-canilla';
                card.innerHTML = `
                    <div class="tarjeta-header">
                        <span class="canilla-numero">
                            <span class="tap-icon">🚰</span> Canilla #${canilla.numero_canilla || canilla.id_canilla}
                        </span>
                        <span class="badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="tarjeta-body">
                        <h3 class="canilla-estilo">${canilla.nombre_cerveza || 'Sin Barril Conectado'}</h3>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.35rem;">
                            <span style="font-size: 0.85rem; color: var(--text-secondary);">Nivel de Barril:</span>
                            <span style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); font-family: monospace;">
                                ${litrosRestantes.toFixed(1)}L / ${litrosTotales.toFixed(1)}L
                            </span>
                        </div>
                        <div style="width: 100%; background: rgba(255, 255, 255, 0.08); border-radius: 9999px; margin-top: 8px; overflow: hidden; height: 10px; border: 1px solid rgba(255, 255, 255, 0.05);">
                            <div style="width: ${porcentaje}%; background: ${barColor}; height: 100%; border-radius: 9999px; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; text-align: right;">
                            ${porcentaje.toFixed(0)}% disponible
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
                    if (titulo) titulo.textContent = `Conectar a Canilla #${canilla.numero_canilla || canilla.id_canilla}`;
                    if (modal) {
                        modal.setAttribute('data-canilla', canilla.id_canilla);
                        modal.style.display = 'flex';
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
                        <p>No se pudo conectar con el servidor backend o la base de datos (SQL Server / Redis). Verifique que los servicios estén iniciados en los puertos correspondientes.</p>
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
