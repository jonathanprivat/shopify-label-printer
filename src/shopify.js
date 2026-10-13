import { config } from './config.js';

const NOTE_KEYS = ['gate', 'gate code', 'instructions', 'delivery', 'delivery instructions', 'notes', 'driver'];

// Fields we never want printed on the label (case-insensitive substring match).
const NOTE_DROP = ['location'];

// Shopify notes from delivery apps look like:
//   "------\nDelivery Method : Local Delivery | Delivery Date : June 19 2026 |
//    Delivery Time : 3:00 PM - 4:00 PM | Delivery Location : 101 E Flagler St..."
// Turn that into tidy, one-per-line fields, dropping unwanted ones (location),
// and trimming the redundant "Delivery " prefix. Returns a "\n"-joined string.
function cleanNote(s) {
  let str = String(s || '')
    .replace(/[-=_*]{3,}/g, ' ')   // separator runs -> space
    .replace(/\s*\n\s*/g, ' ')      // newlines -> space
    .replace(/\s{2,}/g, ' ')        // collapse whitespace
    .trim();
  if (!str) return '';

  if (str.includes('|')) {
    const lines = str
      .split('|')
      .map((seg) => seg.trim())
      .filter(Boolean)
      .filter((seg) => !NOTE_DROP.some((d) => seg.toLowerCase().includes(d)))
      .map((seg) =>
        seg
          .replace(/^delivery\s+/i, '')   // "Delivery Date" -> "Date"
          .replace(/\s*:\s*/, ': ')       // normalize "Key : Val" -> "Key: Val"
      );
    return lines.join('\n');
  }
  return str;
}

// Build driver notes from delivery-app attributes (headless storefronts send
// delivery fields as separate attributes): one "Key: value" line each, with
// unwanted fields (location) dropped and the "Delivery " prefix trimmed.
function attrsToNotes(pairs) {
  const lines = [];
  for (const [key, value] of pairs) {
    if (!key || !value) continue;
    const k = String(key).trim();
    if (!NOTE_KEYS.some((n) => k.toLowerCase().includes(n))) continue;
    if (NOTE_DROP.some((d) => k.toLowerCase().includes(d))) continue;
    lines.push(`${k.replace(/^delivery\s+/i, '')}: ${cleanNote(value)}`);
  }
  return lines.join('\n');
}

// Pretty-print phone numbers for the label, e.g. "+1 (818) 900-3050".
// 10 digits -> "(XXX) XXX-XXXX"; 11 digits starting with 1 -> "+1 (XXX) XXX-XXXX".
// Anything else (true international / unusual) is left essentially as-is.
function formatPhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  const us = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
  if (digits.length === 10) return us(digits);
  if (digits.length === 11 && digits.startsWith('1')) return `+1 ${us(digits.slice(1))}`;
  return s.startsWith('+') ? `+${digits}` : s;
}

function adminUrl(pathname) {
  return `https://${config.shopify.shop}/admin/api/${config.shopify.apiVersion}${pathname}`;
}

