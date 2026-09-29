#!/usr/bin/env node
const readline = require('readline');
const { getConnection, sql } = require('./config/db');

async function executeQuery(queryText) {
    if (!queryText.trim()) return;
    try {
        const pool = await getConnection();
        const start = Date.now();
        const result = await pool.request().query(queryText);
        const duration = Date.now() - start;

        if (result.recordset && result.recordset.length > 0) {
            console.log(`\n📋 Resultado (${result.recordset.length} fila${result.recordset.length > 1 ? 's' : ''}, ${duration}ms):`);
            console.table(result.recordset);
        } else if (result.rowsAffected && result.rowsAffected.length > 0) {
            console.log(`\n✅ Operación ejecutada con éxito. Filas afectadas: ${result.rowsAffected[0]} (${duration}ms)`);
        } else {
            console.log(`\n⚠️ La consulta no retornó registros (${duration}ms).`);
        }
    } catch (error) {
        console.error(`\n❌ Error SQL: ${error.message}`);
    }
}

async function main() {
    const argQuery = process.argv.slice(2).join(' ');

    if (argQuery) {
        // Ejecución directa de una consulta por parámetro
        await executeQuery(argQuery);
        process.exit(0);
    }

    // Modo interactivo (consola interactiva para practicar SELECTs)
    console.log(`========================================================`);
    console.log(`🍺 Consola Interactiva SQL - Cervecería Ombú (OmbuDB)`);
    console.log(`Escribí tu consulta SQL (ej: SELECT * FROM Canilla)`);
    console.log(`Para salir escribí 'exit' o presioná Ctrl+C`);
    console.log(`========================================================\n`);

    try {
        await getConnection();
        console.log(`✅ Conexión establecida con SQL Server (localhost:1433 / OmbuDB)\n`);
    } catch (err) {
        console.error(`❌ No se pudo conectar a SQL Server.`);
        console.error(`Asegurate de haber levantado el contenedor: sudo docker start sqlserver\n`);
        process.exit(1);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'OmbuDB> '
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
            rl.close();
            return;
        }

        if (trimmed) {
            await executeQuery(trimmed);
        }
        console.log('');
        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\n👋 ¡Hasta luego!');
        process.exit(0);
    });
}

main();
