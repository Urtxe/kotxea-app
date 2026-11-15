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
fs.copyFileSync(
    path.join(root, 'assets', 'kotxea-icon.svg'),
    path.join(publicDir, 'assets', 'kotxea-icon.svg')
);
