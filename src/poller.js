import { config } from './config.js';
import { log } from './logger.js';
import { findOrdersSince } from './shopify.js';
import { hasPromptedOrder, markOrderPrompted, highWaterOrderId } from './dedupe.js';

/**
 * Reconciliation safety net: periodically fetch recent orders and prompt the
 * owner about any the webhook missed (e.g. Mac was asleep / offline). Dedupe by
 * order id means it never re-prompts an order already handled.
 */
export function startPoller({ onNewOrder } = {}) {
  const secs = config.pollIntervalSeconds;
  if (!secs || secs <= 0) {
    log.info('Reconciliation poller disabled (POLL_INTERVAL_SECONDS=0).');
    return () => {};
  }
  if (!config.shopify.shop || !config.shopify.token) {
    log.warn('Shopify creds missing — poller disabled.');
    return () => {};
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const since = highWaterOrderId();
      const orders = await findOrdersSince(since, 25);
      for (const label of orders) {
        if (hasPromptedOrder(label.orderId)) continue;
        log.info(`Poller found unhandled order ${label.orderName} — prompting.`);
        markOrderPrompted(label.orderId);
        try {
          await onNewOrder?.(label);
        } catch (e) {
          log.error(`Poller prompt failed for ${label.orderName}:`, e.message);
        }
      }
    } catch (e) {
      log.error('Poller tick failed:', e.message);
    } finally {
      running = false;
    }
  }

  log.info(`Reconciliation poller every ${secs}s.`);
  const handle = setInterval(tick, secs * 1000);
  tick();
  return () => clearInterval(handle);
}
