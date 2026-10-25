async page => {
    // Run in the isolated CLI browser against the local preview, never production.
    if (new URL(page.url()).origin !== 'http://127.0.0.1:8765') {
        throw new Error('Open the local preview at http://127.0.0.1:8765 first.');
    }
    const original = await page.evaluate(() => localStorage.getItem('kotxeaEstado'));
    await page.clock.setFixedTime(new Date('2026-10-25T12:00:00Z'));
    const readTrips = () => page.evaluate(() => JSON.parse(localStorage.getItem('kotxeaEstado')).trips);
    try {
        await page.evaluate(() => localStorage.removeItem('kotxeaEstado'));
        await page.reload();
        await page.getByRole('button', { name: 'Bidaia', exact: true }).click();
        const date = page.getByLabel('Eguna:');
        const savedDialog = page.getByRole('dialog', { name: 'Bidaia gordeta!' });
        async function confirmSaved(autoClose = false) {
            await savedDialog.waitFor({ state: 'visible' });
            if (!autoClose) await savedDialog.getByRole('button', { name: 'Ados' }).click();
            await savedDialog.waitFor({ state: 'hidden', timeout: 3500 });
        }
        await page.getByRole('checkbox', { name: 'Leire', exact: true }).check();
        await page.getByRole('checkbox', { name: 'Naroa', exact: true }).check();
        await page.getByLabel('Nor da gidaria?').selectOption('leire');
        for (const name of ['Nerea', 'Leire', 'Naroa']) {
            if (!await page.getByRole('checkbox', { name, exact: true }).isChecked()) {
                throw new Error('Changing the driver lost a participant: ' + name);
            }
        }
        if (!await page.getByRole('checkbox', { name: 'Leire', exact: true }).isDisabled()) {
            throw new Error('The new driver must remain a participant.');
        }
        const suggestion = await page.locator('#driverSuggestion').textContent();
        if (!['Nerea', 'Leire', 'Naroa'].every(name => suggestion.includes(name))) {
            throw new Error('The initial tied suggestion is missing participants.');
        }
        await page.getByLabel('Nor da gidaria?').selectOption('nerea');
        await page.getByRole('checkbox', { name: 'Leire', exact: true }).uncheck();
        await page.getByRole('checkbox', { name: 'Naroa', exact: true }).uncheck();
        for (const [index, value] of ['2026-10-28', '2026-10-29', '2026-10-25', '2026-01-01'].entries()) {
            await date.fill(value);
            if (!await date.evaluate(input => input.checkValidity())) {
                throw new Error('The calendar blocks ' + value);
            }
            await page.getByRole('checkbox', { name: 'Leire', exact: true }).check();
            await page.getByRole('button', { name: 'Bidai berria gehitu', exact: true }).click();
            await confirmSaved(index === 0);
            const trips = await readTrips();
            if (trips.length !== index + 1 || trips[index].date !== value) {
                throw new Error('Consecutive trip was not saved: ' + value);
            }
            if (await page.locator('#editTripId').inputValue() !== '') {
                throw new Error('The form remained in edit mode after saving.');
            }
        }
        await date.fill('');
        await page.getByRole('button', { name: 'Bidai berria gehitu', exact: true }).click();
        if ((await readTrips()).length !== 4) throw new Error('Empty date was accepted.');
        if (await savedDialog.isVisible()) throw new Error('Invalid trip showed a success dialog.');

        await page.getByRole('button', { name: 'Historiala', exact: true }).click();
        if (await page.locator('#historialaBody tr').count() !== 3) {
            throw new Error('The default history must show recent and future trips.');
        }
        await page.getByRole('row').filter({ hasText: '28/10/2026' }).getByRole('button', { name: 'Editatu' }).click();
        await date.fill('2026-11-02');
        await page.getByRole('button', { name: 'Aldaketak gorde', exact: true }).click();
        await confirmSaved();
        if ((await readTrips())[0].date !== '2026-11-02') throw new Error('Editing to a later date failed.');
        await date.fill('2026-11-03');
        await page.getByRole('button', { name: 'Bidai berria gehitu', exact: true }).click();
        await confirmSaved();
        if ((await readTrips()).length !== 5) throw new Error('Adding after editing failed.');

        await page.reload();
        await page.getByRole('button', { name: 'Historiala', exact: true }).click();
        if (await page.locator('#historialaBody tr').count() !== 4) throw new Error('Trips were lost after reload.');
        await page.getByLabel('Erakutsi:').selectOption('guztia');
        if (await page.locator('#historialaBody tr').count() !== 5) throw new Error('Full history lost old trips.');
    } finally {
        await page.evaluate(saved => {
            if (saved === null) localStorage.removeItem('kotxeaEstado');
            else localStorage.setItem('kotxeaEstado', saved);
        }, original);
        await page.reload();
    }
}
