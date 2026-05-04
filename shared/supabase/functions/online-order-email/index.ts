import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type OrderRow = Record<string, unknown>

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function notificationKey(event: string) {
  return event === 'rejected' ? 'purchase_rejected' : 'purchase_approved'
}

function notificationAlreadyHandled(notification: unknown) {
  if (!notification || typeof notification !== 'object') return false
  const status = String((notification as Record<string, unknown>).status || '').toLowerCase()
  return status === 'sent' || status === 'sending' || Boolean((notification as Record<string, unknown>).sent_at)
}

function notificationWasSent(notification: unknown) {
  if (!notification || typeof notification !== 'object') return false
  const status = String((notification as Record<string, unknown>).status || '').toLowerCase()
  return status === 'sent' || Boolean((notification as Record<string, unknown>).sent_at)
}

function resolveEvent(bodyEvent: unknown, order: OrderRow) {
  const raw = String(bodyEvent || '').trim().toLowerCase()
  if (['approved', 'paid', 'confirmed', 'success'].includes(raw)) return 'approved'
  if (['rejected', 'failed', 'cancelled', 'canceled'].includes(raw)) return 'rejected'

  const status = String(order.status || '').toUpperCase()
  const paymentStatus = String(order.payment_status || '').toUpperCase()
  if (paymentStatus === 'PAID' || status === 'COMPLETED') return 'approved'
  if (paymentStatus === 'FAILED' || status === 'CANCELLED') return 'rejected'
  return ''
}

function buildStatusUrl(order: OrderRow, store: OrderRow | null, explicitOrigin = '') {
  const origin = String(explicitOrigin || Deno.env.get('PUBLIC_APP_URL') || Deno.env.get('APP_PUBLIC_URL') || '').trim().replace(/\/+$/, '')
  if (!origin) return ''
  return `${origin}/pedido/${order.online_order_id}`
}

