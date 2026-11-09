const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const origin = 'http://ombu.test';
const client = path.join(__dirname, '..', 'client');
const files = {
    '/': 'index.html',
    '/src/styles.css': 'src/styles.css',
    '/src/utils/escapeHTML.js': 'src/utils/escapeHTML.js',
    '/src/comprobantePdf.js': 'src/comprobantePdf.js',
    '/src/terminalNfc.js': 'src/terminalNfc.js',
    '/src/pages/dashboardStock.js': 'src/pages/dashboardStock.js'
};

let browser;
before(async () => {
    browser = await chromium.launch({ executablePath: process.env.OMBU_TEST_BROWSER });
});
after(async () => browser?.close());

async function openApp(t, viewport = { width: 1280, height: 900 }) {
    const page = await browser.newPage({ viewport, acceptDownloads: true });
    t.after(() => page.close());
    const taps = [
        { id_canilla: 1, numero: 1, id_barril: 5, estado: 'Activa', nombre_cerveza: 'IPA de prueba' },
        { id_canilla: 2, numero: 2, id_barril: 6, estado: 'Activa', nombre_cerveza: 'Lager de prueba' }
    ];
    const fixture = { page, registrations: [], dispatches: [], pdfs: [], onDispatch: () => confirmed(41) };
    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();

        const endpoint = url.pathname;
        if (endpoint === '/src/config.js') {
            return route.fulfill({
                contentType: 'application/javascript',
                body: 'window.OMBU_CONFIG = { API_BASE: "/api", ADMIN_TOKEN: "fixture-admin", TERMINAL_TOKEN: "fixture-terminal" };'
            });
        }
        if (files[endpoint]) return route.fulfill({ path: path.join(client, files[endpoint]) });

        if (endpoint === '/api/canillas') {
            if (request.method() === 'GET') return route.fulfill({ json: taps });
            const payload = request.postDataJSON();
            fixture.registrations.push({ payload, authorization: request.headers().authorization });
            if (!payload.numero) return route.fulfill({ status: 400, json: { error: 'Falta el número de canilla' } });
            taps.push({ ...payload, id_canilla: payload.numero });
            return route.fulfill({ status: 201, json: { message: 'Canilla creada exitosamente' } });
        }
        if (endpoint === '/api/nfc/tarjetas') {
            if (fixture.failCardRefresh) return route.abort();
            return route.fulfill({ json: { data: [{ uid: 'TEST-01', titular: 'Cliente de prueba', saldo: 5000 }] } });
        }
        if (endpoint === '/api/nfc/formatos') {
            return route.fulfill({ json: { formatos: [{ id: 2, nombre: 'Pinta', ml: 500, precio: 1950 }] } });
        }
        if (endpoint === '/api/nfc/autenticar') {
            return route.fulfill({
                json: { ok: true, id_tarjeta: request.postDataJSON().id_tarjeta, cliente_nombre: 'Cliente de prueba', saldo_disponible: 5000 }
            });
        }
        if (endpoint === '/api/despachos') {
            fixture.dispatches.push({ payload: request.postDataJSON(), key: request.headers()['idempotency-key'] });
            return route.fulfill(await fixture.onDispatch());
        }
        if (/^\/api\/despachos\/\d+\/comprobante$/.test(endpoint)) {
            fixture.pdfs.push(endpoint);
            return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
        }
        if (endpoint === '/api/stock/resumen') return route.fulfill({ json: { data: [] } });
        return route.fulfill({ status: 404 });
    });
    await page.goto(origin);
    return fixture;
}

function confirmed(id, data = {}) {
    return {
        status: 201,
        json: {
            ok: true, id_despacho: id, cliente: 'Ana Prueba', cerveza: 'Lager confirmada',
            formato: 'Media Pinta', mililitros_servidos: 250, importe_cobrado: 1234.56,
            saldo_restante: 0, ...data
        }
    };
}

async function enterNfc(page) {
    await page.locator('#nav-link-nfc').click();
    await page.locator('.preset-card-item').first().waitFor();
}

async function tapCard(page) {
    await page.locator('#btn-tap-nfc').click();
    await page.locator('#btn-servir-cerveza').waitFor();
}

