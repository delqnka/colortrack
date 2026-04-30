#!/usr/bin/env node
/**
 * Metro resolves "react-native" before "main" and points at src/index.tsx.
 * Incomplete npm installs sometimes omit `src/`. Removing those fields forces
 * resolution to main -> lib/commonjs/index.js (always present in the tarball).
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'node_modules', 'react-native-safe-area-context', 'package.json');
if (!fs.existsSync(pkgPath)) {
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
let changed = false;
if ('react-native' in pkg) {
  delete pkg['react-native'];
  changed = true;
}
if ('source' in pkg) {
  delete pkg.source;
  changed = true;
}
if (changed) {
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log('[ColorTrack] patched react-native-safe-area-context to use main (lib/commonjs) for Metro');
}
