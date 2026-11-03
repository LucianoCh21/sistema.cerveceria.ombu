const sql = require('mssql');
const path = require('path');
const os = require('os');

// Cargar .env tanto si se ejecuta desde raíz como desde /server
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || '192.168.96.1',
    database: process.env.DB_DATABASE || 'OmbuDB',
    port: parseInt(process.env.DB_PORT, 10) || 1434,
    options: { encrypt: true, trustServerCertificate: true },
    pool: {
        max: 50,
        min: 5,
        idleTimeoutMillis: 30000
    }
};

let poolPromise = null;

const getConnection = async () => {
    if (poolPromise) {
        try {
            const pool = await poolPromise;
            if (pool.connected) return pool;
        } catch (_) {
            poolPromise = null;
        }
    }

    const tryConnect = async (host) => {
        const config = { ...dbConfig, server: host };
        return await sql.connect(config);
    };

    poolPromise = (async () => {
        try {
            return await tryConnect(dbConfig.server);
        } catch (error) {
            // Si el host configurado falla o colisiona con el localhost de Windows,
            // buscar dinámicamente entre las interfaces de red locales donde Docker expone el puerto
            const ifaces = os.networkInterfaces();
            for (const name of Object.keys(ifaces)) {
                for (const net of ifaces[name]) {
                    if (net.family === 'IPv4' && !net.internal && net.address !== dbConfig.server) {
                        try {
                            return await tryConnect(net.address);
                        } catch (_) {}
                    }
                }
            }
            console.error("Error conectando a SQL Server:", error);
            throw error;
        }
    })();

    return await poolPromise;
};

module.exports = { sql, getConnection, dbConfig };
