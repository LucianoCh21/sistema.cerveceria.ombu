const { getConnection, sql } = require('../config/db');
const { getNfcSession, deleteNfcSession, setIdempotencyResult, getIdempotencyResult } = require('../config/redis');
const { publishDespachoRealizado } = require('../config/rabbitmq');
const PDFDocument = require('pdfkit');

/**
 * Procesa el débito del cliente, descuenta stock del barril conectado,
 * registra el despacho de forma transaccional y emite evento a RabbitMQ.
 * Implementa Idempotencia estricta vía cabecera 'Idempotency-Key' y validación de TTL de 45s.
 * Adaptado a OmbuDB (FK Barril, FK FormatoServicio, mililitros_servidos, precio_cobrado, estado).
 */
const crearDespacho = async (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    // Acepta id_tarjeta o uid_tarjeta por compatibilidad
    const idTarjeta = req.body.id_tarjeta || req.body.uid_tarjeta;
    const { id_canilla, importe } = req.body;

    if (!idempotencyKey) {
        return res.status(400).json({
            ok: false,
            error: "La cabecera 'Idempotency-Key' es obligatoria para garantizar la integridad del cobro.",
            codigo: "MISSING_IDEMPOTENCY_KEY"
        });
    }

    if (!idTarjeta || id_canilla === undefined || importe === undefined) {
        return res.status(400).json({
            ok: false,
            error: "Faltan datos obligatorios para registrar el despacho (id_tarjeta/uid_tarjeta, id_canilla, importe).",
            codigo: "MISSING_PARAMETERS"
        });
    }

    // Resolver formato y volumen en mililitros
    let idFormato = req.body.id_formato ? Number(req.body.id_formato) : null;
    let formatoNombre = req.body.formato;
    let mlServidos = req.body.mililitros_servidos || req.body.mililitros;

    if (!idFormato) {
        const fStr = String(formatoNombre || '').toLowerCase();
        if (fStr.includes('media') || Number(mlServidos) === 250) {
            idFormato = 1;
            mlServidos = mlServidos || 250;
            formatoNombre = 'Media Pinta';
        } else if (fStr.includes('litro') || Number(mlServidos) === 1000) {
            idFormato = 3;
            mlServidos = mlServidos || 1000;
            formatoNombre = 'Litro';
        } else {
            idFormato = 2;
            mlServidos = mlServidos || 500;
            formatoNombre = 'Pinta';
        }
    }
    mlServidos = Number(mlServidos) || (idFormato === 1 ? 250 : idFormato === 3 ? 1000 : 500);
    const volumenLitros = Number(mlServidos) / 1000.0;
    const precioCobrado = Number(importe);

    try {
        // 1. Verificación de Idempotencia
        const operacionPrevia = await getIdempotencyResult(idempotencyKey);
        if (operacionPrevia) {
            console.log(`[Idempotencia] Solicitud repetida detectada (${idempotencyKey}). Retornando respuesta previa.`);
            return res.status(200).json({
                ...operacionPrevia,
                idempotencia_aplicada: true
            });
        }

        // 2. Validación de Sesión Efímera en Redis (Control de TTL 45 segundos)
        const sesion = await getNfcSession(idTarjeta);
        if (!sesion) {
            return res.status(403).json({
                ok: false,
                error: "La sesión del grifo ha expirado (TTL de 45 segundos agotado) o la tarjeta no fue aproximada al lector.",
                codigo: "SESSION_EXPIRED"
            });
        }

        const pool = await getConnection();
        const transaction = new sql.Transaction(pool);

        await transaction.begin();

        try {
            // 3. Validar canilla y obtener su barril conectado activo
            const reqBarril = new sql.Request(transaction);
            const resBarril = await reqBarril
                .input('id_canilla', sql.Int, Number(id_canilla))
                .query(`
                    SELECT id_barril, id_cerveza, litros_restantes, estado
                    FROM Barril
                    WHERE id_canilla = @id_canilla AND estado = 'Conectado'
                `);

            if (resBarril.recordset.length === 0) {
                await transaction.rollback();
                return res.status(409).json({
                    ok: false,
                    error: "La canilla seleccionada no cuenta con un barril conectado activamente o se encuentra cerrada.",
                    codigo: "NO_ACTIVE_BARREL"
                });
            }

            const barrilActivo = resBarril.recordset[0];

            if (Number(barrilActivo.litros_restantes) < volumenLitros) {
                await transaction.rollback();
                return res.status(409).json({
                    ok: false,
                    error: "Stock insuficiente en el barril conectado para servir el volumen solicitado.",
                    litros_disponibles: Number(barrilActivo.litros_restantes),
                    codigo: "INSUFFICIENT_STOCK"
                });
            }

            // 4. Validar y debitar saldo de la tarjeta de forma atómica en TarjetaNFC
            const requestTarjeta = new sql.Request(transaction);
            const resTarjeta = await requestTarjeta
                .input('id_tarjeta', sql.VarChar(32), idTarjeta)
                .input('monto', sql.Decimal(10, 2), precioCobrado)
                .query(`
                    UPDATE TarjetaNFC 
                    SET saldo_actual = saldo_actual - @monto
                    OUTPUT inserted.id_tarjeta, inserted.saldo_actual, inserted.id_cliente
                    WHERE id_tarjeta = @id_tarjeta AND saldo_actual >= @monto AND estado = 'Activa'
                `);

            if (resTarjeta.recordset.length === 0) {
                await transaction.rollback();
                return res.status(402).json({
                    ok: false,
                    error: "Saldo insuficiente en la tarjeta o tarjeta inhabilitada al momento de debitar.",
                    codigo: "INSUFFICIENT_FUNDS"
                });
            }

            const tarjetaActualizada = resTarjeta.recordset[0];

            // 5. Descontar litros del barril conectado
            const requestStock = new sql.Request(transaction);
            await requestStock
                .input('id_barril', sql.Int, barrilActivo.id_barril)
                .input('litros', sql.Decimal(6, 2), volumenLitros)
                .query(`
                    UPDATE Barril
                    SET litros_restantes = CASE WHEN (litros_restantes - @litros) < 0 THEN 0.00 ELSE (litros_restantes - @litros) END,
                        estado = CASE WHEN (litros_restantes - @litros) <= 0 THEN 'Agotado' ELSE 'Conectado' END,
                        fecha_desconexion = CASE WHEN (litros_restantes - @litros) <= 0 THEN GETDATE() ELSE NULL END
                    WHERE id_barril = @id_barril
                `);

            // 6. Insertar registro en la tabla Despacho con las columnas de OmbuDB
            const requestDespacho = new sql.Request(transaction);
            const resDespacho = await requestDespacho
                .input('id_tarjeta', sql.VarChar(32), tarjetaActualizada.id_tarjeta)
                .input('id_canilla', sql.Int, Number(id_canilla))
                .input('id_barril', sql.Int, barrilActivo.id_barril)
                .input('id_formato', sql.Int, idFormato)
                .input('mililitros_servidos', sql.SmallInt, mlServidos)
                .input('precio_cobrado', sql.Decimal(10, 2), precioCobrado)
                .query(`
                    INSERT INTO Despacho (
                        id_tarjeta, id_canilla, id_barril, id_formato,
                        mililitros_servidos, precio_cobrado, monto_compensacion,
                        fecha_hora, estado
                    )
                    OUTPUT inserted.id_despacho, inserted.fecha_hora
                    VALUES (
                        @id_tarjeta, @id_canilla, @id_barril, @id_formato,
                        @mililitros_servidos, @precio_cobrado, 0.00,
                        GETDATE(), 'Exitoso'
                    )
                `);

            const despachoInsertado = resDespacho.recordset[0];

            // 7. Confirmar transacción atómica en SQL Server
            await transaction.commit();

            // 8. Eliminar la sesión efímera de Redis (el grifo se cierra)
            await deleteNfcSession(idTarjeta);

            // 9. Construir y emitir evento asíncrono hacia RabbitMQ (Exchange 'ombu.eventos')
            const eventoPayload = {
                eventId: `evt-${Date.now()}-${despachoInsertado.id_despacho}`,
                eventType: "DespachoRealizado",
                occurredAt: despachoInsertado.fecha_hora.toISOString(),
                version: "1.0",
                idempotencyKey: idempotencyKey,
                producer: "modulo-nfc-despachos",
                data: {
                    idDespacho: despachoInsertado.id_despacho,
                    idCanilla: Number(id_canilla),
                    idBarril: barrilActivo.id_barril,
                    idFormato: idFormato,
                    volumenLitros: volumenLitros,
                    mililitros: mlServidos,
                    formato: formatoNombre,
                    importeDebitado: precioCobrado,
                    idTarjeta: tarjetaActualizada.id_tarjeta,
                    idCliente: tarjetaActualizada.id_cliente || null
                }
            };

            const eventoPublicado = await publishDespachoRealizado(eventoPayload);

            // 10. Construir respuesta exitosa
            const responseData = {
                ok: true,
                id_despacho: despachoInsertado.id_despacho,
                id_canilla: Number(id_canilla),
                id_barril: barrilActivo.id_barril,
                id_formato: idFormato,
                formato: formatoNombre,
                volumen_litros: volumenLitros,
                mililitros_servidos: mlServidos,
                importe_debitado: precioCobrado,
                saldo_restante: Number(tarjetaActualizada.saldo_actual),
                comprobante_url: `/api/despachos/${despachoInsertado.id_despacho}/comprobante`,
                evento_rabbit_publicado: eventoPublicado,
                fecha_hora: despachoInsertado.fecha_hora
            };

            // 11. Registrar en Redis el resultado de la operación para Idempotencia (TTL: 5 min)
            await setIdempotencyResult(idempotencyKey, responseData, 300);

            return res.status(201).json(responseData);

        } catch (txError) {
            await transaction.rollback();
            throw txError;
        }

    } catch (error) {
        console.error("[Despacho Controller] Error en crearDespacho:", error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al procesar el despacho y débito.",
            detalles: error.message,
            codigo: "TRANSACTION_FAILED"
        });
    }
};