async function graphql(query, variables = {}) {
  const res = await fetch(adminUrl('/graphql.json'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.shopify.token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    // Scope-limited fields (e.g. customer without read_customers) come back as
    // partial errors alongside usable data — log and continue in that case.
    if (!json.data) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    console.warn('[shopify] partial GraphQL errors (continuing):', JSON.stringify(json.errors.map((e) => e.message)));
  }
  return json.data;
}

const ORDER_FIELDS = `
  id
  name
  note
  sourceName
  customer { displayName firstName lastName phone }
  customAttributes { key value }
  phone
  createdAt
  shippingLine { title code }
  shippingAddress {
    name address1 address2 city province provinceCode zip country phone
  }
`;

// Marketplace channel worth flagging on the label (e.g. "DoorDash").
// Normal storefront sources (web/pos/numeric app ids) return ''.
function channelFromSource(sourceName) {
  const s = String(sourceName || '').trim();
  if (!s || /^\d+$/.test(s)) return '';
  const normal = ['web', 'pos', 'iphone', 'android', 'shopify_draft_order', 'checkout_one', 'subscription_contract'];
  if (normal.includes(s.toLowerCase())) return '';
  return s;
}

function gidToNumber(gid) {
  const m = String(gid).match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

/**
 * Normalize a GraphQL order node into the flat label object the template
 * and renderer expect.
 */
export function gqlOrderToLabel(node, { timestamp } = {}) {
  const a = node.shippingAddress || {};
  const cust = node.customer || {};
  const custName =
    cust.displayName || [cust.firstName, cust.lastName].filter(Boolean).join(' ');
  const attrs = node.customAttributes || [];

  // Delivery-instruction-ish attributes (one tidy line each), else the note.
  let driverNotes = attrsToNotes(attrs.map(({ key, value }) => [key, value]));
  if (!driverNotes && node.note) driverNotes = cleanNote(node.note);

  // Route: look for a "route" custom attribute, else from the shipping method.
  const routeAttr = attrs.find((x) => x.key.toLowerCase() === 'route');
  const route = routeAttr?.value || node.shippingLine?.code || '';

  return {
    orderId: gidToNumber(node.id),
    orderName: node.name, // e.g. "#109348"
    name: a.name || custName || '',
    channel: channelFromSource(node.sourceName),
    address1: a.address1 || '',
    address2: a.address2 || '',
    city: a.city || '',
    province: a.provinceCode || a.province || '',
    zip: a.zip || '',
    country: a.country || '',
    phone: formatPhone(a.phone || node.phone || node.customer?.phone || ''),
    driverNotes,
    route,
    pkg: 'PKG 1 OF 1',
    timestamp: timestamp || formatStamp(node.createdAt),
  };
}

function formatStamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Normalize a REST/webhook order payload (snake_case) into the label object.
 * Used by the webhook path so we don't need an extra API round-trip.
 */
export function webhookOrderToLabel(order) {
  const a = order.shipping_address || {};
  const cust = order.customer || {};
  const custName =
    [cust.first_name, cust.last_name].filter(Boolean).join(' ') || cust.default_address?.name || '';
  const attrs = order.note_attributes || [];

  let driverNotes = attrsToNotes(attrs.map(({ name, value }) => [name, value]));
  if (!driverNotes && order.note) driverNotes = cleanNote(order.note);

  const routeAttr = attrs.find((x) => String(x.name).toLowerCase() === 'route');
  const route = routeAttr?.value || order.shipping_lines?.[0]?.code || '';

  return {
    orderId: order.id,
    orderName: order.name, // "#109348"
    name: a.name || [a.first_name, a.last_name].filter(Boolean).join(' ') || custName,
    channel: channelFromSource(order.source_name),
    address1: a.address1 || '',
    address2: a.address2 || '',
    city: a.city || '',
    province: a.province_code || a.province || '',
    zip: a.zip || '',
    country: a.country || '',
    phone: formatPhone(a.phone || order.phone || order.customer?.phone || ''),
    driverNotes,
    route,
    pkg: 'PKG 1 OF 1',
    timestamp: formatStamp(order.created_at),
  };
}

/** Look up a single order by its name/number, e.g. "109348" or "#109348". */
export async function findOrderByName(rawName) {
  const name = String(rawName).replace(/^#/, '');
  const data = await graphql(
    `query($q: String!) {
       orders(first: 1, query: $q) { edges { node { ${ORDER_FIELDS} } } }
     }`,
    { q: `name:#${name}` }
  );
  const node = data.orders.edges[0]?.node;
  return node ? gqlOrderToLabel(node) : null;
}

/** Look up a single order by numeric id (used by Telegram button callbacks). */
export async function findOrderById(numericId) {
  const data = await graphql(
    `query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
    { id: `gid://shopify/Order/${String(numericId).replace(/\D/g, '')}` }
  );
  return data.order ? gqlOrderToLabel(data.order) : null;
}

/** Most recent order (for /last). */
export async function findLatestOrder() {
  const data = await graphql(
    `query {
       orders(first: 1, sortKey: CREATED_AT, reverse: true) {
         edges { node { ${ORDER_FIELDS} } }
       }
     }`
  );
  const node = data.orders.edges[0]?.node;
  return node ? gqlOrderToLabel(node) : null;
}

/** Recent N orders (for inline-button pickers). */
export async function findRecentOrders(n = 5) {
  const data = await graphql(
    `query($n: Int!) {
       orders(first: $n, sortKey: CREATED_AT, reverse: true) {
         edges { node { ${ORDER_FIELDS} } }
       }
     }`,
    { n }
  );
  return data.orders.edges.map((e) => gqlOrderToLabel(e.node));
}

/** Orders created after a given numeric id — for the reconciliation poller. */
export async function findOrdersSince(sinceId, n = 25) {
  // Shopify search supports id range; fetch recent and filter client-side
  // to keep it simple and robust across API versions.
  const recent = await findRecentOrders(n);
  return recent
    .filter((o) => Number(o.orderId) > Number(sinceId))
    .sort((a, b) => Number(a.orderId) - Number(b.orderId));
}
