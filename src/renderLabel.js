import path from 'node:path';
import puppeteer from 'puppeteer';
import { config, PDF_DIR } from './config.js';
import { renderLabelHtml } from './labelTemplate.js';
import { log } from './logger.js';

// Reuse one browser across renders for speed. Launched lazily.
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

/**
 * Render a normalized label object to a PDF at exact label dimensions.
 * Returns the absolute path of the written PDF.
 */
export async function renderLabelPdf(label, { suffix = '' } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const html = renderLabelHtml(label);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    // Make sure fonts are ready before snapshotting.
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const safeName = String(label.orderName || 'label').replace(/[^\w.-]+/g, '_');
    const file = path.join(PDF_DIR, `${safeName}${suffix}.pdf`);

    await page.pdf({
      path: file,
      width: `${config.printer.widthMm}mm`,
      height: `${config.printer.heightMm}mm`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true, // honor @page size in the template
    });

    log.info(`Rendered label -> ${file}`);
    return file;
  } finally {
    await page.close();
  }
}
