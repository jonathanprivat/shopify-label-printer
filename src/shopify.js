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
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const ORDER_FIELDS = `
  id
  name
  note
  customAttributes { key value }
  phone
  createdAt
  shippingLine { title code }
  customer { phone }
  shippingAddress {
    name address1 address2 city province provinceCode zip country phone
  }
`;

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
  const attrs = node.customAttributes || [];

  // Find a delivery-instruction-ish attribute, else fall back to the order note.
  let driverNotes = '';
  const parts = [];
  for (const { key, value } of attrs) {
    if (!value) continue;
    if (NOTE_KEYS.some((k) => key.toLowerCase().includes(k))) {
      parts.push(`${key}: ${value}`);
    }
  }
  driverNotes = cleanNote(parts.join('. '));
  if (!driverNotes && node.note) driverNotes = cleanNote(node.note);

  // Route: look for a "route" custom attribute, else from the shipping method.
  const routeAttr = attrs.find((x) => x.key.toLowerCase() === 'route');
  const route = routeAttr?.value || node.shippingLine?.code || '';

  return {
    orderId: gidToNumber(node.id),
    orderName: node.name, // e.g. "#109348"
    name: a.name || '',
    address1: a.address1 || '',
    address2: a.address2 || '',
    city: a.city || '',
    province: a.provinceCode || a.province || '',
    zip: a.zip || '',
    country: a.country || '',
    phone: a.phone || node.phone || node.customer?.phone || '',
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
  const attrs = order.note_attributes || [];

  let driverNotes = '';
  const parts = [];
  for (const { name, value } of attrs) {
    if (!value) continue;
    if (NOTE_KEYS.some((k) => String(name).toLowerCase().includes(k))) {
      parts.push(`${name}: ${value}`);
    }
  }
  driverNotes = cleanNote(parts.join('. '));
  if (!driverNotes && order.note) driverNotes = cleanNote(order.note);

  const routeAttr = attrs.find((x) => String(x.name).toLowerCase() === 'route');
  const route = routeAttr?.value || order.shipping_lines?.[0]?.code || '';

  return {
    orderId: order.id,
    orderName: order.name, // "#109348"
    name: a.name || [a.first_name, a.last_name].filter(Boolean).join(' '),
    address1: a.address1 || '',
    address2: a.address2 || '',
    city: a.city || '',
    province: a.province_code || a.province || '',
    zip: a.zip || '',
    country: a.country || '',
    phone: a.phone || order.phone || order.customer?.phone || '',
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
