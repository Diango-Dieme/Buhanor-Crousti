// api/telegram-webhook.js — Buhanor Crousti
// Reçoit les updates Telegram + gère les boutons inline [🔥 En préparation] [✅ Prêt] [🛵 Parti]

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_SECRET = process.env.TELEGRAM_SECRET; // partagé avec Supabase

// ---- Helpers Supabase (service role : bypass RLS) ----
async function sb(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SB_SERVICE_KEY,
      'Authorization': `Bearer ${SB_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function sbRpc(fn, args) {
  return sb(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

// ---- Telegram API ----
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

const STATUS_LABEL = {
  received: '📝 Reçue',
  preparing: '🔥 En préparation',
  ready: '✅ Prêt',
  en_route: '🛵 En route',
  completed: '✔ Terminée'
};

function buildKeyboard(orderId, currentStatus, deliveryType) {
  const row = [];
  if (currentStatus !== 'preparing' && currentStatus !== 'completed' && currentStatus !== 'ready')
    row.push({ text: '🔥 En préparation', callback_data: `status:${orderId}:preparing` });
  if (currentStatus === 'preparing')
    row.push({ text: '✅ Prêt', callback_data: `status:${orderId}:ready` });
  if (currentStatus === 'ready' && deliveryType === 'delivery')
    row.push({ text: '🛵 Parti', callback_data: `status:${orderId}:en_route` });
  if (currentStatus === 'ready' || currentStatus === 'en_route')
    row.push({ text: '✔ Terminer', callback_data: `status:${orderId}:completed` });
  return { inline_keyboard: [row] };
}

function buildOrderMessage(order) {
  const items = (order.items || []).map(i => `• ${i.qty}× ${i.name}`).join('\n');
  const mode = order.delivery_type === 'delivery' ? '🛵 Livraison' : '🛍️ À emporter';
  const phone = order.phone || '—';
  const mapLink = (order.delivery_lat && order.delivery_lng)
    ? `\n📍 [Voir sur Maps](https://www.google.com/maps?q=${order.delivery_lat},${order.delivery_lng})` : '';
  return [
    `🍔 *Nouvelle commande*`,
    `👤 ${order.name} · 📞 ${phone}`,
    `${mode} · 📍 ${order.location || ''}`,
    ``,
    items,
    ``,
    `💰 *${Number(order.total)} FCFA*`,
    `📊 Statut : ${STATUS_LABEL[order.statuts] || order.statuts}`,
    mapLink
  ].join('\n');
}

// ---- Handler principal ----
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const update = req.body;

  try {
    // === Callback : admin a cliqué sur un bouton ===
    if (update.callback_query) {
      const { data, id: cbId, message } = update.callback_query;
      const [kind, orderId, newStatus] = data.split(':');

      if (kind !== 'status' || !orderId || !newStatus) {
        return res.status(200).end();
      }

      // Sécurité : ne pas accepter n'importe quel statut
      if (!['preparing','ready','en_route','completed'].includes(newStatus)) {
        await tg('answerCallbackQuery', { callback_query_id: cbId, text: '❌ Statut invalide', show_alert: true });
        return res.status(200).end();
      }

      // Récupère la commande pour reconstruction du message + clavier
      const orders = await sb(`orders?id=eq.${orderId}&select=*`);
      if (!orders || !orders.length) {
        await tg('answerCallbackQuery', { callback_query_id: cbId, text: '❌ Commande introuvable', show_alert: true });
        return res.status(200).end();
      }
      const order = orders[0];

      // Update Supabase via service role (bypass RLS)
      await sb(`orders?id=eq.${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ statuts: newStatus })
      });

      // Nouveau message
      const updated = { ...order, statuts: newStatus };
      const keyboard = buildKeyboard(orderId, newStatus, order.delivery_type);

      // Édite le message existant
      await tg('editMessageText', {
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: buildOrderMessage(updated),
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });

      await tg('answerCallbackQuery', {
        callback_query_id: cbId,
        text: `✅ Statut mis à jour : ${STATUS_LABEL[newStatus]}`
      });

      return res.status(200).json({ ok: true });
    }

    // === Notification automatique quand une commande est créée ===
    // Cette branche est appelée via un Supabase Database Webhook
    // configuré sur INSERT sur public.orders (voir section "Database Webhook")
    if (update.type === 'INSERT' && update.table === 'orders' && update.record) {
      const order = update.record;
      await tg('sendMessage', {
        chat_id: TG_CHAT_ID,
        text: buildOrderMessage(order),
        parse_mode: 'Markdown',
        reply_markup: buildKeyboard(order.id, order.statuts, order.delivery_type),
        disable_web_page_preview: true
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}