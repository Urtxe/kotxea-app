'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

exports.listAuthUsers = onCall({ region: 'us-central1', maxInstances: 2 }, async request => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const db = getFirestore();
    const role = await db.collection('platformRoles').doc(uid).get();
    if (!role.exists || role.data().role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Solo el superadministrador puede consultar las cuentas.');
    }

    // Kotxea is a small private app, so the complete account list fits one callable response.
    // Add page tokens to the API and dashboard before this grows beyond callable response limits.
    const authUsers = [];
    let pageToken;
    do {
        const page = await getAuth().listUsers(1000, pageToken);
        authUsers.push(...page.users);
        pageToken = page.pageToken;
    } while (pageToken);

    const users = [];
    for (let offset = 0; offset < authUsers.length; offset += 100) {
        const page = authUsers.slice(offset, offset + 100);
        const roles = await db.getAll(...page.map(user => db.collection('platformRoles').doc(user.uid)));
        page.forEach((user, index) => users.push({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || '',
            emailVerified: user.emailVerified,
            disabled: user.disabled,
            createdAt: user.metadata.creationTime || '',
            lastSignInAt: user.metadata.lastSignInTime || '',
            platformRole: roles[index].exists ? roles[index].data().role : '',
            canParticipate: roles[index].exists && roles[index].data().canParticipate === true
        }));
    }

    return { users };
});
