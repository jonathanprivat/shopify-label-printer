// Registers (or re-registers) the orders/create webhook pointing at your
// Cloudflare Tunnel URL, via the Shopify Admin GraphQL API.
// Usage: npm run register-webhook
import { config } from '../config.js';

if (!config.shopify.shop || !config.shopify.token) {
  console.error('Set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN in .env first.');
  process.exit(1);
}
if (!config.server.publicBaseUrl) {
  console.error('Set PUBLIC_BASE_URL (your Cloudflare Tunnel URL) in .env first.');
  process.exit(1);
}

const callbackUrl = `${config.server.publicBaseUrl}${config.server.webhookPath}`;
const url = `https://${config.shopify.shop}/admin/api/${config.shopify.apiVersion}/graphql.json`;

async function gql(query, variables) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.shopify.token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// List existing subscriptions so we don't create duplicates.
const existing = await gql(`{
  webhookSubscriptions(first: 50, topics: ORDERS_CREATE) {
    edges { node { id endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } }
  }
}`);

const already = existing.webhookSubscriptions.edges.find(
  (e) => e.node.endpoint?.callbackUrl === callbackUrl
);
if (already) {
  console.log('Webhook already registered for', callbackUrl);
  process.exit(0);
}

const data = await gql(
  `mutation($url: URL!) {
     webhookSubscriptionCreate(
       topic: ORDERS_CREATE,
       webhookSubscription: { callbackUrl: $url, format: JSON }
     ) {
       webhookSubscription { id }
       userErrors { field message }
     }
   }`,
  { url: callbackUrl }
);

const r = data.webhookSubscriptionCreate;
if (r.userErrors.length) {
  console.error('Failed:', r.userErrors);
  process.exit(1);
}
console.log('Registered orders/create webhook ->', callbackUrl);
console.log('Subscription id:', r.webhookSubscription.id);
