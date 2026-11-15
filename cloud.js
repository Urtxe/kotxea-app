(function (root) {
    'use strict';

    const LEGACY_KEY = 'kotxeaEstado';
    const LEGACY_SUMMARY_KEY = 'kotxeaDatos';
    const LEGACY_HISTORY_KEY = 'kotxeaHistoriala';
    const MIGRATION_KEY = 'kotxeaCloudMigration';
    const api = root.KotxeaLogic;
    let auth;
    let db;
    let user = null;
    let platformRole = null;
    let platformCanParticipate = false;
    let activeGroup = null;
    let activeMember = null;
    let revision = 0;
    let groupUnsubscribe = null;
    let tripSyncUnsubscribe = null;
    let pendingTripWrites = false;
    let adminPresenceUnsubscribe = null;
    let adminPresenceRefreshTimer = null;
    let presenceHeartbeat = null;
    let presenceEnabled = false;
    let localState = null;
    let appStateCallback = null;
    let statusCallback = null;
    let saving = false;
    let persistenceEnabled = false;
    let registrationMode = false;
    let deferredInstallPrompt = null;
    let adminUsers = [];

    function el(id) { return document.getElementById(id); }
    function signedIn() { return Boolean(user && user.uid); }
    function isSuperAdmin() { return platformRole === 'superadmin'; }
    function canCreateGroups() { return signedIn() && (!isSuperAdmin() || platformCanParticipate); }
    function canManageGroup() { return isSuperAdmin() || Boolean(activeMember && ['owner', 'admin'].includes(activeMember.role)); }
    function safeError(error) {
        const messages = {
            'auth/email-already-in-use': 'Helbide hori badago. Saioa hasi edo beste posta bat erabili.',
            'auth/invalid-email': 'Posta elektronikoak ez du formatu zuzena.',
            'auth/weak-password': 'Pasahitzak gutxienez 6 karaktere izan behar ditu.',
            'auth/wrong-password': 'Posta edo pasahitza ez dira zuzenak.',
            'auth/invalid-credential': 'Posta edo pasahitza ez dira zuzenak.',
            'auth/user-not-found': 'Ez dago konturik posta horrekin.',
            'auth/popup-closed-by-user': 'Saioa hasteko leihoa itxi duzu.',
            'auth/popup-blocked': 'Arakatzaileak saioa hasteko leihoa blokeatu du.',
            'auth/unauthorized-domain': 'Webgune honen domeinua ez dago Firebase Auth-en baimenduta.',
            'permission-denied': 'Ez duzu ekintza hori egiteko baimenik.',
            'failed-precondition': 'Datuak beste erabiltzaile batek aldatu ditu. Berritu taldea eta saiatu berriro.',
            'unavailable': 'Ezin da Firebase-ra konektatu. Egiaztatu konexioa eta saiatu berriro.'
        };
        return messages[error && error.code] || (error && error.message) || 'Errore bat gertatu da. Saiatu berriro.';
    }
    function dateInputValue(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }
    function formatAdminDate(value) {
        if (!value) return 'Nunca';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    }
    function normalizeSearch(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
    }
    function setGate(panelId) {
        if (panelId !== 'adminPanel') stopAdminPresenceListener();
        ['authPanel', 'groupsPanel', 'adminPanel'].forEach(id => { el(id).hidden = id !== panelId; });
        el('appContent').hidden = panelId !== 'app';
        document.querySelector('.bottom-nav').hidden = panelId !== 'app';
        el('activeGroupSelect').hidden = panelId !== 'app';
        el('accountMenuBtn').hidden = !signedIn();
        el('storageNote').hidden = panelId !== 'app';
        el('startupWarning').hidden = true;
        if (panelId === 'app') el('appContent').hidden = false;
    }
    function showStatus(message) {
        if (typeof statusCallback === 'function') statusCallback(message || '');
    }
    function normalizeEmail(value) { return String(value || '').trim().toLocaleLowerCase('en-US'); }
    function localLegacyState() {
        let storage;
        try { storage = root.localStorage; } catch (_) { return { error: 'Ezin dira gailuko datuak irakurri.' }; }
        if (!storage) return { error: 'Ezin dira gailuko datuak irakurri.' };
        return api.parseStored(storage);
    }
    function hasLocalLegacyData() {
        try { return [LEGACY_KEY, LEGACY_SUMMARY_KEY, LEGACY_HISTORY_KEY].some(key => root.localStorage.getItem(key) !== null); }
        catch (_) { return false; }
    }
    function blankGroupState() { return { version: api.VERSION, people: [], trips: [], opening: Object.create(null) }; }
    function currentPathInvite() {
        try { return new URL(root.location.href).searchParams.get('invite'); } catch (_) { return null; }
    }
    function authActionSettings() { return { url: root.location.href, handleCodeInApp: false }; }
    function groupReference(groupId) { return db.collection('groups').doc(groupId); }
    function safeDocId(id) { return encodeURIComponent(String(id)); }
    function tripAuthorName(trip, state) {
        const linkedPerson = state.people.find(person => person.linkedUid === user.uid);
        return linkedPerson ? linkedPerson.name : null;
    }
    function personDocument(person, opening, old) {
        const document = {
            id: person.id,
            name: person.name,
            active: person.active,
            opening: opening || api.emptyState().opening[person.id] || { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }
        };
        if (person.default) document.default = true;
        if (person.linkedUid) document.linkedUid = person.linkedUid;
        if (old && old.createdBy) document.createdBy = old.createdBy;
        else document.createdBy = user.uid;
        return document;
    }
    function normalizedStateFromSnapshots(peopleSnapshot, tripsSnapshot) {
        const people = [];
        const opening = Object.create(null);
        peopleSnapshot.forEach(doc => {
            const data = doc.data({ serverTimestamps: 'estimate' });
            if (!data || typeof data.id !== 'string') return;
            const person = { id: data.id, name: data.name, active: data.active !== false };
            if (data.default) person.default = true;
            if (data.linkedUid) person.linkedUid = data.linkedUid;
            people.push(person);
            opening[data.id] = data.opening || { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 };
        });
        const trips = [];
        tripsSnapshot.forEach(doc => {
            const data = doc.data({ serverTimestamps: 'estimate' });
            if (!data || typeof data.id !== 'string') return;
            const creator = data.createdBy ? people.find(person => person.linkedUid === data.createdBy) : null;
            const createdAt = data.createdAt && typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().getTime() : null;
            trips.push({ id: data.id, date: data.date, driver: data.driver, passengers: data.passengers, ...(data.createdBy ? { createdBy: data.createdBy } : {}), ...(data.createdByName ? { createdByName: data.createdByName } : creator ? { createdByName: creator.name } : {}), ...(createdAt ? { createdAt } : {}) });
        });
        trips.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        return { version: api.VERSION, people, trips, opening };
    }
    async function writeInitialState(groupId, state) {
        const groupRef = groupReference(groupId);
        const operations = [];
        state.people.forEach(person => {
            operations.push({ ref: groupRef.collection('people').doc(safeDocId(person.id)), data: personDocument(person, state.opening[person.id]) });
        });
        state.trips.forEach(trip => {
            operations.push({ ref: groupRef.collection('trips').doc(safeDocId(trip.id)), data: { id: trip.id, date: trip.date, driver: trip.driver, passengers: trip.passengers, createdBy: user.uid, ...(tripAuthorName(trip, state) ? { createdByName: tripAuthorName(trip, state) } : {}), createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: user.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() } });
        });
        for (let offset = 0; offset < operations.length; offset += 400) {
            const batch = db.batch();
            operations.slice(offset, offset + 400).forEach(item => batch.set(item.ref, item.data));
            await batch.commit();
        }
    }
    async function finishGroupSetup(groupId, groupData) {
        const groupRef = groupReference(groupId);
        const publicData = {
            groupId,
            name: groupData.name,
            discoverable: Boolean(groupData.discoverable),
            status: 'active',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        const batch = db.batch();
        batch.update(groupRef, { status: 'active', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        batch.set(db.collection('directoryGroups').doc(groupId), publicData);
        batch.set(db.collection('users').doc(user.uid).collection('groups').doc(groupId), {
            groupId,
            groupName: groupData.name,
            role: 'owner',
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await batch.commit();
    }
    async function createGroup(event) {
        event.preventDefault();
        if (!signedIn() || !canCreateGroups()) return;
        if (!user.emailVerified) { el('createGroupFeedback').textContent = 'Egiaztatu posta elektronikoa taldea sortu aurretik.'; return; }
        const name = el('newGroupName').value.trim();
        const creatorName = el('newGroupParticipantName').value.trim();
        const invitees = Array.from(document.querySelectorAll('.initial-invite-row')).map(row => ({
            name: row.querySelector('[data-field="name"]').value.trim(),
            email: normalizeEmail(row.querySelector('[data-field="email"]').value)
        })).filter(invitee => invitee.name || invitee.email);
        if (!name || !creatorName) return;
        if (invitees.some(invitee => !invitee.name || !invitee.email)) {
            el('createGroupFeedback').textContent = 'Gonbidapen bakoitzean, sartu bidaiariaren izena eta posta elektronikoa.';
            return;
        }
        const inviteEmails = new Set();
        for (const invitee of invitees) {
            if (inviteEmails.has(invitee.email)) { el('createGroupFeedback').textContent = 'Ez errepikatu posta elektroniko bat gonbidapenetan.'; return; }
            inviteEmails.add(invitee.email);
        }
        const wantsImport = el('importLocalData').checked && !root.localStorage.getItem('kotxeaImportCompleted') && hasLocalLegacyData();
        const imported = wantsImport ? localLegacyState() : { state: blankGroupState() };
        if (imported.error) { el('createGroupFeedback').textContent = imported.error; return; }
        const initialState = imported.state || blankGroupState();
        if (!api.validateState(initialState)) { el('createGroupFeedback').textContent = 'Gailuko bidaia-datuak ezin dira inportatu; deskargatu kopia JSON bat eta berrikusi.'; return; }
        const existingCreator = initialState.people.find(person => person.name.trim().toLocaleLowerCase() === creatorName.toLocaleLowerCase());
        const creatorPerson = existingCreator || { id: db.collection('groups').doc().id, name: creatorName, active: true };
        if (!existingCreator) {
            initialState.people.push(creatorPerson);
            initialState.opening[creatorPerson.id] = { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 };
        }
        creatorPerson.linkedUid = user.uid;
        const invitedPeople = [];
        for (const invitee of invitees) {
            if (initialState.people.some(person => person.name.trim().toLocaleLowerCase() === invitee.name.toLocaleLowerCase())) {
                el('createGroupFeedback').textContent = 'Badago izen hori duen bidaiari bat. Erabili izen desberdin bat.';
                return;
            }
            const person = { id: db.collection('groups').doc().id, name: invitee.name, active: true };
            initialState.people.push(person);
            initialState.opening[person.id] = { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 };
            invitedPeople.push({ ...invitee, person });
        }
        if (!api.validateState(initialState)) { el('createGroupFeedback').textContent = 'Ezin izan da bidaiarien zerrenda balioztatu.'; return; }
        if (wantsImport && !root.confirm('Gailuko historia eta hasierako saldoak talde berrira kopiatuko dira. Jatorrizko datuak gailuan gordeko dira. Jarraitu?')) return;

        const submit = el('createGroupForm').querySelector('button[type="submit"]');
        submit.disabled = true;
        el('createGroupFeedback').textContent = 'Taldea eta datuak prestatzen...';
        const groupId = db.collection('groups').doc().id;
        const groupData = {
            name,
            ownerUid: user.uid,
            createdBy: user.uid,
            discoverable: el('newGroupDiscoverable').checked,
            status: 'initializing',
            revision: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        const migrationKey = MIGRATION_KEY + ':' + groupId;
        try {
            root.localStorage.setItem(migrationKey, JSON.stringify(initialState));
            const batch = db.batch();
            batch.set(groupReference(groupId), groupData);
            batch.set(groupReference(groupId).collection('members').doc(user.uid), {
                uid: user.uid,
                email: normalizeEmail(user.email),
                displayName: user.displayName || user.email || 'Administrador',
                role: 'owner',
                personId: creatorPerson.id,
                joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            batch.set(groupReference(groupId).collection('people').doc(safeDocId(creatorPerson.id)), personDocument(creatorPerson, initialState.opening[creatorPerson.id]));
            batch.set(db.collection('users').doc(user.uid).collection('groups').doc(groupId), {
                groupId, groupName: name, role: 'owner', joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await batch.commit();
            await writeInitialState(groupId, initialState);
            await finishGroupSetup(groupId, groupData);
            root.localStorage.removeItem(migrationKey);
            root.localStorage.setItem('kotxeaImportCompleted', '1');
            const inviteLinks = [];
            let inviteIssue = '';
            for (const invitee of invitedPeople) {
                const inviteRef = db.collection('invitations').doc();
                try {
                    await inviteRef.set({
                        groupId, groupName: name, email: invitee.email, personId: invitee.person.id, personName: invitee.person.name,
                        role: 'member', status: 'pending', createdBy: user.uid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        expiresAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
                    });
                    const inviteUrl = new URL(root.location.href);
                    inviteUrl.search = '';
                    inviteUrl.hash = '';
                    inviteUrl.searchParams.set('invite', inviteRef.id);
                    inviteLinks.push({ email: invitee.email, url: inviteUrl.toString() });
                } catch (error) {
                    console.error('Kotxea initial invitation failed', error);
                    inviteIssue = 'Taldea sortu da, baina gonbidapen bat edo gehiago ezin izan dira sortu. Sortu berriro taldearen administraziotik: ' + safeError(error);
                }
            }
            el('createGroupForm').reset();
            document.querySelectorAll('.initial-invite-row').forEach((row, index) => { if (index > 0) row.remove(); });
            el('createGroupFeedback').textContent = inviteLinks.length ? 'Taldea prest dago. Gonbidapen-estekak agertzen dira taldeko administrazioan.' : 'Taldea prest dago.';
            await openGroup(groupId);
            if (inviteLinks.length) {
                el('inviteFeedback').replaceChildren();
                inviteLinks.forEach(invite => {
                    const row = document.createElement('p'); row.append(document.createTextNode('Gonbidatu ' + invite.email + ': '));
                    addShareableLink(row, invite.url);
                    el('inviteFeedback').append(row);
                });
                el('groupAdminTools').open = true;
            }
            if (inviteIssue) showStatus(inviteIssue);
        } catch (error) {
            console.error('Kotxea group setup failed', error);
            el('createGroupFeedback').textContent = 'Taldea sortzea ez da amaitu: ' + safeError(error) + ' Ez sortu beste talde bat; saiatu inportazioa talde-zerrendatik jarraitzen.';
            showStatus(safeError(error));
        } finally {
            submit.disabled = false;
        }
    }
    function addShareableLink(container, url) {
        const link = document.createElement('a'); link.href = url; link.textContent = 'Gonbidapen-esteka'; link.target = '_blank'; link.rel = 'noopener';
        const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary-button'; copy.textContent = 'Esteka kopiatu';
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); copy.textContent = 'Kopiatuta'; } catch (_) { container.append(document.createTextNode(' ' + url)); } });
        container.append(link, document.createTextNode(' '), copy);
    }
    async function resumeMigration(groupId) {
        const raw = root.localStorage.getItem(MIGRATION_KEY + ':' + groupId);
        if (!raw) { showStatus('Gailu honetan ez dago inportazioa osatzeko kopiarik.'); return; }
        let state;
        try { state = JSON.parse(raw); } catch (_) { showStatus('Inportazioaren kopia hondatuta dago.'); return; }
        if (!api.validateState(state)) { showStatus('Inportazioaren kopia ez da baliozkoa.'); return; }
        try {
            const group = await groupReference(groupId).get();
            if (!group.exists || group.data().status !== 'initializing') { showStatus('Talde hau ez dago inportazioa osatzeko egoeran.'); return; }
            await writeInitialState(groupId, state);
            await finishGroupSetup(groupId, group.data());
            root.localStorage.removeItem(MIGRATION_KEY + ':' + groupId);
            root.localStorage.setItem('kotxeaImportCompleted', '1');
            await openGroup(groupId);
        } catch (error) { showStatus('Ezin izan da inportazioa osatu: ' + safeError(error)); }
    }
    async function loadMyGroups() {
        const snapshot = await db.collection('users').doc(user.uid).collection('groups').get();
        const results = [];
        for (const item of snapshot.docs) {
            const groupSnap = await groupReference(item.id).get();
            if (!groupSnap.exists) continue;
            results.push({ id: item.id, ...groupSnap.data(), membership: item.data() });
        }
        return results;
    }
    function addGroupButton(container, group, options) {
        const li = document.createElement('li');
        li.className = 'group-picker-item';
        const text = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = group.name || 'Taldea';
        const description = document.createElement('span');
        description.textContent = group.status === 'initializing' ? 'Inportazioa osatu gabe' : 'Talde partekatua';
        text.append(title, description);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = options && options.resume ? 'Jarraitu inportazioa' : options && options.requested ? 'Eskaera bidalita' : options && options.join ? 'Sartzeko eskatu' : 'Ireki';
        button.disabled = Boolean(options && options.requested);
        button.addEventListener('click', () => {
            if (options && options.resume) resumeMigration(group.id);
            else if (options && options.join) requestJoin(group);
            else openGroup(group.id);
        });
        li.append(text, button);
        container.append(li);
    }
    async function refreshGroupsGate() {
        if (!signedIn()) return;
        setGate('groupsPanel');
        el('createGroupDetails').hidden = !canCreateGroups();
        el('groupSearchPanel').hidden = !canCreateGroups();
        const pendingImportDocs = new Set();
        for (let i = 0; i < root.localStorage.length; i++) {
            const key = root.localStorage.key(i);
            if (key && key.startsWith(MIGRATION_KEY + ':')) pendingImportDocs.add(key.slice((MIGRATION_KEY + ':').length));
        }
        const myGroupsList = el('myGroupsList');
        myGroupsList.replaceChildren();
        const pendingPanel = el('pendingRequestsPanel');
        const invitesPanel = el('emailInvitesPanel');
        const userGroups = await loadMyGroups();
        const membershipIds = new Set(userGroups.map(group => group.id));
        userGroups.forEach(group => addGroupButton(myGroupsList, group, { resume: group.status === 'initializing' && pendingImportDocs.has(group.id) }));
        el('globalAdminFromGroupsBtn').hidden = !isSuperAdmin();
        if (isSuperAdmin()) {
            el('groupsFeedback').textContent = 'Administratzaile globala zara. Erabili administrazio-panela taldeak eta kontuak ikusteko.';
        } else if (userGroups.length === 0 && !canCreateGroups()) {
            el('groupsFeedback').textContent = 'Oraindik ez dago talderik. Bilatu bat eta eskatu sartzeko.';
        } else {
            el('groupsFeedback').textContent = userGroups.length ? 'Aukeratu zein taldetan lan egin.' : 'Oraindik ez daukazu talderik. Sortu talde bat edo bilatu talde bat.';
        }

        const requestIndex = await db.collection('users').doc(user.uid).collection('requests').get();
        const requestList = el('myRequestsList');
        requestList.replaceChildren();
        pendingPanel.hidden = requestIndex.empty;
        requestIndex.forEach(item => {
            const row = document.createElement('li'); row.className = 'group-picker-item';
            const label = document.createElement('span'); label.textContent = (item.data().groupName || 'Taldea') + ': ' + (item.data().status === 'pending' ? 'onartzeko zain' : item.data().status === 'rejected' ? 'ezetsita' : 'onartuta');
            row.append(label); requestList.append(row);
        });

        const inviteId = currentPathInvite();
        invitesPanel.hidden = !inviteId;
        el('myInvitesList').replaceChildren();
        if (inviteId) await renderInvite(inviteId, membershipIds);
        await refreshDiscoverableGroups();
    }
    async function refreshDiscoverableGroups() {
        const list = el('discoverableGroupsList');
        list.replaceChildren();
        if (!signedIn() || !user.emailVerified) {
            list.textContent = 'Taldeak bilatu aurretik, egiaztatu posta elektronikoa.';
            return;
        }
        try {
            const snapshot = await db.collection('directoryGroups').where('discoverable', '==', true).get();
            const needle = el('groupSearch').value.trim().toLocaleLowerCase('eu-ES');
            const groups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(group => group.status === 'active' && (!needle || group.name.toLocaleLowerCase('eu-ES').includes(needle)));
            const requests = await db.collection('users').doc(user.uid).collection('requests').get();
            const requested = new Set(requests.docs.filter(doc => doc.data().status === 'pending').map(doc => doc.data().groupId));
            const myGroups = await db.collection('users').doc(user.uid).collection('groups').get();
            const memberIds = new Set(myGroups.docs.map(doc => doc.id));
            if (!groups.length) list.textContent = needle ? 'Ez da talderik aurkitu.' : 'Ez dago bilaketa publikoan agertzen den talderik.';
            groups.forEach(group => {
                if (memberIds.has(group.id)) return;
                addGroupButton(list, group, { join: true, requested: requested.has(group.id) });
            });
        } catch (error) { list.textContent = safeError(error); }
    }
    async function requestJoin(group) {
        if (!user.emailVerified || !canCreateGroups()) { showStatus('Egiaztatu zure posta elektronikoa eta zure baimena talde batean sartzeko eskaera bidali aurretik.'); return; }
        const requestId = group.id + '_' + user.uid;
        try {
            const requestRef = db.collection('joinRequests').doc(requestId);
            const old = await requestRef.get();
            if (old.exists && old.data().status === 'pending') { showStatus('Eskaera hau zain dago jada.'); await refreshGroupsGate(); return; }
            const batch = db.batch();
            const request = {
                requestId, groupId: group.id, groupName: group.name, uid: user.uid,
                email: normalizeEmail(user.email), displayName: user.displayName || user.email,
                status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            batch.set(requestRef, request);
            batch.set(db.collection('users').doc(user.uid).collection('requests').doc(requestId), {
                requestId, groupId: group.id, groupName: group.name, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            await batch.commit();
            showStatus('Eskaera bidalita. Administratzaileak onartu arte ez dituzu taldeko datuak ikusiko.');
            await refreshGroupsGate();
        } catch (error) { showStatus('Ezin izan da eskaera bidali: ' + safeError(error)); }
    }
    async function renderInvite(inviteId, membershipIds) {
        const list = el('myInvitesList');
        const item = document.createElement('li'); item.className = 'group-picker-item';
        try {
            if (!user.emailVerified) throw new Error('Egiaztatu posta elektronikoa gonbidapen bat onartu aurretik.');
            const ref = db.collection('invitations').doc(inviteId);
            const snap = await ref.get();
            if (!snap.exists) throw new Error('Gonbidapen hau ez dago erabilgarri edo iraungi da.');
            const invite = snap.data();
            if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) throw new Error('Gonbidapen hau beste posta elektroniko bati zuzenduta dago.');
            if (invite.status !== 'pending' || invite.expiresAt.toDate() < new Date()) throw new Error('Gonbidapen hau jada ez dago erabilgarri.');
            const label = document.createElement('span');
            label.textContent = (invite.groupName || 'Taldea') + ' · ' + (invite.personName || 'administratzailea');
            item.append(label);
            if (membershipIds.has(invite.groupId)) {
                const note = document.createElement('span'); note.textContent = 'Talde honetako kidea zara jada.'; item.append(note);
            } else {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Gonbidapena onartu';
                button.addEventListener('click', () => acceptInvite(inviteId)); item.append(button);
            }
        } catch (error) {
            const label = document.createElement('span'); label.textContent = safeError(error); item.append(label);
        }
        list.append(item);
    }
    async function acceptInvite(inviteId) {
        if (!user || !user.emailVerified || !canCreateGroups()) { showStatus('Egiaztatu zure posta elektronikoa eta zure baimena gonbidapena onartu aurretik.'); return; }
        try {
            await db.runTransaction(async transaction => {
                const inviteRef = db.collection('invitations').doc(inviteId);
                const inviteSnap = await transaction.get(inviteRef);
                if (!inviteSnap.exists) throw new Error('Gonbidapena ez da aurkitu.');
                const invite = inviteSnap.data();
                if (invite.status !== 'pending' || invite.expiresAt.toDate() < new Date()) throw new Error('Gonbidapena iraungi da edo erabili da.');
                if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) throw new Error('Gonbidapena beste posta bati zuzenduta dago.');
                const groupRef = groupReference(invite.groupId);
                const memberRef = groupRef.collection('members').doc(user.uid);
                let personRef = null;
                if (invite.personId) {
                    personRef = groupRef.collection('people').doc(safeDocId(invite.personId));
                }
                transaction.update(inviteRef, { status: 'accepted', acceptedBy: user.uid, acceptedAt: firebase.firestore.FieldValue.serverTimestamp() });
                const role = invite.role === 'admin' ? 'admin' : 'member';
                transaction.set(memberRef, { uid: user.uid, email: normalizeEmail(user.email), displayName: user.displayName || user.email, role, personId: invite.personId || null, inviteId, joinedAt: firebase.firestore.FieldValue.serverTimestamp() });
                if (personRef) transaction.update(personRef, { linkedUid: user.uid });
                transaction.set(db.collection('users').doc(user.uid).collection('groups').doc(invite.groupId), { groupId: invite.groupId, groupName: invite.groupName, role, joinedAt: firebase.firestore.FieldValue.serverTimestamp() });
            });
            root.history.replaceState({}, '', root.location.pathname);
            await loadProfileAndGate();
            await openGroup((await db.collection('invitations').doc(inviteId).get()).data().groupId);
        } catch (error) { showStatus('Ezin izan da gonbidapena onartu: ' + safeError(error)); }
    }
    async function openGroup(groupId) {
        if (!signedIn()) return;
        if (groupUnsubscribe) { groupUnsubscribe(); groupUnsubscribe = null; }
        if (tripSyncUnsubscribe) { tripSyncUnsubscribe(); tripSyncUnsubscribe = null; }
        pendingTripWrites = false;
        const selectedUser = user;
        const groupRef = groupReference(groupId);
        try {
            const groupSnap = await groupRef.get();
            if (!groupSnap.exists || groupSnap.data().status !== 'active') throw new Error('Talde hau ez dago erabilgarri.');
            const groupData = groupSnap.data();
            let memberData = null;
            if (!isSuperAdmin()) {
                const memberSnap = await groupRef.collection('members').doc(user.uid).get();
                if (!memberSnap.exists) throw new Error('Ez zara talde honetako kidea.');
                memberData = memberSnap.data();
            } else {
                const memberSnap = await groupRef.collection('members').doc(user.uid).get();
                memberData = memberSnap.exists ? memberSnap.data() : { uid: user.uid, role: 'superadmin', personId: null };
            }
            if (selectedUser.uid !== user.uid) return;
            activeGroup = { id: groupId, ...groupData };
            activeMember = memberData;
            revision = Number(groupData.revision || 0);
            const selector = el('activeGroupSelect');
            selector.replaceChildren();
            const groupList = await loadMyGroups();
            if (isSuperAdmin()) {
                const all = await db.collection('groups').where('status', '==', 'active').get();
                const byId = new Map(groupList.map(group => [group.id, group]));
                all.forEach(doc => { if (!byId.has(doc.id)) byId.set(doc.id, { id: doc.id, ...doc.data(), membership: { role: 'superadmin' } }); });
                byId.forEach(group => selector.add(new Option(group.name, group.id)));
            } else groupList.forEach(group => selector.add(new Option(group.name, group.id)));
            selector.value = groupId;
            el('storageNote').textContent = 'Taldean sinkronizatuta';
            el('groupAdminTools').hidden = !canManageGroup();
            el('globalAdminNav').hidden = !platformRole;
            el('changeGroupNav').hidden = groupList.length < 2 && !isSuperAdmin();
            await loadActiveState();
            setGate('app');
            showStatus(root.navigator.onLine === false ? 'Sin conexión. Los viajes nuevos se guardarán en este dispositivo y se sincronizarán al volver internet.' : '');
            if (groupUnsubscribe) groupUnsubscribe();
            groupUnsubscribe = groupRef.onSnapshot(snapshot => {
                if (!snapshot.exists || !activeGroup || activeGroup.id !== groupId) return;
                const newRevision = Number(snapshot.data().revision || 0);
                if (newRevision !== revision && !saving) loadActiveState().catch(error => showStatus(safeError(error)));
            }, error => showStatus('Taldearen sinkronizazioa eten da: ' + safeError(error)));
            tripSyncUnsubscribe = groupRef.collection('trips').onSnapshot({ includeMetadataChanges: true }, snapshot => {
                const hasPending = snapshot.docs.some(doc => doc.metadata.hasPendingWrites);
                if (hasPending) showStatus('Bidaiak gailuan gordeta daude; Firebase-rekin sinkronizatzen ari dira.');
                else if (pendingTripWrites) showStatus('Bidaiak Firebase-rekin sinkronizatuta.');
                pendingTripWrites = hasPending;
            }, error => showStatus('Ezin izan da bidaien sinkronizazioa egiaztatu: ' + safeError(error)));
            await loadGroupManagement();
        } catch (error) {
            await refreshGroupsGate();
            el('groupsFeedback').textContent = 'Ezin izan da taldea ireki: ' + safeError(error);
        }
    }
    async function loadActiveState() {
        if (!activeGroup) return;
        const groupRef = groupReference(activeGroup.id);
        const groupSnap = await groupRef.get();
        if (!groupSnap.exists || groupSnap.data().status !== 'active') throw new Error('Taldea ez dago erabilgarri.');
        const groupData = groupSnap.data();
        const [people, trips] = await Promise.all([groupRef.collection('people').get(), groupRef.collection('trips').get()]);
        const next = normalizedStateFromSnapshots(people, trips);
        if (!api.validateState(next)) throw new Error('Taldeko bidaia-datuak ez dira baliozkoak; ez dira aldatu.');
        revision = Number(groupData.revision || 0);
        activeGroup = { id: activeGroup.id, ...groupData };
        if (typeof appStateCallback === 'function') appStateCallback(next, activeGroup, activeMember);
        el('groupDiscoverableToggle').checked = Boolean(groupData.discoverable);
    }
    function comparable(value) { return JSON.stringify(value); }
    function onlyAddedTrips(previous, next) {
        if (previous.people.length !== next.people.length || comparable(previous.opening) !== comparable(next.opening)) return false;
        const nextPeople = new Map(next.people.map(person => [person.id, person]));
        if (previous.people.some(person => comparable(person) !== comparable(nextPeople.get(person.id)))) return false;
        const nextTrips = new Map(next.trips.map(trip => [trip.id, trip]));
        return next.trips.length > previous.trips.length
            && previous.trips.every(trip => comparable(trip) === comparable(nextTrips.get(trip.id)));
    }
    async function persistState(previous, next) {
        if (!activeGroup || !user || !api.validateState(next)) return false;
        if (saving) { showStatus('Aurreko aldaketa gordetzen ari da; itxaron une batez.'); return false; }
        const targetGroupId = activeGroup.id;
        const targetUid = user.uid;
        const targetRevision = revision;
        const oldPeople = new Map(previous.people.map(person => [person.id, person]));
        const newPeople = new Map(next.people.map(person => [person.id, person]));
        const oldTrips = new Map(previous.trips.map(trip => [trip.id, trip]));
        const newTrips = new Map(next.trips.map(trip => [trip.id, trip]));
        if (onlyAddedTrips(previous, next)) {
            if (root.navigator.onLine === false && !persistenceEnabled) {
                showStatus('Ezin da bidaiarik gorde konexiorik gabe: gailu honetan Firestore-ren memoria iraunkorra ez dago erabilgarri.');
                return false;
            }
            const additions = next.trips.filter(trip => !oldTrips.has(trip.id));
            const batch = db.batch();
            const groupRef = groupReference(targetGroupId);
            additions.forEach(trip => batch.set(groupRef.collection('trips').doc(safeDocId(trip.id)), {
                id: trip.id,
                date: trip.date,
                driver: trip.driver,
                passengers: trip.passengers,
                createdBy: targetUid,
                ...(trip.createdByName || tripAuthorName(trip, next) ? { createdByName: trip.createdByName || tripAuthorName(trip, next) } : {}),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: targetUid,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }));
            batch.update(groupRef, {
                revision: firebase.firestore.FieldValue.increment(additions.length),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            revision += additions.length;
            activeGroup.revision = revision;
            const commit = batch.commit();
            commit.then(() => {
                if (activeGroup && activeGroup.id === targetGroupId && user && user.uid === targetUid) showStatus('Bidaia Firebase-rekin sinkronizatuta.');
            }).catch(async error => {
                console.error('Kotxea trip sync failed', error);
                showStatus('Bidaia ezin izan da sinkronizatu: ' + safeError(error));
                if (activeGroup && activeGroup.id === targetGroupId && user && user.uid === targetUid) {
                    try { await loadActiveState(); } catch (_) {}
                }
            });
            showStatus('Bidaia gailuan gorde da; Firebase-rekin sinkronizatzen ari da.');
            return { pending: true };
        }
        saving = true;
        try {
            await db.runTransaction(async transaction => {
                if (!auth.currentUser || auth.currentUser.uid !== targetUid) throw new Error('Saioa aldatu da; hasi berriro saioa gordetzeko.');
                const groupRef = groupReference(targetGroupId);
                const groupSnap = await transaction.get(groupRef);
                if (!groupSnap.exists || Number(groupSnap.data().revision || 0) !== targetRevision) {
                    const stale = new Error('Beste pertsona batek datuak aldatu ditu. Taldea berritu da; errepikatu zure aldaketa.');
                    stale.code = 'failed-precondition';
                    throw stale;
                }
                for (const [id, person] of oldPeople) {
                    if (!newPeople.has(id)) transaction.delete(groupRef.collection('people').doc(safeDocId(id)));
                }
                for (const [id, person] of newPeople) {
                    const old = oldPeople.get(id);
                    const opening = next.opening[id] || { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 };
                    if (!old || comparable({ ...old, linkedUid: undefined }) !== comparable({ ...person, linkedUid: undefined }) || comparable(previous.opening[id]) !== comparable(opening)) {
                        const doc = personDocument(person, opening);
                        if (old && old.linkedUid) doc.linkedUid = old.linkedUid;
                        transaction.set(groupRef.collection('people').doc(safeDocId(id)), doc, { merge: true });
                    }
                }
                for (const [id, trip] of oldTrips) {
                    if (!newTrips.has(id)) transaction.delete(groupRef.collection('trips').doc(safeDocId(id)));
                }
                for (const [id, trip] of newTrips) {
                    const old = oldTrips.get(id);
                    if (!old || comparable(old) !== comparable(trip)) {
                        transaction.set(groupRef.collection('trips').doc(safeDocId(id)), {
                            id: trip.id, date: trip.date, driver: trip.driver, passengers: trip.passengers,
                            createdBy: old && old.createdBy ? old.createdBy : targetUid,
                            ...(!old && tripAuthorName(trip, next) ? { createdByName: tripAuthorName(trip, next) } : {}),
                            ...(!old ? { createdAt: firebase.firestore.FieldValue.serverTimestamp() } : {}),
                            updatedBy: targetUid,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }
                }
                transaction.update(groupRef, { revision: targetRevision + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            });
            if (activeGroup && activeGroup.id === targetGroupId && user && user.uid === targetUid) {
                revision = targetRevision + 1;
                activeGroup.revision = revision;
            }
            return true;
        } catch (error) {
            console.error('Kotxea state save failed', error);
            if (error && error.code === 'failed-precondition' && activeGroup && activeGroup.id === targetGroupId) {
                try { await loadActiveState(); } catch (_) {}
            }
            showStatus('Ezin izan dira aldaketak gorde: ' + safeError(error));
            return false;
        } finally { saving = false; }
    }
    async function loadGroupManagement() {
        if (!activeGroup || !canManageGroup()) return;
        const requestList = el('groupRequestsList');
        const inviteList = el('groupInvitesList');
        const memberList = el('groupMembersList');
        requestList.replaceChildren(); inviteList.replaceChildren(); memberList.replaceChildren();
        try {
            const [requests, invites, members, people] = await Promise.all([
                db.collection('joinRequests').where('groupId', '==', activeGroup.id).where('status', '==', 'pending').get(),
                db.collection('invitations').where('groupId', '==', activeGroup.id).where('status', '==', 'pending').get(),
                groupReference(activeGroup.id).collection('members').get(),
                groupReference(activeGroup.id).collection('people').get()
            ]);
            const peopleById = new Map(people.docs.map(doc => [doc.data().id, doc.data()]));
            const invitePeople = el('invitePerson');
            invitePeople.replaceChildren(new Option('Aukeratu pertsona', ''));
            people.docs.forEach(personDoc => {
                const person = personDoc.data();
                if (!person.linkedUid) invitePeople.add(new Option(person.name, person.id));
            });
            const updateInvitePerson = () => {
                const adminInvite = el('inviteRole').value === 'admin';
                el('invitePersonField').hidden = adminInvite;
                invitePeople.required = !adminInvite;
            };
            el('inviteRole').onchange = updateInvitePerson;
            updateInvitePerson();
            if (requests.empty) requestList.textContent = 'Ez dago eskaera zain.';
            requests.forEach(doc => {
                const request = doc.data();
                const row = document.createElement('li'); row.className = 'group-picker-item';
                const label = document.createElement('span'); label.textContent = (request.displayName || request.email) + ' · ' + request.email;
                const picker = document.createElement('select'); picker.setAttribute('aria-label', 'Hautatu ' + (request.displayName || request.email) + ' pertsonaren fitxa');
                picker.add(new Option('Pertsona berria sortu', ''));
                people.docs.forEach(personDoc => {
                    const person = personDoc.data();
                    if (!person.linkedUid) picker.add(new Option(person.name, person.id));
                });
                const approve = document.createElement('button'); approve.type = 'button'; approve.textContent = 'Onartu';
                approve.addEventListener('click', () => resolveJoinRequest(doc.id, request, picker.value));
                const reject = document.createElement('button'); reject.type = 'button'; reject.className = 'secondary-button'; reject.textContent = 'Ezetsi';
                reject.addEventListener('click', () => resolveJoinRequest(doc.id, request, null, true));
                row.append(label, picker, approve, reject); requestList.append(row);
            });
            if (invites.empty) inviteList.textContent = 'Ez dago gonbidapen aktiborik.';
            invites.forEach(doc => {
                const invite = doc.data(); const row = document.createElement('li'); row.className = 'group-picker-item';
                const label = document.createElement('span'); label.textContent = invite.email + ' · ' + (peopleById.get(invite.personId)?.name || 'bidaiaria');
                const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'secondary-button'; revoke.textContent = 'Ezeztatu';
                revoke.addEventListener('click', () => revokeInvite(doc.id)); row.append(label, revoke); inviteList.append(row);
            });
            if (members.empty) memberList.textContent = 'Ez dago taldekiderik.';
            members.forEach(doc => {
                const member = doc.data(); const row = document.createElement('li'); row.className = 'group-picker-item';
                const person = peopleById.get(member.personId);
                const label = document.createElement('span'); label.textContent = (member.displayName || member.email) + (person ? ' · ' + person.name : ' · bidaiatzen ez duen administratzailea');
                const role = document.createElement('span'); role.textContent = member.role === 'owner' ? 'Jabea' : member.role === 'admin' ? 'Taldeko admin' : 'Kidea';
                row.append(label, role);
                if (member.uid !== user.uid && member.role !== 'owner' && canManageGroup()) {
                    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
                    button.textContent = member.role === 'admin' ? 'Admin rola kendu' : 'Taldeko admin egin';
                    button.addEventListener('click', () => setGroupAdmin(member.uid, member.role !== 'admin'));
                    row.append(button);
                }
                memberList.append(row);
            });
            el('groupDiscoverableToggle').checked = Boolean(activeGroup.discoverable);
        } catch (error) { showStatus('Ezin izan dira taldeko eskaerak kargatu: ' + safeError(error)); }
    }
    async function resolveJoinRequest(requestId, request, personId, reject = false) {
        if (!activeGroup || !canManageGroup()) return;
        try {
            await db.runTransaction(async transaction => {
                const requestRef = db.collection('joinRequests').doc(requestId);
                const requestSnap = await transaction.get(requestRef);
                if (!requestSnap.exists || requestSnap.data().status !== 'pending') throw new Error('Eskaera jada kudeatu da.');
                const groupRef = groupReference(activeGroup.id);
                const groupSnap = await transaction.get(groupRef);
                if (!groupSnap.exists) throw new Error('Taldea ez da aurkitu.');
                if (reject) {
                    transaction.update(requestRef, { status: 'rejected', reviewedBy: user.uid, reviewedAt: firebase.firestore.FieldValue.serverTimestamp() });
                    transaction.set(db.collection('users').doc(request.uid).collection('requests').doc(requestId), { status: 'rejected' }, { merge: true });
                    return;
                }
                const peopleRef = groupRef.collection('people');
                const personRef = personId ? peopleRef.doc(safeDocId(personId)) : peopleRef.doc(request.uid);
                const memberRef = groupRef.collection('members').doc(request.uid);
                const existingMember = await transaction.get(memberRef);
                if (existingMember.exists) throw new Error('Erabiltzailea taldeko kidea da jada.');
                let person = null;
                if (personId) {
                    const personSnap = await transaction.get(personRef);
                    if (!personSnap.exists || (personSnap.data().linkedUid && personSnap.data().linkedUid !== request.uid)) throw new Error('Pertsona hori beste kontu bati lotuta dago.');
                    person = personSnap.data();
                } else {
                    person = { id: request.uid, name: request.displayName || request.email, active: true, opening: { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }, createdBy: user.uid };
                }
                const newRole = 'member';
                if (!personId) transaction.set(personRef, { ...person, linkedUid: request.uid });
                else transaction.update(personRef, { linkedUid: request.uid });
                transaction.set(memberRef, { uid: request.uid, email: request.email, displayName: request.displayName || request.email, role: newRole, personId: person.id, joinRequestId: requestId, joinedAt: firebase.firestore.FieldValue.serverTimestamp() });
                transaction.set(db.collection('users').doc(request.uid).collection('groups').doc(activeGroup.id), { groupId: activeGroup.id, groupName: activeGroup.name, role: newRole, joinedAt: firebase.firestore.FieldValue.serverTimestamp() });
                transaction.update(requestRef, { status: 'approved', personId: person.id, reviewedBy: user.uid, reviewedAt: firebase.firestore.FieldValue.serverTimestamp() });
                transaction.set(db.collection('users').doc(request.uid).collection('requests').doc(requestId), { status: 'approved', personId: person.id }, { merge: true });
                transaction.update(groupRef, { revision: Number(groupSnap.data().revision || 0) + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            });
            await loadGroupManagement();
            showStatus(reject ? 'Eskaera ezetsita.' : 'Eskaera onartuta; kidea taldearekin lotu da.');
        } catch (error) { showStatus('Ezin izan da eskaera kudeatu: ' + safeError(error)); }
    }
    async function inviteMember(event) {
        event.preventDefault();
        if (!activeGroup || !canManageGroup()) return;
        const email = normalizeEmail(el('inviteEmail').value);
        const role = el('inviteRole').value === 'admin' ? 'admin' : 'member';
        const personId = el('invitePerson').value || null;
        if (!email || (role === 'member' && !personId)) return;
        try {
            let personName = '';
            if (personId) {
                const person = (await groupReference(activeGroup.id).collection('people').doc(safeDocId(personId)).get()).data();
                if (!person || person.linkedUid) throw new Error('Pertsona hori jada beste kontu bati lotuta dago.');
                personName = person.name;
            }
            const inviteRef = db.collection('invitations').doc();
            const expiresAt = firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
            await inviteRef.set({
                groupId: activeGroup.id, groupName: activeGroup.name, email, personId, personName,
                role, status: 'pending', createdBy: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(), expiresAt
            });
            const inviteUrl = new URL(root.location.href);
            inviteUrl.search = '';
            inviteUrl.hash = '';
            inviteUrl.searchParams.set('invite', inviteRef.id);
            const feedback = el('inviteFeedback');
            feedback.replaceChildren();
            const text = document.createElement('p'); text.textContent = 'Esteka sortu da. Bidali eskuz gonbidatutako pertsonari; bere helbidearekin saioa hasi behar du.';
            const link = document.createElement('a'); link.href = inviteUrl.toString(); link.textContent = 'Gonbidapena ireki'; link.target = '_blank'; link.rel = 'noopener';
            const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary-button'; copy.textContent = 'Esteka kopiatu';
            copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl.toString()); copy.textContent = 'Kopiatuta'; } catch (_) { feedback.append(document.createTextNode(' Kopiatu esteka: ' + inviteUrl.toString())); } });
            feedback.append(text, link, copy);
            el('inviteForm').reset();
            await loadGroupManagement();
        } catch (error) { el('inviteFeedback').textContent = 'Ezin izan da gonbidapena sortu: ' + safeError(error); }
    }
    async function revokeInvite(inviteId) {
        if (!activeGroup || !canManageGroup()) return;
        if (!root.confirm('Gonbidapen hau ezeztatu?')) return;
        try { await db.collection('invitations').doc(inviteId).update({ status: 'revoked', revokedAt: firebase.firestore.FieldValue.serverTimestamp(), revokedBy: user.uid }); await loadGroupManagement(); }
        catch (error) { showStatus('Ezin izan da gonbidapena ezeztatu: ' + safeError(error)); }
    }
    async function setGroupAdmin(uid, makeAdmin) {
        if (!activeGroup || !canManageGroup() || uid === user.uid) return;
        const role = makeAdmin ? 'admin' : 'member';
        try {
            const batch = db.batch();
            batch.update(groupReference(activeGroup.id).collection('members').doc(uid), { role });
            batch.set(db.collection('users').doc(uid).collection('groups').doc(activeGroup.id), { role }, { merge: true });
            await batch.commit();
            await loadGroupManagement();
        } catch (error) { showStatus('Ezin izan da taldeko rola aldatu: ' + safeError(error)); }
    }
    async function saveDiscoverability() {
        if (!activeGroup || !canManageGroup()) return;
        const discoverable = el('groupDiscoverableToggle').checked;
        const publicData = {
            groupId: activeGroup.id,
            name: activeGroup.name,
            discoverable,
            status: activeGroup.status,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            const batch = db.batch();
            batch.update(groupReference(activeGroup.id), { discoverable, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            batch.set(db.collection('directoryGroups').doc(activeGroup.id), publicData);
            await batch.commit();
            activeGroup.discoverable = discoverable;
            showStatus('Taldearen ikusgaitasuna gordeta.');
        } catch (error) { showStatus('Ezin izan da ikusgaitasuna gorde: ' + safeError(error)); }
    }
    async function loadAdminPanel() {
        if (!platformRole) return;
        setGate('adminPanel');
        const list = el('adminGroupsList'); list.replaceChildren();
        el('allUsersPanel').hidden = !isSuperAdmin();
        try {
            const groups = isSuperAdmin()
                ? (await db.collection('groups').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))
                : (await loadMyGroups()).filter(group => ['owner', 'admin'].includes((group.membership || {}).role));
            if (!groups.length) list.textContent = 'Ez dago kudeatzeko talderik.';
            // This dashboard reads each group's current history, which is practical for the family-scale dataset.
            // Store per-group aggregates if the number of groups or trips grows substantially.
            await Promise.all(groups.map(async group => {
                const row = document.createElement('li'); row.className = 'group-picker-item';
                const text = document.createElement('div');
                const label = document.createElement('strong'); label.textContent = group.name || 'Taldea';
                const description = document.createElement('span');
                if (group.status === 'active') {
                    const groupRef = groupReference(group.id);
                    const [members, people, trips, requests, invitations] = await Promise.all([
                        groupRef.collection('members').get(), groupRef.collection('people').get(), groupRef.collection('trips').get(),
                        db.collection('joinRequests').where('groupId', '==', group.id).where('status', '==', 'pending').get(),
                        db.collection('invitations').where('groupId', '==', group.id).where('status', '==', 'pending').get()
                    ]);
                    const state = normalizedStateFromSnapshots(people, trips);
                    const summary = api.calculateSummary(state);
                    const balances = state.people.map(person => person.name + ' ' + Number(summary[person.id].emaitza).toLocaleString('eu-ES', { maximumFractionDigits: 2 })).join(' · ');
                    description.textContent = members.size + ' erabiltzaile · ' + trips.size + ' bidaia · ' + requests.size + ' eskaera · ' + invitations.size + ' gonbidapen' + (balances ? ' · ' + balances : ' · bidaiaririk gabe');
                } else description.textContent = 'Taldea prestatzen ari da';
                const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Kudeatu'; open.addEventListener('click', () => openGroup(group.id));
                text.append(label, description); row.append(text, open); list.append(row);
            }));
            if (isSuperAdmin()) {
                el('adminFeedback').textContent = 'Kontu guztiak kargatzen…';
                const result = await firebase.app().functions('us-central1').httpsCallable('listAuthUsers')({});
                adminUsers = result.data.users || [];
                renderAdminUsers();
                watchAdminPresence();
                el('adminFeedback').textContent = '';
            }
        } catch (error) { el('adminFeedback').textContent = 'Ezin izan da administrazio-panela kargatu: ' + safeError(error); }
    }
    function renderAdminUsers() {
        const filters = {
            firstName: normalizeSearch(el('adminUserNameFilter').value.trim()),
            lastName: normalizeSearch(el('adminUserLastNameFilter').value.trim()),
            role: el('adminUserRoleFilter').value,
            createdFrom: el('adminCreatedFrom').value,
            createdTo: el('adminCreatedTo').value,
            lastSeenFrom: el('adminLastSeenFrom').value,
            lastSeenTo: el('adminLastSeenTo').value
        };
        const matches = adminUsers.filter(profile => {
            const firstName = normalizeSearch(profile.firstName);
            const lastName = normalizeSearch(profile.lastName);
            const role = profile.deletionPending ? 'deletionPending' : profile.platformRole === 'superadmin' ? 'superadmin' : 'normal';
            const createdAt = dateInputValue(profile.createdAt);
            const lastSeenAt = dateInputValue(profile.lastSeenAt);
            return (!filters.firstName || firstName.includes(filters.firstName))
                && (!filters.lastName || lastName.includes(filters.lastName))
                && (!filters.role || role === filters.role)
                && (!filters.createdFrom || (createdAt && createdAt >= filters.createdFrom))
                && (!filters.createdTo || (createdAt && createdAt <= filters.createdTo))
                && (!filters.lastSeenFrom || (lastSeenAt && lastSeenAt >= filters.lastSeenFrom))
                && (!filters.lastSeenTo || (lastSeenAt && lastSeenAt <= filters.lastSeenTo));
        });
        const userList = el('adminUsersList'); userList.replaceChildren();
        const countText = count => count + (count === 1 ? ' cuenta' : ' cuentas');
        el('adminUserCount').textContent = matches.length === adminUsers.length
            ? countText(adminUsers.length) + ' registradas'
            : countText(matches.length) + ' de ' + countText(adminUsers.length);
        el('adminUsersEmpty').hidden = matches.length > 0 || adminUsers.length === 0;
        matches.forEach(profile => {
            const row = document.createElement('tr');
            const addCell = (label, content, className) => {
                const cell = document.createElement('td'); cell.dataset.label = label;
                if (className) cell.className = className;
                cell.textContent = content;
                row.append(cell);
                return cell;
            };
            addCell('Correo', profile.email || '—', 'admin-user-email');
            addCell('Nombre', profile.firstName || '—');
            addCell('Apellidos', profile.lastName || '—');
            const typeCell = addCell('Tipo de usuario', '', 'admin-user-type');
            const badge = document.createElement('span'); badge.className = 'admin-role-badge';
            badge.dataset.role = profile.deletionPending ? 'pending' : profile.platformRole === 'superadmin' ? 'superadmin' : 'normal';
            badge.textContent = profile.deletionPending ? 'Borrado pendiente' : profile.platformRole === 'superadmin' ? 'Administrador global' : 'Normal';
            typeCell.append(badge);
            addCell('Fecha de alta', formatAdminDate(profile.createdAt));
            const connection = addCell('Conexión', '', 'admin-user-connection');
            const connectionContent = document.createElement('span'); connectionContent.className = 'admin-user-connection-content';
            const lastSeenMs = profile.lastSeenAt ? Date.parse(profile.lastSeenAt) : NaN;
            if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs < 120000) {
                const online = document.createElement('span'); online.className = 'admin-presence-badge';
                online.textContent = 'En línea'; connectionContent.append(online);
            }
            const lastSeen = document.createElement('span'); lastSeen.className = 'admin-user-last-seen';
            lastSeen.textContent = formatAdminDate(profile.lastSeenAt); connectionContent.append(lastSeen); connection.append(connectionContent);
            const actions = document.createElement('td'); actions.className = 'admin-user-actions'; actions.dataset.label = 'Gestionar';
            const actionButtons = document.createElement('div'); actionButtons.className = 'admin-user-actions-buttons';
            if (!profile.deletionPending) {
                const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-button'; edit.textContent = 'Editar';
                edit.addEventListener('click', () => openPlatformUserEditor(profile));
                actionButtons.append(edit);
            }
            if (profile.uid !== user.uid) {
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger-button';
                remove.textContent = profile.deletionPending ? 'Reintentar borrado' : 'Borrar';
                remove.addEventListener('click', () => openPlatformUserDeletion(profile));
                actionButtons.append(remove);
            }
            actions.append(actionButtons); row.append(actions); userList.append(row);
        });
        if (!adminUsers.length) {
            const row = document.createElement('tr'); const empty = document.createElement('td');
            empty.colSpan = 8; empty.className = 'admin-users-empty-cell'; empty.textContent = 'No hay cuentas registradas.';
            row.append(empty); userList.append(row);
        }
    }
    function stopAdminPresenceListener() {
        if (adminPresenceUnsubscribe) adminPresenceUnsubscribe();
        adminPresenceUnsubscribe = null;
        if (adminPresenceRefreshTimer) root.clearInterval(adminPresenceRefreshTimer);
        adminPresenceRefreshTimer = null;
    }
    function watchAdminPresence() {
        stopAdminPresenceListener();
        adminPresenceUnsubscribe = db.collection('userPresence').onSnapshot(snapshot => {
            const presence = new Map();
            snapshot.forEach(document => {
                const data = document.data();
                const value = data.lastSeenAt && data.lastSeenAt.toDate && data.lastSeenAt.toDate().toISOString();
                if (value) presence.set(document.id, value);
            });
            adminUsers = adminUsers.map(profile => ({ ...profile, lastSeenAt: presence.get(profile.uid) || null }));
            renderAdminUsers();
        }, error => {
            console.warn('Kotxea live user presence unavailable:', error && error.code);
        });
        adminPresenceRefreshTimer = root.setInterval(renderAdminUsers, 30000);
    }
    function updateOwnPresence() {
        if (!presenceEnabled || !user || !db || document.visibilityState === 'hidden') return;
        db.collection('userPresence').doc(user.uid).set({
            uid: user.uid,
            lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(error => console.warn('Kotxea presence update failed:', error && error.code));
    }
    function stopPresenceTracking() {
        presenceEnabled = false;
        if (presenceHeartbeat) root.clearInterval(presenceHeartbeat);
        presenceHeartbeat = null;
    }
    function startPresenceTracking() {
        stopPresenceTracking();
        presenceEnabled = true;
        updateOwnPresence();
        presenceHeartbeat = root.setInterval(updateOwnPresence, 60000);
    }
    function syncPlatformUserRoleFields() {
        el('editPlatformParticipationRow').hidden = el('editPlatformRole').value !== 'superadmin';
        if (el('editPlatformRole').value !== 'superadmin') el('editPlatformCanParticipate').checked = false;
    }
    function openPlatformUserEditor(profile) {
        el('editPlatformUserUid').value = profile.uid;
        el('editPlatformUserEmail').textContent = profile.email || '';
        el('editPlatformFirstName').value = profile.firstName || '';
        el('editPlatformLastName').value = profile.lastName || '';
        el('editPlatformRole').value = profile.platformRole === 'superadmin' ? 'superadmin' : 'normal';
        el('editPlatformCanParticipate').checked = profile.canParticipate === true;
        el('editPlatformRole').disabled = profile.uid === user.uid;
        el('editPlatformCanParticipate').disabled = profile.uid === user.uid;
        el('editPlatformUserFeedback').textContent = '';
        syncPlatformUserRoleFields();
        el('editPlatformUserDialog').showModal();
    }
    function openPlatformUserDeletion(profile) {
        el('deletePlatformUserDescription').textContent = (profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.email) + ' · ' + profile.email;
        el('deletePlatformUserFeedback').textContent = '';
        el('confirmDeletePlatformUserButton').dataset.uid = profile.uid;
        el('confirmDeletePlatformUserButton').disabled = false;
        el('deletePlatformUserDialog').showModal();
    }
    async function savePlatformUser(event) {
        event.preventDefault();
        if (!isSuperAdmin()) return;
        const button = el('savePlatformUserButton'); button.disabled = true;
        try {
            await firebase.app().functions('us-central1').httpsCallable('setPlatformUser')({
                uid: el('editPlatformUserUid').value,
                firstName: el('editPlatformFirstName').value.trim(),
                lastName: el('editPlatformLastName').value.trim(),
                role: el('editPlatformRole').value,
                canParticipate: el('editPlatformCanParticipate').checked
            });
            el('editPlatformUserDialog').close();
            await loadAdminPanel();
        } catch (error) { el('editPlatformUserFeedback').textContent = safeError(error); }
        finally { button.disabled = false; }
    }
    async function confirmDeletePlatformUser() {
        const button = el('confirmDeletePlatformUserButton');
        button.disabled = true;
        try {
            await firebase.app().functions('us-central1').httpsCallable('deletePlatformUser')({ uid: button.dataset.uid });
            el('deletePlatformUserDialog').close();
            await loadAdminPanel();
        } catch (error) { el('deletePlatformUserFeedback').textContent = safeError(error); }
        finally { button.disabled = false; }
    }
    function updateAuthFeedback(message) { el('authFeedback').textContent = message || ''; }
    function setRegistrationMode(value) {
        registrationMode = value;
        el('authSubmitBtn').textContent = value ? 'Kontua sortu' : 'Saioa hasi';
        el('authModeBtn').textContent = value ? 'Badut kontua; saioa hasi' : 'Kontu berria sortu';
        el('authPassword').autocomplete = value ? 'new-password' : 'current-password';
        el('registrationNameFields').hidden = !value;
        el('registrationFirstName').required = value;
        el('registrationLastName').required = value;
        updateAuthFeedback('');
    }
    async function handleAuthSubmit(event) {
        event.preventDefault();
        const email = normalizeEmail(el('authEmail').value);
        const password = el('authPassword').value;
        const button = el('authSubmitBtn'); button.disabled = true;
        try {
            if (registrationMode) {
                const firstName = el('registrationFirstName').value.trim();
                const lastName = el('registrationLastName').value.trim();
                if (!firstName || !lastName) throw new Error('Indica el nombre y los apellidos para crear la cuenta.');
                const displayName = [firstName, lastName].join(' ');
                const result = await auth.createUserWithEmailAndPassword(email, password);
                await result.user.updateProfile({ displayName });
                await db.collection('users').doc(result.user.uid).set({
                    uid: result.user.uid, email, displayName, firstName, lastName,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                await result.user.sendEmailVerification(authActionSettings());
                updateAuthFeedback('Egiaztapen-mezua bidali dizugu. Egiaztatu posta eta itzuli Kotxeara.');
                el('resendVerificationBtn').hidden = false;
                el('verifiedContinueBtn').hidden = false;
            } else {
                await auth.signInWithEmailAndPassword(email, password);
            }
        } catch (error) { updateAuthFeedback(safeError(error)); }
        finally { button.disabled = false; }
    }
    async function handleGoogleSignIn() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try { await auth.signInWithPopup(provider); }
        catch (error) { updateAuthFeedback(safeError(error)); }
    }
    async function resendVerification() {
        if (!auth.currentUser || auth.currentUser.emailVerified) return;
        try { await auth.currentUser.sendEmailVerification(authActionSettings()); updateAuthFeedback('Egiaztapen-mezua berriro bidali da.'); }
        catch (error) { updateAuthFeedback(safeError(error)); }
    }
    async function refreshVerifiedUser() {
        if (!auth.currentUser) return;
        try { await auth.currentUser.reload(); user = auth.currentUser; await user.getIdToken(true); await loadProfileAndGate(); }
        catch (error) { updateAuthFeedback(safeError(error)); }
    }
    async function resetPassword() {
        const email = normalizeEmail(el('authEmail').value);
        if (!email) { updateAuthFeedback('Idatzi posta elektronikoa lehenengo.'); return; }
        try { await auth.sendPasswordResetEmail(email, authActionSettings()); updateAuthFeedback('Pasahitza berrezartzeko mezua bidali da.'); }
        catch (error) { updateAuthFeedback(safeError(error)); }
    }
    function verificationRequired(user) {
        return Boolean(user && user.providerData && user.providerData.some(provider => provider.providerId === 'password') && !user.emailVerified);
    }
    function showProfileLoadError(error) {
        console.error('Kotxea auth initialization failed', error);
        setGate('groupsPanel');
        el('groupsFeedback').textContent = 'Ezin izan dira kontuaren datuak kargatu: ' + safeError(error) + ' Saiatu berriro edo itxi saioa.';
        el('retryProfileBtn').hidden = false;
    }
    async function loadProfileAndGate() {
        if (!user) { stopPresenceTracking(); activeGroup = null; activeMember = null; setGate('authPanel'); el('resendVerificationBtn').hidden = true; el('verifiedContinueBtn').hidden = true; return; }
        el('accountMenuBtn').textContent = user.displayName || user.email || 'Kontua';
        if (!el('newGroupParticipantName').value) el('newGroupParticipantName').value = user.displayName || '';
        if (verificationRequired(user)) {
            stopPresenceTracking();
            setGate('authPanel');
            el('authTitle').textContent = 'Egiaztatu zure posta elektronikoa';
            updateAuthFeedback('Bidali dizugun estekarekin egiaztatu kontua, eta sakatu “Posta egiaztatu dut”.');
            el('resendVerificationBtn').hidden = false; el('verifiedContinueBtn').hidden = false;
            return;
        }
        startPresenceTracking();
        el('authTitle').textContent = 'Sartu Kotxean';
        setGate('groupsPanel');
        el('groupsFeedback').textContent = 'Kontuaren datuak kargatzen…';
        el('retryProfileBtn').hidden = true;
        const profileRef = db.collection('users').doc(user.uid);
        const profile = await profileRef.get();
        if (!profile.exists) {
            await profileRef.set({ uid: user.uid, email: normalizeEmail(user.email), displayName: user.displayName || user.email || 'Erabiltzailea', firstName: '', lastName: '', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        const roleDoc = await db.collection('platformRoles').doc(user.uid).get();
        platformRole = roleDoc.exists ? roleDoc.data().role : null;
        platformCanParticipate = roleDoc.exists && roleDoc.data().canParticipate === true;
        el('globalAdminNav').hidden = !platformRole;
        await refreshGroupsGate();
    }
    async function signOut() { if (groupUnsubscribe) groupUnsubscribe(); groupUnsubscribe = null; if (tripSyncUnsubscribe) tripSyncUnsubscribe(); tripSyncUnsubscribe = null; activeGroup = null; activeMember = null; platformRole = null; platformCanParticipate = false; await auth.signOut(); }
    async function start(options) {
        appStateCallback = options && options.onState;
        statusCallback = options && options.onStatus;
        if (!root.firebase || !root.KOTXEA_FIREBASE_CONFIG) { setGate('authPanel'); updateAuthFeedback('Firebase konfigurazioa ezin izan da kargatu.'); return; }
        if (!firebase.apps.length) firebase.initializeApp(root.KOTXEA_FIREBASE_CONFIG);
        auth = firebase.auth(); db = firebase.firestore();
        root.addEventListener('offline', () => { if (activeGroup) showStatus('Sin conexión. Los viajes nuevos se guardarán en este dispositivo y se sincronizarán al volver internet.'); });
        root.addEventListener('online', () => { if (activeGroup) showStatus('Conexión recuperada; Firestore está sincronizando los viajes guardados en el dispositivo.'); });
        try { await db.enablePersistence({ synchronizeTabs: true }); persistenceEnabled = true; } catch (error) { if (!error || error.code !== 'failed-precondition') console.warn('Firestore offline cache disabled:', error && error.code); }
        auth.onAuthStateChanged(async authUser => {
            user = authUser;
            if (!authUser) { platformRole = null; platformCanParticipate = false; await loadProfileAndGate(); return; }
            try { await loadProfileAndGate(); }
            catch (error) { showProfileLoadError(error); }
        });

        el('authForm').addEventListener('submit', handleAuthSubmit);
        el('authModeBtn').addEventListener('click', () => setRegistrationMode(!registrationMode));
        el('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
        el('resetPasswordBtn').addEventListener('click', resetPassword);
        el('resendVerificationBtn').addEventListener('click', resendVerification);
        el('verifiedContinueBtn').addEventListener('click', refreshVerifiedUser);
        el('retryProfileBtn').addEventListener('click', async () => {
            try { await loadProfileAndGate(); }
            catch (error) { showProfileLoadError(error); }
        });
        el('createGroupForm').addEventListener('submit', createGroup);
        let initialInviteCount = 1;
        el('addInitialInviteBtn').addEventListener('click', () => {
            initialInviteCount += 1;
            const row = document.createElement('div'); row.className = 'initial-invite-row';
            row.innerHTML = '<div class="field"><label for="initialInviteName' + initialInviteCount + '">Bidaiariaren izena</label><input id="initialInviteName' + initialInviteCount + '" data-field="name" maxlength="80" autocomplete="off"></div><div class="field"><label for="initialInviteEmail' + initialInviteCount + '">Posta elektronikoa</label><input id="initialInviteEmail' + initialInviteCount + '" data-field="email" type="email" autocomplete="email"></div>';
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Kendu gonbidapen hau';
            remove.addEventListener('click', () => row.remove()); row.append(remove);
            el('initialInviteRows').append(row);
        });
        el('groupSearchForm').addEventListener('submit', event => { event.preventDefault(); refreshDiscoverableGroups(); });
        el('signOutFromGroupsBtn').addEventListener('click', signOut);
        el('accountMenuBtn').addEventListener('click', refreshGroupsGate);
        el('activeGroupSelect').addEventListener('change', event => openGroup(event.target.value));
        el('changeGroupNav').addEventListener('click', refreshGroupsGate);
        el('globalAdminNav').addEventListener('click', loadAdminPanel);
        el('globalAdminFromGroupsBtn').addEventListener('click', loadAdminPanel);
        el('backToGroupsBtn').addEventListener('click', refreshGroupsGate);
        el('editPlatformUserForm').addEventListener('submit', savePlatformUser);
        el('editPlatformRole').addEventListener('change', syncPlatformUserRoleFields);
        el('adminUserFilters').addEventListener('submit', event => event.preventDefault());
        el('adminUserFilters').addEventListener('input', renderAdminUsers);
        el('adminUserFilters').addEventListener('change', renderAdminUsers);
        el('adminUserFilters').addEventListener('reset', () => root.setTimeout(renderAdminUsers, 0));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') updateOwnPresence();
        });
        el('confirmDeletePlatformUserButton').addEventListener('click', confirmDeletePlatformUser);
        if (document.querySelectorAll) document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
            const dialog = el(button.dataset.closeDialog);
            if (dialog && dialog.open) dialog.close();
        }));
        el('inviteForm').addEventListener('submit', inviteMember);
        el('saveGroupVisibilityBtn').addEventListener('click', saveDiscoverability);
        root.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; el('installAppBtn').hidden = false; });
        el('installAppBtn').addEventListener('click', () => {
            const userAgent = root.navigator.userAgent || '';
            const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (root.navigator.platform === 'MacIntel' && root.navigator.maxTouchPoints > 1);
            const isChrome = /CriOS|Chrome|Chromium/.test(userAgent);
            const isSafari = /Safari/.test(userAgent) && !/CriOS|Chrome|Chromium|Edg|OPR/.test(userAgent);
            const isMac = /Macintosh|Mac OS X/.test(userAgent) || root.navigator.platform === 'MacIntel';
            const text = deferredInstallPrompt
                ? 'Chrome-n, sakatu beheko “Instalatu” botoia eta baieztatu Chrome-k erakutsiko dizun leihoan. Kotxea hasierako pantailan edo aplikazioen zerrendan agertuko da.'
                : isIOS
                    ? isChrome
                        ? 'Chrome-n (iPhone/iPad): sakatu helbide barraren ondoko Partekatu ikonoa, aukeratu “Añadir a pantalla de inicio” (“Gehitu hasierako pantailara”) eta sakatu “Gehitu”.'
                        : 'Safari-n (iPhone/iPad): sakatu Partekatu ikonoa (gorantz gezia duen laukia), aukeratu “Añadir a pantalla de inicio” (“Gehitu hasierako pantailara”) eta sakatu “Gehitu”. “Abrir como app web” aukera agertzen bada, aktibatu.'
                    : isSafari && isMac
                        ? 'Safari-n (Mac): menu-barran, aukeratu Fitxategia > Gehitu Dock-era (“File > Add to Dock”) eta sakatu “Gehitu”. Partekatu ikonoaren bidez ere egin dezakezu.'
                        : /Android/.test(userAgent) && isChrome
                            ? 'Chrome-n (Android): ireki ⋮ menua eta aukeratu “Instalar aplicación” (“Instalatu aplikazioa”) edo “Añadir a pantalla de inicio” (“Gehitu hasierako pantailara”); ondoren, baieztatu “Instalatu” sakatuta.'
                            : isChrome
                                ? 'Chrome-n (ordenagailuan): sakatu helbide barrako Instalatu ikonoa. Ikonoa agertzen ez bada, ireki ⋮ > “Transmitir, guardar y compartir” > “Instalar página como aplicación”.'
                                : 'Ireki Kotxea Safari-n edo Chrome-n eta jarraitu azaldu diren pausoak. Instalatu ondoren, hasierako pantailako edo aplikazioen zerrendako Kotxea ikonoa erabil dezakezu.';
            el('installDialogText').textContent = text;
            el('installConfirmBtn').hidden = !deferredInstallPrompt;
            el('installDialog').showModal();
        });
        el('installConfirmBtn').addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            const promptEvent = deferredInstallPrompt;
            deferredInstallPrompt = null;
            el('installDialog').close();
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            const installed = choice && choice.outcome === 'accepted'
                || root.matchMedia('(display-mode: standalone)').matches
                || root.navigator.standalone === true;
            el('installAppBtn').hidden = Boolean(installed);
        });
        const standalone = root.matchMedia('(display-mode: standalone)').matches || root.navigator.standalone === true;
        if (!standalone) el('installAppBtn').hidden = false;
        root.addEventListener('appinstalled', () => { el('installAppBtn').hidden = true; el('installHelp').hidden = true; });
        if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
            navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(error => console.warn('Kotxea service worker unavailable:', error));
        }
    }

    root.KotxeaCloud = {
        start,
        persistState,
        currentUser: () => user,
        currentGroup: () => activeGroup,
        currentMember: () => activeMember,
        platformRole: () => platformRole,
        canManageGroup: () => canManageGroup(),
        refreshManagement: loadGroupManagement,
        getLegacyState: localLegacyState
    };
}(typeof window !== 'undefined' ? window : globalThis));
