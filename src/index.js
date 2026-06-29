import { config } from './config.js';
import { log } from './logger.js';
import { createWebhookServer } from './webhookServer.js';
import { createBot } from './telegramBot.js';
import { startPoller } from './poller.js';
import { listPrinters } from './print.js';
import { closeBrowser } from './renderLabel.js';

async function main() {
  log.info('Starting Shopify label auto-print service…');

  // Sanity-check the printer queue.
  const printers = await listPrinters();
  if (config.printer.queue && !printers.includes(config.printer.queue)) {
    log.warn(
      `Configured PRINTER_QUEUE "${config.printer.queue}" not found. ` +
        `Available: ${printers.join(', ') || '(none)'}. ` +
        `Run "npm run list-printers".`
    );
  } else if (config.printer.queue) {
    log.info(`Using printer queue: ${config.printer.queue}`);
  }

  // Telegram bot (long polling). Exposes promptNewOrder() used by webhook +
  // poller to ASK the owner whether/how-many to print (no auto-printing).
  const tg = createBot();
  let onNewOrder = null;
  if (tg) {
    onNewOrder = tg.promptNewOrder;
    tg.bot.start({
      onStart: (info) => log.info(`Telegram bot @${info.username} polling.`),
    });
  } else {
    log.warn('Bot disabled — orders will be logged but not printed (no prompt target).');
    onNewOrder = (label) => log.info(`New order ${label.orderName} (no bot to prompt).`);
  }

  // Webhook server (Cloudflare Tunnel points at this local port).
  const app = createWebhookServer({ onNewOrder });
  const server = app.listen(config.server.port, () => {
    log.info(`Webhook server on :${config.server.port}${config.server.webhookPath}`);
    if (config.server.publicBaseUrl) {
      log.info(`Public webhook URL: ${config.server.publicBaseUrl}${config.server.webhookPath}`);
    }
  });

  // Reconciliation poller (missed-webhook safety net).
  const stopPoller = startPoller({ onNewOrder });

  // Graceful shutdown.
  async function shutdown(sig) {
    log.info(`${sig} received — shutting down.`);
    stopPoller();
    server.close();
    if (tg) await tg.bot.stop();
    await closeBrowser();
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error('Fatal startup error:', e.message);
  process.exit(1);
});
