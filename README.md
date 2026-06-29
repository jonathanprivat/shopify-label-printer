# Shopify → Brother Label Auto-Print (macOS)

When a Shopify order comes in, the Telegram bot (**@SSMLABEL_bot**) asks you
whether to print and **how many labels (1–5)**. You tap a number, it prints, and
sends you the PDF. If a label jams, tap **🔁 Reprint** — or use `/reprint 1069`,
`/last`, `/recent` anytime.

```
Shopify ──orders/create webhook──► Cloudflare Tunnel ──► this app on your Mac
                                                          ├─ verify HMAC, ACK in <5s
                                                          ├─ dedupe by order id
                                                          └─ ask owner via Telegram ▼
Telegram (your phone)  ◄── long polling ──►  this app
   "🆕 New order #1069 … Print? [1][2][3][4][5] [Not now]"
        └─ you tap a number ─► render label.pdf (HTML→Puppeteer) ─► lp (CUPS/AirPrint)
        └─ confirmation PDF + [🔁 Reprint] button
```

Nothing prints without your tap. A reconciliation poller also re-checks recent
orders every couple of minutes and prompts you for any the webhook missed (e.g.
the Mac was asleep).

---

## What's in here

| File | Purpose |
|---|---|
| `src/index.js` | Entry point — starts webhook server, Telegram bot, poller |
| `src/labelTemplate.js` | The 4×6 label HTML/CSS (matches your design) |
| `src/renderLabel.js` | Renders the template to an exact-size PDF (Puppeteer) |
| `src/print.js` | Prints via `lp`, confirms the job actually completed |
| `src/shopify.js` | Admin API lookups + maps order data → label fields |
| `src/webhookServer.js` | Express endpoint, HMAC verification, dedupe |
| `src/telegramBot.js` | grammY bot, owner whitelist, reprint commands |
| `src/poller.js` | Missed-webhook safety net |
| `src/cli/*` | Helper scripts (list printers, test render/print, register webhook) |
| `ecosystem.config.cjs` | pm2 config (auto-start, crash restart, `caffeinate`) |

---

## Prerequisites

- **Node.js 20+** — `brew install node`
- **Brother QL-1110NWB** at `192.168.1.150` (already on your network, AirPrint).
  Its 4×6 shipping label reports as **103 × 164 mm** — the defaults already match
  this, so no scaling. Give the printer a **static IP / DHCP reservation** for
  `192.168.1.150` so the queue URI never changes.
- **A domain on Cloudflare** (free) for the tunnel, or use `cloudflared`'s quick
  tunnels for testing.

---

## Setup

### 1. Install
```bash
cd label-printer
npm install
cp .env.example .env
```
`npm install` downloads a bundled Chromium for Puppeteer (~one-time, a few hundred MB).

### 2. Find your printer queue
```bash
npm run list-printers
```
Copy the exact queue name into `.env` → `PRINTER_QUEUE`. Then check its media options:
```bash
lpoptions -p YOUR_QUEUE -l
```
If you see a named 4×6 size, set `PRINTER_MEDIA` to it; otherwise leave `Custom.4x6in`.

### 3. Shopify custom app (for re-print lookups + optional webhook registration)
1. Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. **Configure Admin API scopes** → enable **`read_orders`**.
3. **Install app**, then copy the **Admin API access token** (`shpat_…`) into
   `.env` → `SHOPIFY_ADMIN_TOKEN`. Set `SHOPIFY_SHOP` to `your-store.myshopify.com`.

### 4. Telegram bot  ✅ already wired
The token for **@SSMLABEL_bot** is already in `.env`. To become the owner, just
open Telegram, message **@SSMLABEL_bot**, and send **/start** — the first person
to do so is claimed as the owner (saved to `data/owners.json`). Everyone else is
ignored. (You can also pin owner IDs explicitly via `TELEGRAM_OWNER_IDS`.)

(Optional) set the command menu in **@BotFather** → `/setcommands`:
```
reprint - Re-print a label by order number
last - Print/reprint the most recent order
recent - Pick from the last 5 orders
whoami - Show my Telegram ID
```

### 5. Cloudflare Tunnel (so Shopify can reach your Mac)
```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create shopify-labels
# Route a hostname to the tunnel (uses your Cloudflare-managed domain):
cloudflared tunnel route dns shopify-labels labels.yourdomain.com
```
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: shopify-labels
credentials-file: /Users/YOU/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: labels.yourdomain.com
    service: http://localhost:8088
  - service: http_status:404
