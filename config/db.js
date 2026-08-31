const sql = require('mssql');

const dbConfig = {
    user: 'sa',
    password: 'TuPassword123!',
    server: 'localhost',
    database: 'OmbuDB',
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