import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import { log } from './logger.js';

const pexec = promisify(execFile);

// List CUPS queue names (one per line). Used by the list-printers CLI and
// to validate the configured queue exists at startup.
export async function listPrinters() {
  try {
    const { stdout } = await pexec('lpstat', ['-e']);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    log.warn('Could not run lpstat -e:', e.message);
    return [];
  }
}

async function printerEnabled(queue) {
  try {
    const { stdout } = await pexec('lpstat', ['-p', queue]);
    return /enabled/i.test(stdout);
  } catch {
    return false;
  }
}

// Try to re-enable a queue CUPS auto-disabled after a backend error.
async function tryEnable(queue) {
  for (const bin of ['/usr/sbin/cupsenable', 'cupsenable', '/usr/bin/enable']) {
    try {
      await pexec(bin, [queue]);
      log.info(`Re-enabled queue ${queue}`);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function parseJobId(stdout) {
  // lp prints: "request id is Brother_QL_1110NWB-42 (1 file(s))"
  const m = stdout.match(/request id is\s+(\S+)/i);
  return m ? m[1] : null;
}

async function jobInList(flag, jobId) {
  try {
    const { stdout } = await pexec('lpstat', ['-W', flag, '-o', config.printer.queue]);
    return stdout.includes(jobId);
  } catch {
    return false;
  }
}

/**
 * Print a PDF to the configured queue and wait until it leaves the active
 * queue. Resolves { jobId } on success, throws on failure.
 *
 * Note: `lp` exit code 0 only means "accepted/queued", so we poll lpstat to
 * confirm the job actually completed.
 */
export async function printPdf(pdfPath, { copies = 1, timeoutMs = 60000 } = {}) {
  const queue = config.printer.queue;
  if (!queue) throw new Error('PRINTER_QUEUE is not set (run `npm run list-printers`)');

  if (!(await printerEnabled(queue))) {
    log.warn(`Queue ${queue} is not enabled — attempting to enable.`);
    await tryEnable(queue);
  }

  const args = [
    '-d', queue,
    // Only pass media if explicitly configured. On macOS/AirPrint the queue's
    // own default media is correct and a Custom.* name can be rejected.
    ...(config.printer.media ? ['-o', `media=${config.printer.media}`] : []),
    '-n', String(copies),
    pdfPath,
  ];

  const { stdout } = await pexec('lp', args);
  const jobId = parseJobId(stdout);
  log.info(`Submitted print job: ${jobId || '(id not parsed)'} for ${pdfPath}`);
  if (!jobId) return { jobId: null }; // submitted but couldn't parse; assume ok

  // Poll until the job is no longer "not-completed".
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stillPending = await jobInList('not-completed', jobId);
    if (!stillPending) {
      // Confirm queue didn't get disabled by a failure.
      if (!(await printerEnabled(queue))) {
        await tryEnable(queue);
        throw new Error(`Print job ${jobId} left queue but ${queue} is disabled (likely a printer error). Check the printer / paper.`);
      }
      log.info(`Print job ${jobId} completed.`);
      return { jobId };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Print job ${jobId} did not complete within ${timeoutMs}ms`);
}
