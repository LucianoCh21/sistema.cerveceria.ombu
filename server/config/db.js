const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || 'OmbuDB',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
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