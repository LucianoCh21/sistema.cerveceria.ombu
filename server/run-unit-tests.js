const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const tests = [
    'auth.test.js',
    'barril_cache.test.js',
    'barril_conexion_estado.test.js',
    'comprobante_privacidad.test.js',
    'despacho_idempotencia_atomica.test.js',
    'dia2_nfc_ttl.test.js',
    'dia4_despacho_idempotencia.test.js',
    'dia5_comprobante_pdf.test.js',
    'dia6_integracion_cruzada.test.js',
    'nfc_formatos_sin_barril.test.js',
    'nfc_tap_canilla.test.js',
    'rabbitmq_logs.test.js'
].map(file => join(__dirname, 'tests', file));

// Keep dotenv's default lookup outside the repository.
const cwd = mkdtempSync(join(tmpdir(), 'ombu-unit-'));
try {
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests], {
        cwd,
        stdio: 'inherit'
    });

    if (result.error) throw result.error;
    if (result.signal) console.error('Unit test process terminated by', result.signal);
    process.exitCode = result.status ?? 1;
} finally {
    rmdirSync(cwd);
}
