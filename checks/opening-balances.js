async page => {
    // Run with playwright-cli run-code --filename checks/opening-balances.js.
    if (new URL(page.url()).origin !== 'http://127.0.0.1:8765') {
        throw new Error('Open the isolated local preview at http://127.0.0.1:8765 first.');
    }
    const original = await page.evaluate(() => localStorage.getItem('kotxeaEstado'));
    const read = () => page.evaluate(() => localStorage.getItem('kotxeaEstado'));
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const group = () => page.getByRole('button', { name: 'Taldea', exact: true }).click();
    const save = () => page.getByRole('button', { name: 'Hasierako saldoak gorde', exact: true }).click();
    const confirmReset = async (id, accept) => {
        const handled = new Promise(resolve => page.once('dialog', async dialog => {
            assert(dialog.type() === 'confirm', 'Reset must ask for confirmation.');
            if (accept) await dialog.accept(); else await dialog.dismiss();
            resolve();
        }));
        await page.locator(id).click(); await handled;
    };
    try {
        await page.evaluate(() => localStorage.removeItem('kotxeaEstado'));
        await page.reload(); await group();
        await page.getByText('Hasierako saldoak konfiguratu', { exact: true }).click();
        for (const [name, value] of Object.entries({ Nerea: '+2,50', Leire: '-1,25', Naroa: '-0.75', Gorka: '-0,50' })) {
            await page.getByRole('textbox', { name, exact: true }).fill(value);
        }
        await save();
        const saved = await read();
        assert(JSON.parse(saved).trips.length === 0, 'Initial balances invented trips.');
        await page.getByRole('textbox', { name: 'Nerea', exact: true }).fill('1,2,3'); await save();
        assert(await read() === saved, 'Invalid decimal changed stored data.');
        await page.reload(); await group();
        await page.getByText('Hasierako saldoak konfiguratu', { exact: true }).click();
        assert(await page.getByRole('textbox', { name: 'Nerea', exact: true }).inputValue() === '2,5', 'Opening balance lost on reload.');
        await page.getByRole('button', { name: 'Bidaia', exact: true }).click();
        await page.getByRole('checkbox', { name: 'Leire', exact: true }).check();
        assert((await page.locator('#driverSuggestion').textContent()).includes('Leire (-1,25)'), 'Suggestion ignores initial balance.');
        await page.getByRole('button', { name: 'Bidai berria gehitu', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Ados' }).click();
        await page.getByRole('button', { name: 'Laburpena', exact: true }).click();
        assert(await page.locator('#emaitza-nerea').textContent() === '+3', 'Trip did not add to opening balance.');
        await group();
        await page.getByRole('textbox', { name: 'Nerea', exact: true }).fill('3,5'); await save();
        assert(JSON.parse(await read()).trips.length === 1, 'Editing initial balance deleted trips.');
        await page.getByRole('button', { name: 'Laburpena', exact: true }).click();
        assert(await page.locator('#emaitza-nerea').textContent() === '+4', 'Editing baseline overwrote current balance.');
        await group();
        await page.getByText('Bidaiak eta balantzeak berrezarri', { exact: true }).click();
        const beforeReset = await read();
        await confirmReset('#resetToOpeningBtn', false);
        assert(await read() === beforeReset, 'Canceling initial reset changed data.');
        await confirmReset('#resetToOpeningBtn', true);
        const initial = JSON.parse(await read());
        assert(initial.trips.length === 0 && initial.opening.nerea.balance === 3.5, 'Reset lost opening balance.');
        await page.getByRole('button', { name: 'Laburpena', exact: true }).click();
        assert(await page.locator('#emaitza-nerea').textContent() === '+3,5', 'Initial reset shows incorrect result.');
        await group();
        const beforeZero = await read();
        await confirmReset('#resetBtn', false);
        assert(await read() === beforeZero, 'Canceling zero reset changed data.');
        await confirmReset('#resetBtn', true);
        const zero = JSON.parse(await read());
        assert(JSON.stringify(zero.people) === JSON.stringify(initial.people), 'Reset removed people.');
        await page.reload();
        for (const balance of await page.locator('.balance-value').allTextContents()) assert(balance === '0', 'Zero reset left a balance.');
        await page.setViewportSize({ width: 390, height: 844 }); await group();
        await page.getByText('Hasierako saldoak konfiguratu', { exact: true }).click();
        assert(await page.getByRole('textbox', { name: 'Nerea', exact: true }).isVisible(), 'Mobile initial form is inaccessible.');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout overflows.');
        return 'PASS: initial balances, validation, reload, suggestions, trips, corrections, both resets and cancellations, mobile layout.';
    } finally {
        await page.evaluate(saved => {
            if (saved === null) localStorage.removeItem('kotxeaEstado');
            else localStorage.setItem('kotxeaEstado', saved);
        }, original);
        await page.reload();
    }
}