async function assertCleanReceipt(page) {
    assert.equal(await page.locator('#ticket-modal').isVisible(), false);
    assert.deepEqual(await page.locator('.ticket-row span:last-child').allTextContents(), ['', '', '', '', '', '']);
}

test('the grid precedes the form, and only real registration feedback takes up space', async t => {
    const { page, registrations } = await openApp(t);
    const success = page.locator('#alerta-exito');
    const error = page.locator('#alerta-error');
    await page.locator('#muro-canillas .tarjeta-canilla').first().waitFor();
    assert.match(await page.locator('#contador-canillas').textContent(), /2 canillas/);
    assert.ok(await page.locator('#muro-canillas').evaluate(grid => (
        grid.compareDocumentPosition(document.getElementById('form-canilla')) & Node.DOCUMENT_POSITION_FOLLOWING
    )));
    for (const width of [1280, 800, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const grid = await page.locator('#muro-canillas').boundingBox();
        const form = await page.locator('#panel-alta').boundingBox();
        assert.ok(grid.y + grid.height < form.y);
        assert.ok(grid.x + grid.width <= width);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const alert of [success, error]) {
        assert.equal(await alert.boundingBox(), null);
        assert.equal(await alert.textContent(), '');
    }

    await page.locator('#btn-submit').click();
    await error.waitFor();
    assert.equal(await error.textContent(), 'Falta el número de canilla');
    assert.equal(await success.boundingBox(), null);

    await page.locator('#numero').fill('7');
    await page.locator('#estilo').fill('Pale Ale');
    await page.locator('#variedad').fill('Session');
    await page.locator('#btn-submit').click();
    await success.waitFor();
    assert.equal(await success.textContent(), 'Canilla creada exitosamente');
    assert.equal(await error.boundingBox(), null);
    await page.locator('#muro-canillas .tarjeta-canilla').nth(2).waitFor();
    assert.match(await page.locator('#contador-canillas').textContent(), /3 canillas/);
    assert.deepEqual(registrations[1], {
        authorization: 'Bearer fixture-admin',
        payload: { numero: 7, estado: 'Activa', estilo: 'Pale Ale', variedad: 'Session' }
    });
    await enterNfc(page);
    await page.locator('#nav-link-muro').click();
    assert.equal(await success.boundingBox(), null);
    await page.reload();
    assert.equal(await error.boundingBox(), null);
    assert.equal(await success.boundingBox(), null);
});

test('a delayed confirmation renders once, downloads its PDF and allows a second serving', async t => {
    const app = await openApp(t);
    const { page } = app;
    await enterNfc(page);
    await assertCleanReceipt(page);
    await page.locator('.canilla-btn-chip[data-canilla="2"]').click();
    await page.locator('.preset-card-item').first().click();
    await tapCard(page);
    await assertCleanReceipt(page);

    let confirm;
    const pendingReply = new Promise(resolve => { confirm = resolve; });
    app.onDispatch = () => pendingReply;
    const sent = page.waitForRequest(request => request.url().endsWith('/api/despachos'));
    await page.locator('#btn-servir-cerveza').evaluate(button => {
        button.click();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sent;
    await page.locator('#pouring-animation').waitFor();
    await assertCleanReceipt(page);
    assert.equal(app.dispatches.length, 1);
    assert.deepEqual(app.dispatches[0].payload, { id_tarjeta: 'TEST-01', id_canilla: 2, id_formato: 2 });
    assert.ok(app.dispatches[0].key);

    await page.locator('#nav-link-muro').click();
    const response = page.waitForResponse(url => url.url().endsWith('/api/despachos'));
    confirm(confirmed(41));
    await response;
    await page.locator('#pouring-animation').waitFor({ state: 'hidden' });
    await assertCleanReceipt(page);
    await enterNfc(page);
    const modal = page.getByRole('dialog', { name: /Servido Exitoso/ });
    await modal.waitFor();
    assert.deepEqual(await page.locator('.ticket-row span:last-child').allTextContents(), [
        '#41', 'Ana Prueba', 'Lager confirmada', 'Media Pinta (250 ml)', '$1.234,56', '$0,00'
    ]);
    assert.equal(await modal.evaluate(dialog => dialog.matches(':modal')), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-cerrar-modal');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#btn-descargar-pdf').click()
    ]);
    assert.equal(download.suggestedFilename(), 'ticket-cerveceria-ombu-41.pdf');
    assert.deepEqual(app.pdfs, ['/api/despachos/41/comprobante']);

    await page.locator('#btn-cerrar-modal').click();
    await assertCleanReceipt(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-tap-nfc');
    assert.equal(await page.locator('#lbl-titular').textContent(), '');
    assert.equal(await page.locator('.canilla-btn-chip[data-canilla="2"]').evaluate(el => el.classList.contains('selected')), true);

    app.onDispatch = () => {
        app.failCardRefresh = true;
        return confirmed(42, { cliente: 'Bruno Prueba', saldo_restante: 25 });
    };
    await tapCard(page);
    const refreshFailed = page.waitForEvent('requestfailed', request => request.url().endsWith('/api/nfc/tarjetas'));
    await page.locator('#btn-servir-cerveza').click();
    await modal.waitFor();
    await refreshFailed;
    assert.equal(await page.locator('#terminal-aviso').isVisible(), false);
    assert.equal(await page.locator('#modal-id-despacho').textContent(), '#42');
    assert.equal(await page.locator('#modal-cliente').textContent(), 'Bruno Prueba');
    assert.equal(await page.locator('#modal-saldo-restante').textContent(), '$25,00');
    assert.notEqual(app.dispatches[0].key, app.dispatches[1].key);
    await page.keyboard.press('Escape');
    await assertCleanReceipt(page);
    app.failCardRefresh = false;
    await page.reload();
    await enterNfc(page);
    await assertCleanReceipt(page);
});

test('rejected, malformed and replayed dispatches do not present a new success', async t => {
    const app = await openApp(t);
    const { page } = app;
    await enterNfc(page);

    for (const reply of [
        { status: 409, json: { ok: false, codigo: 'INSUFFICIENT_STOCK' } },
        { status: 201, json: { ok: true, id_despacho: 0 } }
    ]) {
        app.onDispatch = () => reply;
        await tapCard(page);
        await page.locator('#btn-servir-cerveza').click();
        await page.locator('#terminal-aviso.alerta-error').waitFor();
        await assertCleanReceipt(page);
        assert.equal(await page.locator('#pouring-animation').isVisible(), false);
    }

    app.onDispatch = () => confirmed(41);
    await tapCard(page);
    await page.locator('#btn-servir-cerveza').click();
    await page.locator('#ticket-modal').waitFor();
    await page.locator('#btn-cerrar-modal').click();

    app.onDispatch = () => ({ status: 200, json: { ...confirmed(41).json, idempotencia_aplicada: true } });
    await tapCard(page);
    await page.locator('#btn-servir-cerveza').click();
    await page.locator('#session-standby').waitFor();
    await assertCleanReceipt(page);
});

test('the opaque modal fits desktop, tablet, mobile and short viewports', async t => {
    const { page } = await openApp(t);
    await enterNfc(page);
    await tapCard(page);
    await page.locator('#btn-servir-cerveza').click();
    const modal = page.locator('#ticket-modal');
    await modal.waitFor();

    for (const [width, height] of [[1280, 900], [800, 700], [320, 650], [640, 260]]) {
        await page.setViewportSize({ width, height });
        const rect = await modal.boundingBox();
        assert.ok(Math.abs(rect.x * 2 + rect.width - width) < 2);
        assert.ok(Math.abs(rect.y * 2 + rect.height - height) < 2);
        assert.ok(rect.width <= width - 31 && rect.height <= height - 31);
        const styles = await modal.evaluate(dialog => ({
            background: getComputedStyle(dialog).backgroundColor,
            backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor,
            abovePage: dialog.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))
        }));
        assert.match(styles.background, /^rgb\(/);
        assert.notEqual(styles.backdrop, 'rgba(0, 0, 0, 0)');
        assert.equal(styles.abovePage, true);
    }

    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-descargar-pdf');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-cerrar-modal');
    await page.keyboard.press('Escape');
    await assertCleanReceipt(page);
});
