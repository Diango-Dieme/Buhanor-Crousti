// api/telegram-webhook.js — Buhanor Crousti (Version Finale)

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- Helpers Supabase (bypass RLS avec la clé service_role) ---
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

// --- Helper Telegram API ---
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// --- Formatage des messages ---
const STATUS_LABEL = {
  received: '📝 Reçue',
  preparing: '🔥 En préparation',
  ready: '✅ Prêt',
  en_route: '🛵 En route',
  completed: '✔ Terminée'
};

function buildKeyboard(orderId, currentStatus, deliveryType) {
  const row = [];
  if (currentStatus === 'received') row.push({ text: '🔥 En préparation', callback_data: `status:${orderId}:preparing` });
  if (currentStatus === 'preparing') row.push({ text: '✅ Prêt', callback_data: `status:${orderId}:ready` });
  if (currentStatus === 'ready' && deliveryType === 'delivery') row.push({ text: '🛵 Parti', callback_data: `status:${orderId}:en_route` });
  if (currentStatus === 'ready' || currentStatus === 'en_route') row.push({ text: '✔ Terminer', callback_data: `status:${orderId}:completed` });
  return { inline_keyboard: [row] };
}

function buildOrderMessage(order) {
  const items = (order.items || []).map(i => `• ${i.qty}× ${i.name}`).join('\n');
  const sauces = (order.sauces && order.sauces.length > 0) ? `\n🌶️ Sauces : ${order.sauces.join(', ')}` : '';
  const mode = order.delivery_type === 'delivery' ? '🛵 Livraison' : '🏖️ Sur place';
  const phone = order.phone ? `📞 ${order.phone}` : 'Pas de numéro';
  
  return [
    `🍔 *Nouvelle commande*`,
    `👤 ${order.name} · ${phone}`,
    `${mode} · 📍 ${order.location || ''}${sauces}`,
    ``,
    items,
    ``,
    `💰 *${Number(order.total)} FCFA*`,
    `📊 Statut : ${STATUS_LABEL[order.statuts] || order.statuts}`
  ].join('\n');
}

function buildReviewMessage(review) {
  const stars = '⭐'.repeat(review.rating || 0);
  const tags = (review.tags && review.tags.length > 0) ? `🏷️ ${review.tags.join(' · ')}` : '';
  const comment = review.comment ? `💬 "${review.comment}"` : 'Pas de commentaire écrit.';
  
  return [
    `✨ *Nouvel Avis Client !*`,
    ``,
    `👤 Nom : ${review.client_name || 'Anonyme'}`,
    `📊 Note : ${stars} (${review.rating}/5)`,
    tags,
    ``,
    comment
  ].filter(Boolean).join('\n'); // filter(Boolean) enlève les lignes vides si pas de tags
}

// --- Handler Principal ---
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const update = req.body;

  try {
    // ==========================================
    // CAS 1 : CLIC SUR UN BOUTON (Admin)
    // ==========================================
    if (update.callback_query) {
      const { data, id: cbId, message } = update.callback_query;
      const [kind, orderId, newStatus] = data.split(':');

      if (kind !== 'status' || !orderId || !newStatus) return res.status(200).end();

      // Récupérer la commande
      const orders = await sb(`orders?id=eq.${orderId}&select=*`);
      if (!orders || !orders.length) {
        await tg('answerCallbackQuery', { callback_query_id: cbId, text: '❌ Commande introuvable', show_alert: true });
        return res.status(200).end();
      }
      const order = orders[0];

      // Mettre à jour Supabase
      await sb(`orders?id=eq.${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ statuts: newStatus })
      });

      // Éditer le message Telegram
      const updated = { ...order, statuts: newStatus };
      const keyboard = buildKeyboard(orderId, newStatus, order.delivery_type);

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

    // ==========================================
    // CAS 2 : NOUVELLE COMMANDE (Webhook Supabase)
    // ==========================================
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

    // ==========================================
    // CAS 3 : NOUVEL AVIS (Webhook Supabase)
    // ==========================================
    if (update.type === 'INSERT' && update.table === 'reviews' && update.record) {
      const review = update.record;
      await tg('sendMessage', {
        chat_id: TG_CHAT_ID,
        text: buildReviewMessage(review),
        parse_mode: 'Markdown'
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}