/**
 * verify-icons.ts — Verify-gate check for generated components.
 * Fails the build if:
 *   (1) an icon is hand-drawn as an inline <svg>,
 *   (2) a raw icon library is imported (must go through @iconify/react),
 *   (3) any Iconify "prefix:name" does not resolve to a real icon.
 * repairIcons() optionally self-heals (3) by swapping in the closest real match.
 *
 * Uses the Iconify API for validation (zero setup). For a fully offline / deterministic
 * gate, validate against locally installed @iconify-json/<prefix> packages instead
 * (require("@iconify-json/lucide/icons.json") and check name in icons).
 */

import { resolveIcon, type IconStyle } from "./icon-resolver.ts";

const API = "https://api.iconify.design";

const ICON_REF = /icon=["']([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)["']/g;
const RAW_IMPORT = /from\s*["'](@phosphor-icons\/react|lucide-react|@heroicons\/[^"']*|react-icons[^"']*|devicon)["']/;

export interface IconCheck { pass: boolean; failures: string[]; }

export async function checkIcons(code: string): Promise<IconCheck> {
  const failures: string[] = [];

  // (1) no hand-drawn icon SVGs
  const svgs = code.match(/<svg[\s>]/g)?.length ?? 0;
  if (svgs > 0) {
    failures.push(`${svgs} inline <svg> found — render icons via <Icon icon="prefix:name" /> from @iconify/react, never hand-drawn SVG.`);
  }

  // (2) no raw icon-library imports
  if (RAW_IMPORT.test(code)) {
    failures.push(`Raw icon-library import found — every icon must come through @iconify/react.`);
  }

  // (3) every prefix:name must resolve in Iconify
  const byPrefix = new Map<string, Set<string>>();
  for (const m of code.matchAll(ICON_REF)) {
    const [, prefix, name] = m;
    (byPrefix.get(prefix) ?? byPrefix.set(prefix, new Set()).get(prefix)!).add(name);
  }
  for (const [prefix, names] of byPrefix) {
    const r = await fetch(`${API}/${prefix}.json?icons=${[...names].join(",")}`);
    if (!r.ok) { failures.push(`Unknown icon set "${prefix}".`); continue; }
    const data = (await r.json()) as { not_found?: string[] };
    for (const nf of data.not_found ?? []) {
      failures.push(`Icon "${prefix}:${nf}" does not exist in Iconify.`);
    }
  }

  return { pass: failures.length === 0, failures };
}

/** Optional self-heal: replace unresolved names with the closest real match before failing. */
export async function repairIcons(code: string): Promise<string> {
  let out = code;
  for (const m of code.matchAll(ICON_REF)) {
    const [, prefix, name] = m;
    const ref = `${prefix}:${name}`;
    const r = await fetch(`${API}/${prefix}.json?icons=${name}`);
    const found = r.ok && !(((await r.json()).not_found as string[] | undefined) ?? []).includes(name);
    if (found) continue;

    const style: IconStyle =
      prefix === "logos" ? "brand-color"
      : prefix === "simple-icons" ? "brand"
      : prefix === "devicon" ? "tech"
      : prefix.includes("solid") ? "solid"
      : "outline";

    const fix = await resolveIcon(name.replace(/-/g, " "), style);
    if (fix) out = out.replaceAll(`"${ref}"`, `"${fix}"`).replaceAll(`'${ref}'`, `'${fix}'`);
  }
  return out;
}
