const path = require('path');

// Icon gate. Rides inside the "no banned APIs/imports" check: a build fails if
// an icon is hand-drawn as an inline <svg>, a raw icon library is imported, or
// an Iconify `prefix:name` doesn't resolve. Existence is validated against the
// locally installed @iconify-json/<prefix> packs so the gate stays offline and
// deterministic; the network is only touched by repairIcons() (self-heal).

// Kept in sync with verify-icons.ts (the reference impl) so the gate and the
// resolver agree on what counts as an icon.
const ICON_REF = /icon=["']([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)["']/g;
const RAW_IMPORT = /from\s*["'](@phosphor-icons\/react|lucide-react|@heroicons\/[^"']*|react-icons[^"']*|devicon)["']/;
const SVG_TAG = /<svg[\s>]/g;

const packCache = new Map();

// null for an unknown prefix (pack not installed); the icon+alias name set otherwise.
function loadPack(prefix) {
  if (packCache.has(prefix)) return packCache.get(prefix);
  let names = null;
  try {
    const pack = require(`@iconify-json/${prefix}/icons.json`);
    names = new Set([...Object.keys(pack.icons || {}), ...Object.keys(pack.aliases || {})]);
  } catch {
    names = null;
  }
  packCache.set(prefix, names);
  return names;
}

function checkIcons(code) {
  const errors = [];

  const svgs = code.match(SVG_TAG)?.length ?? 0;
  if (svgs > 0) {
    errors.push({
      kind: 'lint',
      message: `${svgs} inline <svg> - render icons via <Icon icon="prefix:name" /> from @iconify/react, never a hand-drawn SVG`,
    });
  }

  const rawImport = RAW_IMPORT.test(code);
  if (rawImport) {
    errors.push({
      kind: 'lint',
      message: 'raw icon-library import - every icon must come through @iconify/react',
    });
  }

  const byPrefix = new Map();
  for (const [, prefix, name] of code.matchAll(ICON_REF)) {
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
    byPrefix.get(prefix).add(name);
  }
  let unresolved = 0;
  for (const [prefix, names] of byPrefix) {
    const pack = loadPack(prefix);
    if (!pack) {
      unresolved += names.size;
      errors.push({ kind: 'lint', message: `unknown icon set "${prefix}" - use lucide, heroicons-solid, simple-icons, logos or devicon` });
      continue;
    }
    for (const name of names) {
      if (!pack.has(name)) {
        unresolved += 1;
        errors.push({ kind: 'lint', message: `icon "${prefix}:${name}" does not exist in Iconify` });
      }
    }
  }

  // Only unresolved names are auto-fixable; an inline <svg> or raw import must
  // be regenerated, so don't waste a repair round on those.
  const repairable = unresolved > 0 && svgs === 0 && !rawImport;
  return { ok: errors.length === 0, errors, repairable };
}

let repairFn = null;

// Delegates to verify-icons.ts's repairIcons (the Iconify search API resolver).
// Loaded lazily via dynamic import because it's an ES module; cached so the
// import cost is paid once. Returns the code unchanged on any failure (e.g.
// offline) so the gate falls through to its deterministic verdict.
async function repairIcons(code) {
  try {
    if (!repairFn) {
      const mod = await import(path.resolve(__dirname, '..', '..', '..', 'verify-icons.ts'));
      repairFn = mod.repairIcons;
    }
    return await repairFn(code);
  } catch {
    return code;
  }
}

module.exports = { checkIcons, repairIcons };
