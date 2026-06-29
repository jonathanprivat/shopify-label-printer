// Simple JSON-file-backed idempotency store.
// Records which Shopify order ids we have already auto-printed, and which
// webhook delivery ids we have already seen, so retries / reconciliation
// never double-print. Re-prints from Telegram bypass this on purpose.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = path.join(config.dataDir, 'dedupe.json');

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { printedOrderIds: {}, seenWebhookIds: {}, promptedOrderIds: {}, ...s };
  } catch {
    return { printedOrderIds: {}, seenWebhookIds: {}, promptedOrderIds: {} };
  }
}

let state = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function hasSeenWebhook(webhookId) {
  if (!webhookId) return false;
  return Boolean(state.seenWebhookIds[webhookId]);
}

export function markWebhookSeen(webhookId) {
  if (!webhookId) return;
  state.seenWebhookIds[webhookId] = Date.now();
  save();
}

export function hasPrintedOrder(orderId) {
  return Boolean(state.printedOrderIds[String(orderId)]);
}

export function markOrderPrinted(orderId) {
  state.printedOrderIds[String(orderId)] = Date.now();
  save();
}

// Track which orders we've already prompted the owner about (so neither a
// duplicate webhook nor the reconciliation poller asks twice).
export function hasPromptedOrder(orderId) {
  return Boolean(state.promptedOrderIds[String(orderId)]);
}

export function markOrderPrompted(orderId) {
  state.promptedOrderIds[String(orderId)] = Date.now();
  save();
}

// Largest order id we've already prompted or printed — the poller's cursor.
export function highWaterOrderId() {
  const ids = [
    ...Object.keys(state.printedOrderIds),
    ...Object.keys(state.promptedOrderIds),
  ]
    .map(Number)
    .filter(Number.isFinite);
  return ids.length ? Math.max(...ids) : 0;
}
