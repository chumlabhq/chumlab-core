const fs = require('fs');
const path = require('path');

// @chumlab/ui is unpublished (stealth), so the gates read its package.json
// exports and bundled .d.ts straight from a local checkout - the sibling
// repo by default, CHUMLAB_UI_DIR on deploys with a different layout.
const DEFAULT_UI_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'chumlab-fe');

let cached = null;

function loadUiPackage() {
  const dir = process.env.CHUMLAB_UI_DIR || DEFAULT_UI_DIR;
  if (cached && cached.dir === dir) return cached;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const subpaths = {};
    for (const [key, value] of Object.entries(pkg.exports || {})) {
      if (!key.startsWith('./')) continue;
      const types = typeof value === 'object' && value.types ? path.join(dir, value.types) : null;
      subpaths[key.slice(2)] = types;
    }
    const rootTypes = pkg.types ? path.join(dir, pkg.types) : null;
    cached = { dir, subpaths, rootTypes };
    return cached;
  } catch {
    return null;
  }
}

module.exports = { loadUiPackage };
