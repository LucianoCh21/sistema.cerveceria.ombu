const fs = require('fs');
const path = require('path');

// Carga automática de todas las suites de prueba en tests/
const testFiles = fs.readdirSync(__dirname)
    .filter(file => file.endsWith('.test.js') && file !== 'index.js')
    .sort();

for (const file of testFiles) {
    require(path.join(__dirname, file));
}
