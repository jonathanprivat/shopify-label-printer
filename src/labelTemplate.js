import { config } from './config.js';

// HTML-escape to keep arbitrary order text from breaking the markup.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the label HTML from a normalized label object (see shopify.js
 * -> orderToLabel). The CSS sets an exact @page size so Puppeteer produces a
 * pixel-accurate label with zero scaling, and a flex column so the content
 * fills the full label height (banner pinned to top, footer pinned to bottom,
 * the order number sitting just above the footer). No external assets are
 * referenced, so the headless-Chrome "url() resources are ignored" gotcha
 * can't bite.
 */
export function renderLabelHtml(label) {
  const w = `${config.printer.widthMm}mm`;
  const h = `${config.printer.heightMm}mm`;

  const addressLines = [label.address1, label.address2]
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');

  const cityLine = [label.city, label.province, label.zip]
    .filter(Boolean)
    .join(', ')
    .replace(`, ${esc(label.zip)}`, ` ${esc(label.zip)}`); // "City, ST 33101"

  const noteLines = String(label.driverNotes || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // Always show the DRIVER NOTES section. When the order has notes, list them;
  // otherwise render an empty box so there's always a spot (and the layout is
  // consistent across labels).
  const notesInner = noteLines.length
    ? noteLines.map((l) => `<div>${esc(l)}</div>`).join('')
    : '<div>&nbsp;</div><div>&nbsp;</div>';
  const notes = `
      <div class="section">
        <div class="rule thin"></div>
        <div class="label-heading">DRIVER NOTES:</div>
        <div class="notes-box">${notesInner}</div>
      </div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${w} ${h}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${w}; height: ${h};
    font-family: Helvetica, Arial, sans-serif;
    color: #000; background: #fff;
    padding: 5mm;
    overflow: hidden; /* never spill onto a 2nd page/label */
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .wrap { display: flex; flex-direction: column; height: 100%; }
  .rule { border-top: 3px solid #000; }
  .rule.thin { border-top: 2px solid #000; }
  .banner {
    font-weight: 800; text-align: center; letter-spacing: 0.3px;
    /* shrink-to-fit width so the banner never clips on the label edges */
    font-size: 9.2mm; line-height: 1.05; padding: 3mm 0;
    white-space: nowrap;
  }
  .deliver-to { font-weight: 800; font-size: 8mm; margin: 4mm 0 3mm; }
  .addr { font-size: 6.2mm; line-height: 1.25; }
  .addr .name { font-weight: 800; text-transform: uppercase; }
  .phone { font-weight: 800; font-size: 6.6mm; margin-top: 4mm; }
  .label-heading { font-weight: 800; font-size: 5.5mm; margin-top: 4mm; }
  .notes-box {
    border: 1.5px dashed #000; border-radius: 4px;
    padding: 3mm; margin-top: 2mm;
    font-size: 4.6mm; font-weight: 700; line-height: 1.3;
  }
  /* spacer pushes the order/footer block to the bottom of the label */
  .spacer { flex: 1 1 auto; min-height: 0; }
  .order .cap { font-weight: 800; font-size: 6mm; }
  .order .big {
    font-weight: 800; line-height: 1; white-space: nowrap;
    font-size: 16mm; letter-spacing: -0.5px;
  }
  .footer {
    display: flex; justify-content: space-between;
    font-size: 3.4mm; padding-top: 2.5mm; margin-top: 3mm;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="rule"></div>
    <div class="banner" id="banner">HANDLE WITH CARE</div>
    <div class="rule"></div>

    <div class="section">
      <div class="deliver-to">DELIVER TO:</div>
      <div class="addr">
        <div class="name">${esc(label.name)}</div>
        ${addressLines}
        ${cityLine ? `<div>${cityLine}</div>` : ''}
      </div>
      ${label.phone ? `<div class="phone">PHONE: ${esc(label.phone)}</div>` : ''}
    </div>

    ${notes}

    <div class="spacer"></div>

    <div class="order" id="order">
      <div class="rule thin"></div>
      <div class="cap" style="margin-top:3mm">ORDER #:</div>
      <div class="big" id="ordernum">${esc(label.orderName)}</div>
      <div class="rule thin" style="margin-top:3mm"></div>
      <div class="footer">
        <div>${esc(label.timestamp)}</div>
        <div>${esc(label.pkg || 'PKG 1 OF 1')}</div>
      </div>
    </div>
  </div>

  <script>
    // Shrink the banner and order number font-size if they would overflow
    // the label width (e.g. very long order names), so nothing ever clips.
    (function () {
      function fit(el, maxFracOfParent) {
        if (!el) return;
        var avail = el.parentElement.clientWidth * (maxFracOfParent || 1);
        var size = parseFloat(getComputedStyle(el).fontSize);
        var guard = 0;
        while (el.scrollWidth > avail && size > 6 && guard++ < 200) {
          size -= 1;
          el.style.fontSize = size + 'px';
        }
      }
      fit(document.getElementById('banner'), 1);
      fit(document.getElementById('ordernum'), 1);
    })();
  </script>
</body>
</html>`;
}
