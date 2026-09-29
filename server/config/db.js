const sql = require('mssql');
require('dotenv').config(); // Eliminamos la lectura del archivo fantasma

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: 'master', // CAMBIO CRUCIAL: Entramos a master para poder crear OmbuDB
    port: parseInt(process.env.DB_PORT, 10) || 1434,
    options: { encrypt: true, trustServerCertificate: true }
};

const getConnection = async () => {
    try {
        return await sql.connect(dbConfig);
    } catch (error) {
        console.error("Error conectando a SQL Server:", error);
        throw error;
    }
};

module.exports = { sql, getConnection };