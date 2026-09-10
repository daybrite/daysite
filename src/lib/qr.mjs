// The QR code of the site's landing page (Layout.astro's toolbar icon and its full-screen
// overlay, served from src/pages/qr.svg.ts). The encoding is qrcode-generator's — the
// zero-dependency reference implementation most QR packages wrap — at error-correction level
// M; this module only draws the SVG: black modules on white with the four-module quiet zone
// the spec asks for, one path in module units so it scales crisply to a toolbar icon or a
// phone-filling overlay, and a title as its accessible name. Plain JS so the node test runner
// (scripts/qr.test.mjs) imports it beside the Astro endpoint.
import qrcode from 'qrcode-generator';

/** The code for `text` as a module grid: `{ size, isDark(row, col) }`. */
export function encode(text) {
  const qr = qrcode(0, 'M');
  // Byte mode takes each char code as a byte, so hand it the UTF-8 bytes as a byte string: a
  // URL from `new URL()` is ASCII anyway, and anything else reads back as the text it was.
  qr.addData(String.fromCharCode(...new TextEncoder().encode(text)), 'Byte');
  qr.make();
  return { size: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

const escapeXML = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * An SVG of the code for `text`, with `title` as its accessible name. `quiet` is the margin in
 * modules (the spec's four for a code that will be scanned; zero when the page pads it
 * itself), `color` the modules' fill (`currentColor` for a code that follows the page's
 * theme), and `background` the plate's, or `none` for no plate at all.
 */
export function svg(text, title = '', { quiet = 4, color = '#000', background = '#fff' } = {}) {
  const { size, isDark } = encode(text);
  const total = size + quiet * 2;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!isDark(y, x)) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && isDark(y, x + run)) run++;
      d += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img"` +
    (title ? ` aria-label="${escapeXML(title)}"` : ' aria-hidden="true"') +
    `>` +
    (title ? `<title>${escapeXML(title)}</title>` : '') +
    (background === 'none' ? '' : `<rect width="${total}" height="${total}" fill="${escapeXML(background)}"/>`) +
    `<path d="${d}" fill="${escapeXML(color)}"/></svg>\n`
  );
}
