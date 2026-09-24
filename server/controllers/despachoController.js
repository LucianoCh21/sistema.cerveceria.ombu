const { getConnection, sql } = require('../config/db');
const { getNfcSession, deleteNfcSession, setIdempotencyResult, getIdempotencyResult } = require('../config/redis');
const { publishDespachoRealizado } = require('../config/rabbitmq');
const PDFDocument = require('pdfkit');

/**
 * Procesa el débito del cliente, registra el despacho de forma transaccional y emite evento a RabbitMQ.
 * Implementa Idempotencia estricta vía cabecera 'Idempotency-Key' y validación de TTL de 45s.
 */
const crearDespacho = async (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    const { uid_tarjeta, id_canilla, formato, mililitros, importe } = req.body;

    if (!idempotencyKey) {
        return res.status(400).json({
            ok: false,
            error: "La cabecera 'Idempotency-Key' es obligatoria para garantizar la integridad del cobro.",
            codigo: "MISSING_IDEMPOTENCY_KEY"
        });
    }

    if (!uid_tarjeta || id_canilla === undefined || !formato || !mililitros || importe === undefined) {
        return res.status(400).json({
            ok: false,
            error: "Faltan datos obligatorios para registrar el despacho (uid_tarjeta, id_canilla, formato, mililitros, importe).",
            codigo: "MISSING_PARAMETERS"
        });
    }

    try {
        // 1. Verificación de Idempotencia: ¿Ya procesamos esta solicitud previamente?
        const operacionPrevia = await getIdempotencyResult(idempotencyKey);
        if (operacionPrevia) {
            console.log(`[Idempotencia] Solicitud repetida detectada (${idempotencyKey}). Retornando respuesta previa.`);
            return res.status(200).json({
                ...operacionPrevia,
                idempotencia_aplicada: true
            });
        }

        // 2. Validación de Sesión Efímera en Redis (Control de TTL 45 segundos)
        const sesion = await getNfcSession(uid_tarjeta);
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
            // 3. Validar y debitar saldo de la tarjeta de forma atómica
            const requestTarjeta = new sql.Request(transaction);
            const resTarjeta = await requestTarjeta
                .input('uid', sql.VarChar, uid_tarjeta)
                .input('monto', sql.Decimal(10, 2), Number(importe))
                .query(`
                    UPDATE TarjetaNFC 
                    SET saldo = saldo - @monto
                    OUTPUT inserted.id_tarjeta, inserted.saldo, inserted.id_cliente
                    WHERE uid_tarjeta = @uid AND saldo >= @monto AND estado = 'Activa'
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
            const volumenLitros = Number(mililitros) / 1000.0;

            // 4. Insertar registro en la tabla Despacho
            const requestDespacho = new sql.Request(transaction);
            const resDespacho = await requestDespacho
                .input('id_tarjeta', sql.Int, tarjetaActualizada.id_tarjeta)
                .input('id_canilla', sql.Int, Number(id_canilla))
                .input('volumen_litros', sql.Decimal(5, 3), volumenLitros)
                .input('mililitros', sql.Int, Number(mililitros))
                .input('formato', sql.VarChar, formato)
                .input('importe', sql.Decimal(10, 2), Number(importe))
                .query(`
                    INSERT INTO Despacho (id_tarjeta, id_canilla, volumen_litros, mililitros, formato, importe, fecha_hora)
                    OUTPUT inserted.id_despacho, inserted.fecha_hora
                    VALUES (@id_tarjeta, @id_canilla, @volumen_litros, @mililitros, @formato, @importe, GETDATE())
                `);

            const despachoInsertado = resDespacho.recordset[0];

            // 5. Confirmar transacción atómica en SQL Server
            await transaction.commit();

            // 6. Eliminar la sesión efímera de Redis (el grifo se cierra)
            await deleteNfcSession(uid_tarjeta);

            // 7. Construir y emitir evento asíncrono hacia RabbitMQ (Exchange 'ombu.eventos')
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
                    volumenLitros: volumenLitros,
                    mililitros: Number(mililitros),
                    formato: formato,
                    importeDebitado: Number(importe),
                    idTarjeta: tarjetaActualizada.id_tarjeta,
                    idCliente: tarjetaActualizada.id_cliente
                }
            };

            const eventoPublicado = await publishDespachoRealizado(eventoPayload);

            // 8. Construir respuesta exitosa
            const responseData = {
                ok: true,
                id_despacho: despachoInsertado.id_despacho,
                id_canilla: Number(id_canilla),
                formato: formato,
                volumen_litros: volumenLitros,
                importe_debitado: Number(importe),
                saldo_restante: Number(tarjetaActualizada.saldo),
                comprobante_url: `/api/despachos/${despachoInsertado.id_despacho}/comprobante`,
                evento_rabbit_publicado: eventoPublicado,
                fecha_hora: despachoInsertado.fecha_hora
            };

            // 9. Registrar en Redis el resultado de la operación para Idempotencia (TTL: 5 min)
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
 */
const obtenerComprobante = async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id', sql.Int, Number(id))
            .query(`
                SELECT 
                    d.id_despacho,
                    d.volumen_litros,
                    d.mililitros,
                    d.formato,
                    d.importe,
                    d.fecha_hora,
                    d.id_canilla,
                    t.uid_tarjeta,
                    t.saldo,
                    c.nombre,
                    c.apellido,
                    c.dni
                FROM Despacho d
                INNER JOIN TarjetaNFC t ON d.id_tarjeta = t.id_tarjeta
                INNER JOIN Cliente c ON t.id_cliente = c.id_cliente
                WHERE d.id_despacho = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ ok: false, error: "Despacho no encontrado." });
        }

        const d = result.recordset[0];

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
            .text(`Cliente: ${d.nombre} ${d.apellido} (DNI: ${d.dni || 'N/A'})`)
            .text(`Tarjeta NFC: ${d.uid_tarjeta}`);

        doc.moveDown(0.8);
        doc.text('----------------------------------------------------', { align: 'center' });
        doc.moveDown(0.5);

        // Detalle del servido
        doc.fontSize(9).font('Helvetica-Bold').text('DETALLE DEL SERVIDO:');
        doc.fontSize(8).font('Helvetica')
            .text(`Canilla N°: ${d.id_canilla}`)
            .text(`Formato: ${d.formato} (${d.mililitros} ml)`)
            .text(`Volumen: ${d.volumen_litros} L`);

        doc.moveDown(0.8);
        doc.fontSize(10).font('Helvetica-Bold')
            .text(`IMPORTE DEBITADO: $${Number(d.importe).toFixed(2)}`, { align: 'right' });
        doc.fontSize(8).font('Helvetica')
            .text(`Saldo Restante Tarjeta: $${Number(d.saldo).toFixed(2)}`, { align: 'right' });

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