function buildEmailHtml(params: {
  event: string
  order: OrderRow
  store: OrderRow | null
  lines: OrderRow[]
  statusUrl: string
}) {
  const { event, order, store, lines, statusUrl } = params
  const storeName = String(store?.brand_name || order.store_name || 'La tienda').trim()
  const orderNumber = String(order.order_number || '').trim()
  const isApproved = event === 'approved'
  const title = isApproved ? 'Tu compra fue confirmada' : 'Tu compra no pudo ser confirmada'
  const intro = isApproved
    ? 'Recibimos la confirmación del pago y tu pedido quedó aprobado.'
    : 'Tu pedido fue rechazado o el pago no pudo ser confirmado. Si crees que fue un error, contacta a la tienda.'

  const itemsHtml = lines.length
    ? lines.map((line) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;color:#111827;">${escapeHtml(line.quantity)} x ${escapeHtml(line.product_name)}</div>
            ${line.variant_name ? `<div style="font-size:13px;color:#64748b;">${escapeHtml(line.variant_name)}</div>` : ''}
            ${line.sku ? `<div style="font-size:12px;color:#94a3b8;">SKU: ${escapeHtml(line.sku)}</div>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827;">
            ${formatMoney(line.line_total)}
          </td>
        </tr>
      `).join('')
    : '<tr><td style="padding:10px 0;color:#64748b;">Productos no disponibles en el resumen.</td></tr>'

  return `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #e5e7eb;overflow:hidden;">
        <div style="padding:24px;background:${isApproved ? '#ecfdf5' : '#fff7ed'};">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;">${escapeHtml(storeName)}</div>
          <h1 style="margin:8px 0 0;font-size:24px;color:#111827;">${escapeHtml(title)}</h1>
          <p style="margin:10px 0 0;color:#334155;line-height:1.5;">${escapeHtml(intro)}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;color:#334155;">Pedido <strong>#${escapeHtml(orderNumber)}</strong></p>
          <table style="width:100%;border-collapse:collapse;">
            ${itemsHtml}
            <tr>
              <td style="padding:14px 0 0;color:#64748b;">Total</td>
              <td style="padding:14px 0 0;text-align:right;font-size:18px;font-weight:700;">${formatMoney(order.total)}</td>
            </tr>
          </table>
          ${statusUrl ? `
            <div style="margin-top:24px;">
              <a href="${escapeHtml(statusUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">
                Ver estado del pedido
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `
}

function buildEmailText(event: string, order: OrderRow, store: OrderRow | null) {
  const storeName = String(store?.brand_name || order.store_name || 'La tienda').trim()
  const orderNumber = String(order.order_number || '').trim()
  const status = event === 'approved' ? 'confirmada' : 'rechazada'
  return `${storeName}: tu compra #${orderNumber} fue ${status}. Total: ${formatMoney(order.total)}.`
}

async function sendResendEmail(payload: Record<string, unknown>) {
  const apiKey = String(Deno.env.get('RESEND_API_KEY') || Deno.env.get('RESEND_KEY') || '').trim()
  if (!apiKey) {
    throw new Error('Falta configurar RESEND_API_KEY en los secretos de Supabase.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || 'Resend no pudo enviar el correo.'))
  }
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
    }

    const body = await req.json().catch(() => ({}))
    const orderId = String(body?.online_order_id || body?.order_id || '').trim()
    const force = body?.force === true
    if (!orderId) {
      return jsonResponse({ error: 'Pedido online requerido.' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: order, error: orderError } = await supabase
      .from('online_orders')
      .select('online_order_id, tenant_id, store_id, order_number, total, status, payment_status, payment_mode, payment_reference, customer_name, customer_email, customer_phone, delivery_address, customer_note, payment_payload, created_at')
      .eq('online_order_id', orderId)
      .maybeSingle()
    if (orderError) throw orderError
    if (!order) return jsonResponse({ error: 'No encontramos el pedido online.' }, 404)

    const to = normalizeEmail(order.customer_email)
    if (!to) {
      return jsonResponse({ ok: true, skipped: 'missing_customer_email' })
    }

    const event = resolveEvent(body?.event, order)
    if (!event) {
      return jsonResponse({ ok: true, skipped: 'order_status_not_final' })
    }

    const key = notificationKey(event)
    const paymentPayload = order.payment_payload && typeof order.payment_payload === 'object'
      ? order.payment_payload as Record<string, unknown>
      : {}
    const notifications = paymentPayload.email_notifications && typeof paymentPayload.email_notifications === 'object'
      ? paymentPayload.email_notifications as Record<string, unknown>
      : {}
    if (!force && notificationWasSent(notifications[key])) {
      return jsonResponse({ ok: true, skipped: 'already_sent', event, notification_key: key })
    }

    if (!force) {
      const { data: claimData, error: claimError } = await supabase
        .rpc('fn_claim_online_order_email_notification', {
          p_online_order_id: orderId,
          p_notification_key: key,
        })
      if (claimError) throw claimError

      const claim = Array.isArray(claimData) ? claimData[0] : claimData
      if (!claim?.claimed) {
        return jsonResponse({
          ok: true,
          skipped: notificationAlreadyHandled(claim?.notification) ? 'already_sent' : 'email_send_in_progress',
          event,
          notification_key: key,
          notification: claim?.notification || null,
        })
      }
    }

    const [{ data: store, error: storeError }, { data: lines, error: linesError }] = await Promise.all([
      supabase
        .from('online_stores')
        .select('store_id, brand_name, slug')
        .eq('store_id', order.store_id)
        .maybeSingle(),
      supabase
        .from('online_order_lines')
        .select('product_name, variant_name, sku, quantity, line_total')
        .eq('online_order_id', orderId)
        .order('created_at', { ascending: true }),
    ])
    if (storeError) throw storeError
    if (linesError) throw linesError

    const fromEmail = String(Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev').trim()
    const fromName = String(Deno.env.get('RESEND_FROM_NAME') || store?.brand_name || 'OfirOne').trim()
    const from = `${fromName.replace(/[<>]/g, '')} <${fromEmail}>`
    const statusUrl = buildStatusUrl(order, store, String(body?.origin || '').trim())
    const subject = event === 'approved'
      ? `Compra confirmada #${order.order_number}`
      : `Compra no confirmada #${order.order_number}`

    const resendData = await sendResendEmail({
      from,
      to,
      subject,
      html: buildEmailHtml({ event, order, store, lines: lines || [], statusUrl }),
      text: buildEmailText(event, order, store),
    })

    const sentAt = new Date().toISOString()
    const notification = {
      sent_at: sentAt,
      event,
      resend_id: resendData?.id || null,
      to,
    }

    if (force) {
      const nextPayload = {
        ...paymentPayload,
        email_notifications: {
          ...notifications,
          [key]: {
            ...notification,
            status: 'sent',
          },
        },
      }

      const { error: updateError } = await supabase
        .from('online_orders')
        .update({ payment_payload: nextPayload })
        .eq('online_order_id', orderId)
      if (updateError) throw updateError
    } else {
      const { error: completeError } = await supabase
        .rpc('fn_complete_online_order_email_notification', {
          p_online_order_id: orderId,
          p_notification_key: key,
          p_notification: notification,
        })
      if (completeError) throw completeError
    }

    return jsonResponse({
      ok: true,
      event,
      notification_key: key,
      resend_id: resendData?.id || null,
      sent_at: sentAt,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
