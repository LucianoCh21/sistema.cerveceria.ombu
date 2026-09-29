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
        try {
            const response = await fetch('http://localhost:3000/api/stock/resumen');
            if (!response.ok) throw new Error('Error al obtener el resumen de stock');
            
            const result = await response.json();
            const canillas = result.data || [];

            // Seleccionamos el contenedor. Usamos 'dashboard-stock-grid' para no romper 'muro-canillas' original.
            let contenedor = document.getElementById('dashboard-stock-grid');
            if (!contenedor) {
                // Si no existe, lo creamos
                contenedor = document.createElement('div');
                contenedor.id = 'dashboard-stock-grid';
                contenedor.className = 'dashboard-grid muro-canillas';
                document.body.appendChild(contenedor);
            }

            // Limpiamos el contenedor
            contenedor.innerHTML = '';

            // Recorremos y renderizamos
            canillas.forEach(canilla => {
                const litrosTotales = canilla.litros_totales || 0;
                const litrosRestantes = canilla.litros_restantes || 0;
                
                let porcentaje = 0;
                if (litrosTotales > 0) {
                    porcentaje = (litrosRestantes / litrosTotales) * 100;
                }

                let badgeText = 'SIN STOCK';
                let badgeColor = '#e74c3c'; // Rojo
                if (porcentaje > 20) {
                    badgeText = 'ÓPTIMO';
                    badgeColor = '#2ecc71'; // Verde
                } else if (porcentaje <= 20 && porcentaje > 0) {
                    badgeText = 'NIVEL BAJO';
                    badgeColor = '#f1c40f'; // Amarillo
                }

                const card = document.createElement('div');
                card.className = 'tarjeta-canilla';
                card.innerHTML = `
                    <div class="tarjeta-header">
                        <span class="canilla-numero">🚰 Canilla #${canilla.numero_canilla || canilla.id_canilla}</span>
                        <span class="badge" style="background-color: ${badgeColor}; color: white; border: none;">${badgeText}</span>
                    </div>
                    <div class="tarjeta-body">
                        <h3 class="canilla-estilo">${canilla.nombre_cerveza || 'Sin Asignar'}</h3>
                        <p class="canilla-variedad" style="margin-top: 5px; font-weight: bold;">
                            Litros: ${litrosRestantes}L / ${litrosTotales}L
                        </p>
                        <div style="width: 100%; background: #e0e0e0; border-radius: 6px; margin-top: 12px; overflow: hidden; height: 14px;">
                            <div style="width: ${porcentaje}%; background: ${badgeColor}; height: 100%; transition: width 0.5s ease-in-out;"></div>
                        </div>
                    </div>
                    <div class="tarjeta-footer" style="margin-top: 15px; display: flex; justify-content: center; border-top: none;">
                        <button class="btn-primary btn-conectar" style="width: 100%; padding: 8px;">Conectar / Cambiar Barril</button>
                    </div>
                `;

                const btnConectar = card.querySelector('.btn-conectar');
                btnConectar.addEventListener('click', () => {
                    const modal = document.getElementById('modal-conexion-barril');
                    const msgError = document.getElementById('modal-mensaje-error');
                    const inputBarril = document.getElementById('modal-input-barril');
                    const titulo = document.getElementById('modal-titulo-canilla');
                    
                    inputBarril.value = '';
                    msgError.textContent = '';
                    titulo.textContent = `Conectar a Canilla #${canilla.numero_canilla || canilla.id_canilla}`;
                    modal.setAttribute('data-canilla', canilla.id_canilla);
                    modal.style.display = 'flex';
                });

                contenedor.appendChild(card);
            });
        } catch (error) {
            console.error('Error al cargar el stock:', error);
        }
    }
}

// Inicializar el módulo
new DashboardStock();
