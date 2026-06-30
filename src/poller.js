import { config } from './config.js';
import { log } from './logger.js';
import { findOrdersSince, findLatestOrder } from './shopify.js';
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
  // If we have no history yet (fresh start / no persisted data), seed the
  // cursor to the latest order so we only prompt for orders that arrive AFTER
  // startup — never blast the existing backlog.
  let seeded = highWaterOrderId() > 0;

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (!seeded) {
        const latest = await findLatestOrder();
        if (latest) {
          markOrderPrompted(latest.orderId);
          log.info(`Poller seeded cursor at ${latest.orderName} — only newer orders will prompt.`);
        }
        seeded = true;
        return;
      }
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
