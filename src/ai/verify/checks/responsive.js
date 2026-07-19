// Track C — responsive gate, static layer. A cheap regex pre-check that catches
// hard pixel widths which can't fit a mobile viewport, without a render. The
// live render check (mount at 360/1024, measure overflow) is the source of truth
// and runs in the browser harness; this just fails the obvious cases fast.

const MOBILE = 360;

// Flag fixed `width`/`min-width` (CSS), `w-[Npx]`/`min-w-[Npx]` (Tailwind), and
// `width`/`minWidth` (JSX style) — but NOT their `max-*` variants. A max-width /
// max-w-[…] is the recommended fluid pattern (it caps but still shrinks below),
// so flagging it would contradict the develop-prompt mandate. The leading
// `(?:^|[^-\w])` guard rejects a `max-`/other-word prefix, skipping max-width.
const CSS_W = /(?:^|[^-\w])(?:width|min-width)\s*:\s*(\d{3,})px/gi;
const TW_W = /(?:^|[^-\w])(?:w|min-w)-\[(\d{3,})px\]/g;
const JSX_W = /(?:^|[^-\w])(?:width|minWidth)\s*:\s*['"]?(\d{3,})px/gi;

function staticResponsiveCheck(code) {
  const failures = [];
  const seen = new Set();
  const scan = (re) => {
    for (const m of code.matchAll(re)) {
      const px = Number(m[1]);
      if (px > MOBILE && !seen.has(px)) {
        seen.add(px);
        failures.push(
          `Fixed width ${px}px exceeds mobile (${MOBILE}px) — use fluid/max-width so it reflows.`
        );
      }
    }
  };
  scan(CSS_W);
  scan(TW_W);
  scan(JSX_W);
  return failures;
}

module.exports = { MOBILE, staticResponsiveCheck };
