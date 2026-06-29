import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  }
  return v.trim();
}

function optional(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export const config = {
  shopify: {
    shop: optional('SHOPIFY_SHOP', ''),
    token: optional('SHOPIFY_ADMIN_TOKEN', ''),
    apiVersion: optional('SHOPIFY_API_VERSION', '2025-01'),
    webhookSecret: optional('SHOPIFY_WEBHOOK_SECRET', ''),
  },
  telegram: {
    token: optional('TELEGRAM_BOT_TOKEN', ''),
    ownerIds: optional('TELEGRAM_OWNER_IDS', '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  },
  printer: {
    queue: optional('PRINTER_QUEUE', 'Brother_QL_1110NWB'),
    media: optional('PRINTER_MEDIA', 'Custom.103x164mm'),
    // Label dimensions in millimeters (QL-1110NWB 4x6 shipping label = 103x164mm).
    widthMm: Number(optional('LABEL_WIDTH_MM', '103')),
    heightMm: Number(optional('LABEL_HEIGHT_MM', '164')),
  },
  server: {
    port: Number(optional('PORT', '8088')),
    webhookPath: optional('WEBHOOK_PATH', '/webhooks/orders-create'),
    publicBaseUrl: optional('PUBLIC_BASE_URL', ''),
  },
  maxLabels: Math.max(1, Math.min(5, Number(optional('MAX_LABELS', '5')))),
  pollIntervalSeconds: Number(optional('POLL_INTERVAL_SECONDS', '120')),
  dataDir: path.resolve(ROOT, optional('DATA_DIR', './data')),
};

// Ensure data dir + pdf subdir exist
export const PDF_DIR = path.join(config.dataDir, 'pdfs');
fs.mkdirSync(PDF_DIR, { recursive: true });

export { required };
