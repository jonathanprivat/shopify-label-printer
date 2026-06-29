import express from 'express';
import crypto from 'node:crypto';
import { config } from './config.js';
import { log } from './logger.js';
import { webhookOrderToLabel } from './shopify.js';
import {
  hasSeenWebhook, markWebhookSeen, hasPromptedOrder, markOrderPrompted,
} from './dedupe.js';

function verifyHmac(rawBody, headerHmac) {
  if (!config.shopify.webhookSecret || !headerHmac) return false;
  const digest = crypto
    .createHmac('sha256', config.shopify.webhookSecret)
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, 'base64'),
      Buffer.from(headerHmac, 'base64')
    );
  } catch {
    return false;
  }
}

// Background processor: instead of printing, ask the owner (via Telegram)
// whether to print and how many labels. Dedupe by order id so a duplicate
// webhook never double-prompts.
async function processOrder(order, { onNewOrder } = {}) {
  if (hasPromptedOrder(order.id)) {
    log.info(`Order ${order.name} already prompted — skipping.`);
    return;
  }
  const label = webhookOrderToLabel(order);
  markOrderPrompted(order.id);
  try {
    await onNewOrder?.(label);
  } catch (e) {
    log.error(`Failed to prompt for ${label.orderName}:`, e.message);
  }
}

/**
 * Build the Express app. `onNewOrder(label)` is called for each new order so
 * the Telegram bot can ask the owner whether/how-many to print.
 */
export function createWebhookServer({ onNewOrder } = {}) {
  const app = express();

  app.get('/healthz', (_req, res) => res.send('ok'));

  app.post(
    config.server.webhookPath,
    express.raw({ type: '*/*' }), // RAW body is required for HMAC
    (req, res) => {
      const hmac = req.headers['x-shopify-hmac-sha256'];
      if (!verifyHmac(req.body, hmac)) {
        log.warn('Rejected webhook: HMAC validation failed');
        return res.status(401).send('HMAC validation failed');
      }

      // ACK immediately (Shopify's timeout is ~5s), then process async.
      res.status(200).send('ok');

      const webhookId = req.headers['x-shopify-webhook-id'];
      if (hasSeenWebhook(webhookId)) {
        log.info(`Duplicate webhook ${webhookId} — ignoring.`);
        return;
      }
      markWebhookSeen(webhookId);

      let order;
      try {
        order = JSON.parse(req.body.toString('utf8'));
      } catch (e) {
        log.error('Could not parse webhook body:', e.message);
        return;
      }
      processOrder(order, { onNewOrder }).catch((e) =>
        log.error('processOrder crashed:', e.message)
      );
    }
  );

  return app;
}

export { processOrder };
