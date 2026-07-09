import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { log } from './logger.js';
import { findOrderByName, findOrderById, findLatestOrder, findRecentOrders } from './shopify.js';
import { renderAndPrint } from './labelJob.js';
import { renderLabelPdf } from './renderLabel.js';
import { markOrderPrinted } from './dedupe.js';
import { isOwner, claimIfUnowned, listOwners } from './owners.js';

const MAX = config.maxLabels;

// Remember order labels we've seen (from webhook/poller) so a button tap can
// print without a Shopify round-trip. Falls back to a lookup by id if missing.
const labelCache = new Map();
export function cacheLabel(label) {
  if (label?.orderId != null) labelCache.set(String(label.orderId), label);
}
async function getLabel(orderId) {
  const key = String(orderId);
  const cached = labelCache.get(key);
  // Always refetch at print time: delivery apps often attach the order note
  // AFTER the order-created webhook fires, so a label cached at webhook time
  // can be missing the driver notes. Fall back to the cache if Shopify is
  // unreachable.
  try {
    const fresh = await findOrderById(orderId);
    if (fresh) {
      if (!fresh.driverNotes && cached?.driverNotes) fresh.driverNotes = cached.driverNotes;
      cacheLabel(fresh);
      return fresh;
    }
  } catch (e) {
    log.warn(`Fresh order lookup failed for ${key}: ${e.message}`);
    if (cached) return cached;
    throw e;
  }
  return cached || null;
}

// Inline keyboard: quantity buttons 1..MAX, plus optional Download / Not now.
function qtyKeyboard(action, orderId, { withSkip = false, withDownload = false } = {}) {
  const kb = new InlineKeyboard();
  for (let n = 1; n <= MAX; n++) kb.text(String(n), `${action}:${orderId}:${n}`);
  kb.row();
  if (withDownload) kb.text('📄 Download PDF', `dl:${orderId}`);
  if (withSkip) kb.text('✖ Not now', `skip:${orderId}`);
  else kb.text('✖ Cancel', `cancel:${orderId}`);
  return kb;
}

function summary(label) {
  const loc = [label.city, label.province].filter(Boolean).join(', ');
  return `${label.orderName} — ${label.name}${loc ? ` · ${loc}` : ''}`;
}

