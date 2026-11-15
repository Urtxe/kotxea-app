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
    let activeGroup = null;
    let activeMember = null;
    let revision = 0;
    let groupUnsubscribe = null;
    let localState = null;
    let appStateCallback = null;
    let statusCallback = null;
    let saving = false;
    let registrationMode = false;
    let deferredInstallPrompt = null;

    function el(id) { return document.getElementById(id); }
    function signedIn() { return Boolean(user && user.uid); }
    function isSuperAdmin() { return platformRole === 'superadmin'; }
    function canCreateGroups() { return platformRole === 'superadmin' || platformRole === 'creator'; }
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
    function setGate(panelId) {
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
            const data = doc.data();
            if (!data || typeof data.id !== 'string') return;
            const person = { id: data.id, name: data.name, active: data.active !== false };
            if (data.default) person.default = true;
            if (data.linkedUid) person.linkedUid = data.linkedUid;
            people.push(person);
            opening[data.id] = data.opening || { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 };
        });
        const trips = [];
        tripsSnapshot.forEach(doc => {
            const data = doc.data();
            if (!data || typeof data.id !== 'string') return;
            trips.push({ id: data.id, date: data.date, driver: data.driver, passengers: data.passengers, ...(data.createdBy ? { createdBy: data.createdBy } : {}) });
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
            operations.push({ ref: groupRef.collection('trips').doc(safeDocId(trip.id)), data: { id: trip.id, date: trip.date, driver: trip.driver, passengers: trip.passengers, createdBy: user.uid, updatedBy: user.uid } });
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
        const name = el('newGroupName').value.trim();
        if (!name) return;
        const wantsImport = el('importLocalData').checked && !root.localStorage.getItem('kotxeaImportCompleted') && hasLocalLegacyData();
        const imported = wantsImport ? localLegacyState() : { state: blankGroupState() };
        if (imported.error) { el('createGroupFeedback').textContent = imported.error; return; }
        const initialState = imported.state || api.emptyState();
        if (!api.validateState(initialState)) { el('createGroupFeedback').textContent = 'Gailuko bidaia-datuak ezin dira inportatu; deskargatu kopia JSON bat eta berrikusi.'; return; }
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
                personId: null,
                joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            batch.set(db.collection('users').doc(user.uid).collection('groups').doc(groupId), {
                groupId, groupName: name, role: 'owner', joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await batch.commit();
            await writeInitialState(groupId, initialState);
            await finishGroupSetup(groupId, groupData);
            root.localStorage.removeItem(migrationKey);
            root.localStorage.setItem('kotxeaImportCompleted', '1');
            el('createGroupForm').reset();
            el('createGroupFeedback').textContent = 'Taldea prest dago.';
            await openGroup(groupId);
        } catch (error) {
            console.error('Kotxea group setup failed', error);
            el('createGroupFeedback').textContent = 'Taldea sortzea ez da amaitu. Ez sortu beste talde bat; sakatu “Jarraitu inportazioa” zure taldeetan berriro saiatzeko.';
            showStatus(safeError(error));
        } finally {
            submit.disabled = false;
        }
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
        setGate('groups');
        el('createGroupDetails').hidden = !canCreateGroups();
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
        if (userGroups.length === 0 && !canCreateGroups()) {
            el('groupsFeedback').textContent = platformRole ? 'Oraindik ez dago talderik. Bilatu bat eta eskatu sartzeko.' : 'Kontu honek ez du talde-sortzaile rolik. Eskatu superadministratzaileari taldea sortzeko baimena.';
        } else {
            el('groupsFeedback').textContent = userGroups.length ? 'Aukeratu zein taldetan lan egin.' : 'Sortu lehen taldea edo bilatu taldea.';
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
        if (!user.emailVerified) { showStatus('Egiaztatu zure posta elektronikoa talde batean sartzeko eskaera bidali aurretik.'); return; }
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
        if (!user || !user.emailVerified) { showStatus('Egiaztatu posta elektronikoa gonbidapena onartu aurretik.'); return; }
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
            if (groupUnsubscribe) groupUnsubscribe();
            groupUnsubscribe = groupRef.onSnapshot(snapshot => {
                if (!snapshot.exists || !activeGroup || activeGroup.id !== groupId) return;
                const newRevision = Number(snapshot.data().revision || 0);
                if (newRevision !== revision && !saving) loadActiveState().catch(error => showStatus(safeError(error)));
            }, error => showStatus('Taldearen sinkronizazioa eten da: ' + safeError(error)));
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
        el('adminRoleTools').hidden = !isSuperAdmin();
        el('allUsersPanel').hidden = !isSuperAdmin();
        try {
            const groups = isSuperAdmin()
                ? (await db.collection('groups').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))
                : (await loadMyGroups()).filter(group => ['owner', 'admin'].includes((group.membership || {}).role));
            if (!groups.length) list.textContent = 'Ez dago kudeatzeko talderik.';
            groups.forEach(group => {
                const row = document.createElement('li'); row.className = 'group-picker-item';
                const label = document.createElement('span'); label.textContent = group.name;
                const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Kudeatu'; open.addEventListener('click', () => openGroup(group.id));
                row.append(label, open); list.append(row);
            });
            if (isSuperAdmin()) {
                const users = await db.collection('users').get();
                const select = el('adminUserSelect'); select.replaceChildren(new Option('Aukeratu erabiltzailea', ''));
                users.forEach(doc => {
                    const profile = doc.data();
                    if (doc.id !== user.uid) select.add(new Option((profile.displayName || profile.email || doc.id) + (profile.email ? ' · ' + profile.email : ''), doc.id));
                });
            }
        } catch (error) { el('adminFeedback').textContent = 'Ezin izan da administrazio-panela kargatu: ' + safeError(error); }
    }
    async function savePlatformRole(event) {
        event.preventDefault();
        if (!isSuperAdmin()) return;
        const uid = el('adminUserSelect').value;
        const role = el('platformRoleSelect').value;
        if (!uid) return;
        try {
            const ref = db.collection('platformRoles').doc(uid);
            if (role === 'none') await ref.delete();
            else await ref.set({ role, grantedBy: user.uid, grantedAt: firebase.firestore.FieldValue.serverTimestamp() });
            el('adminFeedback').textContent = 'Plataforma-rola eguneratuta.';
            await loadAdminPanel();
        } catch (error) { el('adminFeedback').textContent = 'Ezin izan da rola aldatu: ' + safeError(error); }
    }
    function updateAuthFeedback(message) { el('authFeedback').textContent = message || ''; }
    function setRegistrationMode(value) {
        registrationMode = value;
        el('authSubmitBtn').textContent = value ? 'Kontua sortu' : 'Saioa hasi';
        el('authModeBtn').textContent = value ? 'Badut kontua; saioa hasi' : 'Kontu berria sortu';
        el('authPassword').autocomplete = value ? 'new-password' : 'current-password';
        updateAuthFeedback('');
    }
    async function handleAuthSubmit(event) {
        event.preventDefault();
        const email = normalizeEmail(el('authEmail').value);
        const password = el('authPassword').value;
        const button = el('authSubmitBtn'); button.disabled = true;
        try {
            if (registrationMode) {
                const result = await auth.createUserWithEmailAndPassword(email, password);
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
        setGate('groups');
        el('groupsFeedback').textContent = 'Ezin izan dira kontuaren datuak kargatu: ' + safeError(error) + ' Saiatu berriro edo itxi saioa.';
        el('bootstrapHelp').hidden = true;
        el('refreshRoleBtn').hidden = false;
    }
    async function loadProfileAndGate() {
        if (!user) { activeGroup = null; activeMember = null; setGate('authPanel'); el('resendVerificationBtn').hidden = true; el('verifiedContinueBtn').hidden = true; return; }
        el('accountMenuBtn').textContent = user.displayName || user.email || 'Kontua';
        if (verificationRequired(user)) {
            setGate('authPanel');
            el('authTitle').textContent = 'Egiaztatu zure posta elektronikoa';
            updateAuthFeedback('Bidali dizugun estekarekin egiaztatu kontua, eta sakatu “Posta egiaztatu dut”.');
            el('resendVerificationBtn').hidden = false; el('verifiedContinueBtn').hidden = false;
            return;
        }
        el('authTitle').textContent = 'Sartu Kotxean';
        setGate('groups');
        el('groupsFeedback').textContent = 'Kontuaren datuak kargatzen…';
        el('bootstrapHelp').hidden = true;
        el('refreshRoleBtn').hidden = false;
        const profileRef = db.collection('users').doc(user.uid);
        const profile = await profileRef.get();
        if (!profile.exists) {
            await profileRef.set({ uid: user.uid, email: normalizeEmail(user.email), displayName: user.displayName || user.email || 'Erabiltzailea', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        const roleDoc = await db.collection('platformRoles').doc(user.uid).get();
        platformRole = roleDoc.exists ? roleDoc.data().role : null;
        const uidText = user.uid;
        el('bootstrapHelp').hidden = Boolean(platformRole);
        el('refreshRoleBtn').hidden = Boolean(platformRole);
        if (!platformRole) {
            el('bootstrapHelp').textContent = 'Lehen superadministratzailea eskuz sortu behar da Firebase kontsolan: Firestore → platformRoles → ID de documento = ' + uidText + ' → eremua role, string mota, balioa superadmin. Ondoren sakatu “Actualizar permisos”.';
        }
        el('globalAdminNav').hidden = !platformRole;
        await refreshGroupsGate();
    }
    async function signOut() { if (groupUnsubscribe) groupUnsubscribe(); groupUnsubscribe = null; activeGroup = null; activeMember = null; platformRole = null; await auth.signOut(); }
    async function start(options) {
        appStateCallback = options && options.onState;
        statusCallback = options && options.onStatus;
        if (!root.firebase || !root.KOTXEA_FIREBASE_CONFIG) { setGate('authPanel'); updateAuthFeedback('Firebase konfigurazioa ezin izan da kargatu.'); return; }
        if (!firebase.apps.length) firebase.initializeApp(root.KOTXEA_FIREBASE_CONFIG);
        auth = firebase.auth(); db = firebase.firestore();
        try { await db.enablePersistence({ synchronizeTabs: true }); } catch (error) { if (!error || error.code !== 'failed-precondition') console.warn('Firestore offline cache disabled:', error && error.code); }
        auth.onAuthStateChanged(async authUser => {
            user = authUser;
            if (!authUser) { platformRole = null; await loadProfileAndGate(); return; }
            try { await loadProfileAndGate(); }
            catch (error) { showProfileLoadError(error); }
        });

        el('authForm').addEventListener('submit', handleAuthSubmit);
        el('authModeBtn').addEventListener('click', () => setRegistrationMode(!registrationMode));
        el('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
        el('resetPasswordBtn').addEventListener('click', resetPassword);
        el('resendVerificationBtn').addEventListener('click', resendVerification);
        el('verifiedContinueBtn').addEventListener('click', refreshVerifiedUser);
        el('refreshRoleBtn').addEventListener('click', async () => {
            try { await loadProfileAndGate(); }
            catch (error) { showProfileLoadError(error); }
        });
        el('createGroupForm').addEventListener('submit', createGroup);
        el('groupSearchForm').addEventListener('submit', event => { event.preventDefault(); refreshDiscoverableGroups(); });
        el('signOutFromGroupsBtn').addEventListener('click', signOut);
        el('accountMenuBtn').addEventListener('click', refreshGroupsGate);
        el('activeGroupSelect').addEventListener('change', event => openGroup(event.target.value));
        el('changeGroupNav').addEventListener('click', refreshGroupsGate);
        el('globalAdminNav').addEventListener('click', loadAdminPanel);
        el('backToGroupsBtn').addEventListener('click', refreshGroupsGate);
        el('platformRoleForm').addEventListener('submit', savePlatformRole);
        el('adminUserSelect').addEventListener('change', async () => {
            const uid = el('adminUserSelect').value;
            el('platformRoleSelect').value = 'creator';
            if (!uid) return;
            const role = await db.collection('platformRoles').doc(uid).get();
            if (!role.exists || role.data().role !== 'creator') el('platformRoleSelect').value = 'creator';
        });
        el('inviteForm').addEventListener('submit', inviteMember);
        el('saveGroupVisibilityBtn').addEventListener('click', saveDiscoverability);
        root.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; el('installAppBtn').hidden = false; });
        el('installAppBtn').addEventListener('click', async () => {
            if (!deferredInstallPrompt) {
                const isIOS = /iPad|iPhone|iPod/.test(root.navigator.userAgent);
                el('installHelp').textContent = isIOS
                    ? 'iPhone/iPad: toca Compartir y elige “Añadir a pantalla de inicio”.'
                    : /Android/.test(root.navigator.userAgent)
                        ? 'Abre el menú del navegador (⋮) y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.'
                        : 'Usa el menú del navegador o el icono de instalación de la barra de direcciones.';
                el('installHelp').hidden = false;
                return;
            }
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            el('installAppBtn').hidden = true;
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
