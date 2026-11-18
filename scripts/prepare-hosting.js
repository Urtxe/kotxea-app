const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const files = [
    'index.html', 'script.js', 'cloud.js', 'firebase-config.js',
    'styles.css', 'manifest.json', 'service-worker.js'
];

fs.mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
for (const file of files) {
    fs.copyFileSync(path.join(root, file), path.join(publicDir, file));
}
for (const icon of ['kotxea-icon-192.png', 'kotxea-icon-512.png']) {
    fs.copyFileSync(
        path.join(root, 'assets', icon),
        path.join(publicDir, 'assets', icon)
    );
}