export function createBot() {
  if (!config.telegram.token) {
    log.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled.');
    return null;
  }
  const bot = new Bot(config.telegram.token);

  // ── Access control: claim-on-first-/start, then strict whitelist ──
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id) return;
    if (isOwner(id)) return next();
    // Allow an unclaimed bot to be claimed by the first /start.
    const text = ctx.message?.text || '';
    if (text.startsWith('/start') && claimIfUnowned(id)) {
      return ctx.reply(
        `✅ You're now the owner of this label bot (your ID: ${id}).\n\n` +
          "When an order comes in I'll ask you here whether to print, and how " +
          'many labels. Commands:\n' +
          '/reprint <order#> — reprint a label\n/last — reprint the most recent order\n' +
          '/recent — pick from the last 5 orders'
      );
    }
    log.warn(`Blocked unauthorized Telegram user ${id}`);
  });

  // ── The print action (shared by new-order, reprint, /last, /recent) ──
  async function doPrint(ctx, orderId, copies, { isReprint } = {}) {
    const n = Math.max(1, Math.min(MAX, Number(copies) || 1));
    let label;
    try {
      label = await getLabel(orderId);
    } catch (e) {
      return ctx.reply(`⚠️ Couldn't load order: ${e.message}`);
    }
    if (!label) return ctx.reply('⚠️ Order not found.');

    const verb = isReprint ? 'Re-printing' : 'Printing';
    await ctx.reply(`🖨️ ${verb} ${n} label${n > 1 ? 's' : ''} for ${label.orderName}…`);
    try {
      const { pdfPath } = await renderAndPrint(label, {
        copies: n,
        suffix: isReprint ? '_reprint' : '',
      });
      markOrderPrinted(label.orderId);
      const kb = new InlineKeyboard().text('🔁 Reprint (stuck label)', `rp:${label.orderId}`);
      await ctx.replyWithDocument(new InputFile(pdfPath), {
        caption: `✅ ${isReprint ? 'Re-printed' : 'Printed'} ${n}× ${label.orderName} — ${label.name}`,
        reply_markup: kb,
      });
    } catch (e) {
      log.error('print failed:', e.message);
      const kb = new InlineKeyboard().text('🔁 Try again', `r:${label.orderId}:${n}`);
      await ctx.reply(`⚠️ Print failed: ${e.message}`, { reply_markup: kb });
    }
  }

  // ── Render and send the PDF WITHOUT printing (Download PDF) ──
  async function doDownload(ctx, orderId) {
    let label;
    try {
      label = await getLabel(orderId);
    } catch (e) {
      return ctx.reply(`⚠️ Couldn't load order: ${e.message}`);
    }
    if (!label) return ctx.reply('⚠️ Order not found.');
    try {
      const pdfPath = await renderLabelPdf(label, { suffix: '_view' });
      await ctx.replyWithDocument(new InputFile(pdfPath), {
        caption: `📄 Label PDF for ${label.orderName} — *not printed*. Print how many packages?`,
        parse_mode: 'Markdown',
        reply_markup: qtyKeyboard('p', label.orderId),
      });
    } catch (e) {
      log.error('download failed:', e.message);
      await ctx.reply(`⚠️ Could not generate PDF: ${e.message}`);
    }
  }

  // ── Push a "new order" prompt to the owner(s) ──
  async function promptNewOrder(label) {
    cacheLabel(label);
    const owners = listOwners();
    if (!owners.length) {
      log.warn(`New order ${label.orderName} but no Telegram owner yet — send /start to the bot.`);
      return;
    }
    const text =
      `🆕 *New order* ${summary(label)}\n\n` +
      (label.driverNotes ? `📝 Notes: ${label.driverNotes.replace(/\n/g, ' · ')}\n\n` : '') +
      `Print the label now? Choose how many packages:`;
    for (const id of owners) {
      try {
        await bot.api.sendMessage(id, text, {
          parse_mode: 'Markdown',
          reply_markup: qtyKeyboard('p', label.orderId, { withSkip: true, withDownload: true }),
        });
      } catch (e) {
        log.warn(`Could not prompt owner ${id}: ${e.message}`);
      }
    }
  }

  function notify(text) {
    for (const id of listOwners()) {
      bot.api.sendMessage(id, text).catch((e) => log.warn('notify failed:', e.message));
    }
  }

  // ── Commands ──
  bot.command('start', (ctx) =>
    ctx.reply(
      "Label bot is connected. When orders arrive I'll ask you here whether to " +
        'print and how many labels.\n\n/reprint <order#> · /last · /recent · /whoami'
    )
  );
  bot.command('whoami', (ctx) => ctx.reply(`Your Telegram ID: ${ctx.from.id}`));

  bot.command('reprint', async (ctx) => {
    const name = String(ctx.match || '').replace(/^#/, '').trim();
    if (!/^\d+$/.test(name)) return ctx.reply('Usage: /reprint <order number>');
    try {
      const label = await findOrderByName(name);
      if (!label) return ctx.reply(`Order #${name} not found.`);
      cacheLabel(label);
      await ctx.reply(`How many labels to re-print for ${label.orderName}?`, {
        reply_markup: qtyKeyboard('r', label.orderId),
      });
    } catch (e) {
      await ctx.reply(`⚠️ Lookup failed: ${e.message}`);
    }
  });

  bot.command('last', async (ctx) => {
    try {
      const label = await findLatestOrder();
      if (!label) return ctx.reply('No orders found.');
      cacheLabel(label);
      await ctx.reply(`Most recent: ${summary(label)}\nHow many labels?`, {
        reply_markup: qtyKeyboard('p', label.orderId),
      });
    } catch (e) {
      await ctx.reply(`⚠️ Lookup failed: ${e.message}`);
    }
  });

  bot.command('recent', async (ctx) => {
    try {
      const labels = await findRecentOrders(5);
      if (!labels.length) return ctx.reply('No orders found.');
      const kb = new InlineKeyboard();
      for (const l of labels) {
        cacheLabel(l);
        kb.text(summary(l).slice(0, 60), `pick:${l.orderId}`).row();
      }
      await ctx.reply('Pick an order:', { reply_markup: kb });
    } catch (e) {
      await ctx.reply(`⚠️ Lookup failed: ${e.message}`);
    }
  });

  // ── Callback buttons ──
  // Print N now (new order or /last)
  bot.callbackQuery(/^p:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    await doPrint(ctx, ctx.match[1], ctx.match[2], { isReprint: false });
  });
  // Reprint N (stuck label / try again)
  bot.callbackQuery(/^r:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await doPrint(ctx, ctx.match[1], ctx.match[2], { isReprint: true });
  });
  // Download the PDF without printing
  bot.callbackQuery(/^dl:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Generating PDF…' });
    await doDownload(ctx, ctx.match[1]);
  });
  // Open the reprint quantity menu
  bot.callbackQuery(/^rp:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = ctx.match[1];
    let label;
    try {
      label = await getLabel(orderId);
    } catch {
      /* ignore */
    }
    await ctx.reply(
      `How many labels to re-print${label ? ` for ${label.orderName}` : ''}?`,
      { reply_markup: qtyKeyboard('r', orderId) }
    );
  });
  // Pick an order from /recent -> ask quantity
  bot.callbackQuery(/^pick:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = ctx.match[1];
    let label;
    try {
      label = await getLabel(orderId);
    } catch {
      /* ignore */
    }
    await ctx.reply(`How many labels${label ? ` for ${label.orderName}` : ''}?`, {
      reply_markup: qtyKeyboard('p', orderId),
    });
  });
  // Not now
  bot.callbackQuery(/^skip:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Skipped' });
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply('👍 Skipped. Use /reprint <order#> if you need it later.');
  });
  // Cancel a quantity prompt (nothing is printed)
  bot.callbackQuery(/^cancel:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply('✖ Cancelled — nothing printed.');
  });

  bot.catch((err) => log.error('grammY error:', err.message));

  return { bot, promptNewOrder, notify };
}