```
Run it (and later make it a launchd service): `cloudflared tunnel run shopify-labels`.

Put the public URL in `.env` → `PUBLIC_BASE_URL=https://labels.yourdomain.com`.

> **Quick test without a domain:** `cloudflared tunnel --url http://localhost:8088`
> prints a temporary `*.trycloudflare.com` URL you can use as `PUBLIC_BASE_URL`.

### 6. Register the webhook
Either run the helper:
```bash
npm run register-webhook
```
…**or** do it in the Shopify admin: **Settings → Notifications → Webhooks →
Create webhook**, event **Order creation**, format **JSON**, URL
`https://labels.yourdomain.com/webhooks/orders-create`. If you create it in the
admin, copy the signing secret it shows into `.env` → `SHOPIFY_WEBHOOK_SECRET`.
(If you registered via the API/custom app, use the app's **API secret key** as
`SHOPIFY_WEBHOOK_SECRET`.)

---

## Test it

```bash
npm run test-render     # makes data/pdfs/#109348_sample.pdf — open & eyeball it
npm run test-print      # renders AND prints the sample to your Brother
```
Adjust font sizes / spacing in `src/labelTemplate.js` until it sits right on your
label stock, re-running `test-render` to preview.

---

## Run it

Foreground (for first run / debugging):
```bash
npm start
```
Then place a test order (or use the Telegram bot). You should see the label print
and, if the bot is configured, a Telegram confirmation.

### Keep it running 24/7 (pm2 + launchd)
```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup launchd -u $USER --hp $HOME   # then run the command it prints
pm2 logs label-printer                    # watch output
```
This auto-starts on boot/login, restarts on crash, and wraps the process in
`caffeinate -i` so idle sleep won't stall printing. Do the same for the tunnel
(`cloudflared service install`), or run `cloudflared` under pm2 too.

For a Mac that should never sleep at all:
```bash
sudo pmset -c sleep 0 disablesleep 1
```

---

## Using the bot

- **New order** → you get a message: *"🆕 New order #1069 … Print the label now?
  Choose how many packages:"* with buttons **1 2 3 4 5**, plus **📄 Download PDF**
  and **✖ Not now**. Tap a number to print that many labels; you then get the PDF
  back with a **🔁 Reprint** button. **📄 Download PDF** sends you the label without
  printing (with print buttons attached if you change your mind).
- `/reprint 1069` — look up that order and choose how many to re-print.
- `/last` — most recent order, choose quantity.
- `/recent` — pick from the last 5 orders, then choose quantity.
- `/whoami` — shows your Telegram ID.

Only the owner (claimed via `/start`, or listed in `TELEGRAM_OWNER_IDS`) can use
it. Max labels per order is capped by `MAX_LABELS` (default 5).

---

## Customizing the label

Everything visual is in `src/labelTemplate.js`. The field mapping (where gate codes,
route, phone come from) is in `src/shopify.js`:

- **Gate code / instructions** → pulled from order `note_attributes` whose name
  contains gate/instructions/delivery/notes, falling back to the order `note`.
- **Route** → a `route` order attribute if present, else the shipping method code.
  In Shopify you can add an order attribute named `Route` with value like `A-12`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `PRINTER_QUEUE not found` | Run `npm run list-printers`, copy the exact name. |
| Label clipped / wrong size | Confirm `PRINTER_MEDIA` matches the physical label and `LABEL_WIDTH_IN/HEIGHT_IN` match it. Prefer a Brother-driver named media over `Custom.`. |
| Job submits but nothing prints | `lpstat -p YOUR_QUEUE` — if disabled, `cupsenable YOUR_QUEUE`; check `/var/log/cups/error_log`. |
| Webhook 401 in logs | `SHOPIFY_WEBHOOK_SECRET` doesn't match the webhook's signing secret. |
| Webhooks never arrive | Tunnel down, or webhook URL wrong. `curl https://labels.yourdomain.com/healthz` should return `ok`. |
| Bot doesn't respond | Wrong token, or your ID isn't in `TELEGRAM_OWNER_IDS`. |
| Missed an order while asleep | The poller backfills within `POLL_INTERVAL_SECONDS`. |

---

## Security notes
- All secrets live in `.env` (git-ignored) — never commit them.
- The Telegram bot is locked to your user ID(s).
- The webhook endpoint verifies Shopify's HMAC on every request before trusting it.
