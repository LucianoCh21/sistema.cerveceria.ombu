#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getConnection, dbConfig, sql } = require('./config/db');

async function initDatabase() {
    console.log('========================================================');
    console.log('🍺 Carga e Inicialización de Base de Datos - OmbuDB');
    console.log('========================================================');

    // 1. Buscar el script SQL corregido más reciente
    const candidatePaths = [
        path.join(__dirname, '../FACULTAD/scripts base de datos/Script_BaseDatos_CerveceriaOmbu_CORREGIDO.sql'),
        path.join(__dirname, 'Script_BaseDatos_CerveceriaOmbu_CORREGIDO.sql'),
        path.join(__dirname, '../scripts base de datos/Script_BaseDatos_CerveceriaOmbu_CORREGIDO.sql')
    ];

    let sqlScriptPath = candidatePaths.find(p => fs.existsSync(p));

    if (!sqlScriptPath) {
        console.error('❌ No se encontró el archivo Script_BaseDatos_CerveceriaOmbu_CORREGIDO.sql');
        console.error('Buscado en:', candidatePaths);
        process.exit(1);
    }

    console.log(`📄 Script detectado: ${sqlScriptPath}`);

    try {
        // Conexión previa a 'master' para crear OmbuDB en instalaciones limpias
        const masterConfig = { ...dbConfig, database: 'master' };
        console.log(`🔌 Conectando a SQL Server (${masterConfig.server}:${masterConfig.port}) para verificar base OmbuDB...`);
        const masterPool = await sql.connect(masterConfig);
        await masterPool.request().query(`
            IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'OmbuDB')
            BEGIN
                CREATE DATABASE [OmbuDB];
            END
        `);
        await masterPool.close();
        console.log('✅ Base de datos OmbuDB asegurada en el servidor.');

        const pool = await getConnection();
        console.log('✅ Conexión establecida con SQL Server (OmbuDB).');

        // 2. Limpieza de tablas y foreign keys existentes
        console.log('🧹 Limpiando restricciones y tablas previas en OmbuDB...');
        await pool.request().query(`
            DECLARE @sql NVARCHAR(MAX) = N'';
            SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
                + '.' + QUOTENAME(OBJECT_NAME(parent_object_id)) 
                + ' DROP CONSTRAINT ' + QUOTENAME(name) + ';'
            FROM sys.foreign_keys;
            EXEC sp_executesql @sql;
        `);

        await pool.request().query(`
            DECLARE @sql NVARCHAR(MAX) = N'';
            SELECT @sql += N'DROP TABLE ' + QUOTENAME(TABLE_SCHEMA) + '.' + QUOTENAME(TABLE_NAME) + ';'
            FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE';
            EXEC sp_executesql @sql;
        `);
        console.log('✅ Esquema previo limpiado.');

        // 3. Ejecución del script por lotes (batches delimitados por GO)
        console.log('🚀 Ejecutando script de estructura y datos históricos...');
        const scriptContent = fs.readFileSync(sqlScriptPath, 'utf8');
        const batches = scriptContent.split(/^GO\s*$/gmi);

        let ok = 0;
        let errors = 0;

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i].trim();
            if (!batch) continue;
            // Omitir directivas de creación de base si ya estamos conectados a OmbuDB
            if (batch.toUpperCase().includes('CREATE DATABASE [OMBUDB]') || batch.trim() === 'USE [OmbuDB]') {
                continue;
            }
            try {
                await pool.request().batch(batch);
                ok++;
            } catch (err) {
                console.error(`⚠️ Error en lote ${i}:`, err.message);
                errors++;
            }
        }

        console.log(`\n🎉 Carga finalizada: ${ok} lotes ejecutados con éxito (${errors} errores).`);

        // 4. Verificación de volumetría
        console.log('\n📊 Estado de tablas en OmbuDB:');
        const tables = [
            'Proveedor', 'EstiloCerveza', 'Cerveza', 'FormatoServicio', 
            'PrecioCerveza', 'Empleado', 'Canilla', 'Barril', 
            'Cliente', 'TarjetaNFC', 'Recarga', 'Despacho'
        ];
        
        for (const t of tables) {
            try {
                const res = await pool.request().query(`SELECT count(*) as total FROM [${t}]`);
                console.log(`   - ${t.padEnd(16)}: ${res.recordset[0].total} registros`);
            } catch (e) {
                console.log(`   - ${t.padEnd(16)}: (No encontrada)`);
            }
        }

        console.log('\n========================================================');
        console.log('✅ Base de datos OmbuDB lista para ser consumida.');
        console.log('========================================================');
        process.exit(0);

    } catch (err) {
        console.error('\n❌ Error fatal al conectar o inicializar:', err.message);
        console.error('Recordá levantar el contenedor con: sudo docker start sqlserver');
        process.exit(1);
    }
}

initDatabase();
