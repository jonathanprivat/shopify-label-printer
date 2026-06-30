import { renderLabelPdf } from './renderLabel.js';
import { printPdf } from './print.js';
import { log } from './logger.js';

/**
 * Render and print one label PER package, stamped "PKG i OF n" so a 2-package
 * order prints "PKG 1 OF 2" then "PKG 2 OF 2" (not two identical copies).
 * Returns { pdfPath } of the first label (for the Telegram confirmation) plus
 * the full list of jobs.
 */
export async function renderAndPrint(label, { copies = 1, suffix = '' } = {}) {
  const n = Math.max(1, Number(copies) || 1);
  const jobs = [];
  for (let i = 1; i <= n; i++) {
    const perPkg = { ...label, pkg: `PKG ${i} OF ${n}` };
    const pdfPath = await renderLabelPdf(perPkg, { suffix: `${suffix}_${i}of${n}` });
    const { jobId } = await printPdf(pdfPath, { copies: 1 });
    log.info(`Printed ${label.orderName} — PKG ${i} OF ${n} (job ${jobId || 'n/a'})`);
    jobs.push({ pdfPath, jobId });
  }
  return { pdfPath: jobs[0].pdfPath, jobId: jobs[0].jobId, jobs };
}
