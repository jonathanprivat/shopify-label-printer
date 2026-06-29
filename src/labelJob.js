import { renderLabelPdf } from './renderLabel.js';
import { printPdf } from './print.js';
import { log } from './logger.js';

/**
 * Render a normalized label object to PDF and print it.
 * Returns { pdfPath, jobId }. Throws on failure.
 */
export async function renderAndPrint(label, { copies = 1, suffix = '' } = {}) {
  const pdfPath = await renderLabelPdf(label, { suffix });
  const { jobId } = await printPdf(pdfPath, { copies });
  log.info(`Printed ${label.orderName} (job ${jobId || 'n/a'})`);
  return { pdfPath, jobId };
}