/**
 * Genera y descarga el comprobante digital en formato PDF para el cliente.
 * Compatible con la estructura normalizada de OmbuDB.
 */
const obtenerComprobante = async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id', sql.BigInt, Number(id))
            .query(`
                SELECT 
                    d.id_despacho,
                    d.mililitros_servidos,
                    d.precio_cobrado,
                    d.monto_compensacion,
                    d.fecha_hora,
                    d.id_canilla,
                    d.id_barril,
                    d.id_formato,
                    f.nombre AS formato_nombre,
                    cz.nombre AS cerveza_nombre,
                    t.id_tarjeta,
                    t.saldo_actual,
                    c.id_cliente,
                    c.nombre AS cliente_nombre,
                    c.apellido AS cliente_apellido
                FROM Despacho d
                INNER JOIN FormatoServicio f ON d.id_formato = f.id_formato
                INNER JOIN Barril b ON d.id_barril = b.id_barril
                INNER JOIN Cerveza cz ON b.id_cerveza = cz.id_cerveza
                INNER JOIN TarjetaNFC t ON d.id_tarjeta = t.id_tarjeta
                LEFT JOIN Cliente c ON t.id_cliente = c.id_cliente
                WHERE d.id_despacho = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ ok: false, error: "Despacho no encontrado." });
        }

        const d = result.recordset[0];
        const volumenLitros = (Number(d.mililitros_servidos) / 1000.0).toFixed(3);
        const clienteTexto = d.cliente_nombre 
            ? `${d.cliente_nombre} ${d.cliente_apellido}` 
            : 'Consumidor Final / Anónimo';

        // Construir PDF con PDFKit
        const doc = new PDFDocument({ margin: 40, size: 'A6' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ticket-ombu-${d.id_despacho}.pdf`);

        doc.pipe(res);

        // Encabezado
        doc.fontSize(14).font('Helvetica-Bold').text('CERVECERÍA OMBÚ', { align: 'center' });
        doc.fontSize(9).font('Helvetica').text('Tap Wall Autoservicio NFC', { align: 'center' });
        doc.moveDown(0.5);
        doc.text('----------------------------------------------------', { align: 'center' });
        doc.moveDown(0.5);

        // Detalle de la transacción
        doc.fontSize(10).font('Helvetica-Bold').text(`COMPROBANTE N°: #${d.id_despacho}`);
        doc.fontSize(8).font('Helvetica')
            .text(`Fecha: ${new Date(d.fecha_hora).toLocaleString('es-AR')}`)
            .text(`Cliente: ${clienteTexto}`)
            .text(`Tarjeta NFC: ${d.id_tarjeta}`);

        doc.moveDown(0.8);
        doc.text('----------------------------------------------------', { align: 'center' });
        doc.moveDown(0.5);

        // Detalle del servido
        doc.fontSize(9).font('Helvetica-Bold').text('DETALLE DEL SERVIDO:');
        doc.fontSize(8).font('Helvetica')
            .text(`Canilla N°: ${d.id_canilla} — Cerveza: ${d.cerveza_nombre}`)
            .text(`Formato: ${d.formato_nombre} (${d.mililitros_servidos} ml)`)
            .text(`Volumen servido: ${volumenLitros} L`);

        doc.moveDown(0.8);
        doc.fontSize(10).font('Helvetica-Bold')
            .text(`IMPORTE COBRADO: $${Number(d.precio_cobrado).toFixed(2)}`, { align: 'right' });
        doc.fontSize(8).font('Helvetica')
            .text(`Saldo Restante Tarjeta: $${Number(d.saldo_actual).toFixed(2)}`, { align: 'right' });

        doc.moveDown(1);
        doc.fontSize(7).font('Helvetica-Oblique')
            .text('¡Gracias por disfrutar en Cervecería Ombú!', { align: 'center' })
            .text('Consumo responsable. Prohibida su venta a menores de 18 años.', { align: 'center' });

        doc.end();

    } catch (error) {
        console.error("[Despacho Controller] Error generando comprobante PDF:", error);
        return res.status(500).json({ ok: false, error: "Error al generar comprobante PDF." });
    }
};

module.exports = {
    crearDespacho,
    obtenerComprobante
};
