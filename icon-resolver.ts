/**
 * icon-resolver.ts
 * Turns a concept or a label read from a screenshot ("search", "filled bell", "google")
 * plus a style into a real Iconify "prefix:name". Wraps the Iconify search API.
 * Used for (a) matching icons seen in an uploaded screenshot and (b) repairing an
 * unresolved name the verify gate flagged. It NEVER draws or traces an SVG.
 */

const API = "https://api.iconify.design";

export type IconStyle = "outline" | "solid" | "brand" | "brand-color" | "tech";

// Which Iconify collections to search for each style/role.
const PREFIXES: Record<IconStyle, string[]> = {
  outline:       ["lucide"],            // default / at-rest UI
  solid:         ["heroicons-solid"],   // active / status / emphasis / ≤16px
  brand:         ["simple-icons"],      // monochrome brand marks
  "brand-color": ["logos"],             // multicolor brand logos (OAuth, brand chips)
  tech:          ["devicon", "logos"],  // developer-tool / product logos, colored
};

// Brand marks that MUST be exact for correctness (OAuth / brand guidelines) —
// search ranking can't be trusted for these, so pin them.
const EXACT: Record<string, string> = {
  google: "logos:google-icon",      // multicolor G — required for Google sign-in
  github: "logos:github-icon",
  apple: "logos:apple",
  microsoft: "logos:microsoft-icon",
  facebook: "logos:facebook",
  x: "logos:x",
  twitter: "logos:twitter-icon",
  discord: "logos:discord-icon",
  gitlab: "logos:gitlab",
  slack: "logos:slack-icon",
  linkedin: "logos:linkedin-icon",
};

/** Top matches for a concept, as real Iconify ids ("prefix:name"). */
export async function searchIcons(
  concept: string,
  style: IconStyle = "outline",
  limit = 8,
): Promise<string[]> {
  const key = concept.trim().toLowerCase();
  if ((style === "brand" || style === "brand-color" || style === "tech") && EXACT[key]) {
    return [EXACT[key]];
  }
  const prefixes = PREFIXES[style].join(",");
  const url = `${API}/search?query=${encodeURIComponent(concept)}&prefixes=${prefixes}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { icons?: string[] };
  return data.icons ?? [];
}

/** Single best match for a concept+style, or null if nothing resolves. */
export async function resolveIcon(concept: string, style: IconStyle = "outline"): Promise<string | null> {
  return (await searchIcons(concept, style, 1))[0] ?? null;
}
