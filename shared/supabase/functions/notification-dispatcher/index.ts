import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type SupabaseClient = ReturnType<typeof createClient>
type Row = Record<string, unknown>

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sanitizeName(value: unknown) {
  return String(value || 'OfirOne').replace(/[<>]/g, '').trim() || 'OfirOne'
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value || 10)
  if (!Number.isFinite(parsed)) return 10
  return Math.max(1, Math.min(50, Math.trunc(parsed)))
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function buildPublicOrderUrl(orderId: unknown) {
  const origin = String(Deno.env.get('PUBLIC_APP_URL') || Deno.env.get('APP_PUBLIC_URL') || '').trim().replace(/\/+$/, '')
  if (!origin || !orderId) return ''
  return `${origin}/pedido/${orderId}`
}

function getStoreSnapshotBrand(order: Row) {
  const snapshot = order.store_snapshot && typeof order.store_snapshot === 'object'
    ? order.store_snapshot as Row
    : {}
  return String(snapshot.brand_name || '').trim()
}

function buildOnlineOrderEmailHtml(params: {
  eventType: string
  order: Row
  store: Row | null
  lines: Row[]
}) {
  const { eventType, order, store, lines } = params
  const isApproved = eventType === 'ONLINE_ORDER_APPROVED'
  const isRejected = eventType === 'ONLINE_ORDER_REJECTED'
  const storeName = String(store?.brand_name || getStoreSnapshotBrand(order) || 'La tienda').trim()
  const title = isApproved
    ? 'Tu compra fue confirmada'
    : isRejected
      ? 'Tu compra no pudo ser confirmada'
      : 'Recibimos tu pedido'
  const intro = isApproved
    ? 'Recibimos la confirmación del pago y tu pedido quedó aprobado.'
    : isRejected
      ? 'Tu pedido fue rechazado o el pago no pudo ser confirmado. Si crees que fue un error, contacta a la tienda.'
      : 'Tu pedido fue recibido y está pendiente de validación.'
  const headerBg = isApproved ? '#ecfdf5' : isRejected ? '#fff7ed' : '#eff6ff'
  const statusUrl = buildPublicOrderUrl(order.online_order_id)

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
        <div style="padding:24px;background:${headerBg};">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;">${escapeHtml(storeName)}</div>
          <h1 style="margin:8px 0 0;font-size:24px;color:#111827;">${escapeHtml(title)}</h1>
          <p style="margin:10px 0 0;color:#334155;line-height:1.5;">${escapeHtml(intro)}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;color:#334155;">Pedido <strong>#${escapeHtml(order.order_number)}</strong></p>
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

function buildOnlineOrderEmailText(eventType: string, order: Row, store: Row | null) {
  const storeName = String(store?.brand_name || getStoreSnapshotBrand(order) || 'La tienda').trim()
  const status = eventType === 'ONLINE_ORDER_APPROVED'
    ? 'confirmada'
    : eventType === 'ONLINE_ORDER_REJECTED'
      ? 'rechazada'
      : 'recibida'
  return `${storeName}: tu compra #${order.order_number} fue ${status}. Total: ${formatMoney(order.total)}.`
}

async function buildEmailContent(supabase: SupabaseClient, row: Row) {
  const eventType = String(row.event_type || '')
  const entityType = String(row.entity_type || '')
  const entityId = String(row.entity_id || '').trim()

  if (entityType !== 'ONLINE_ORDER' || !['ONLINE_ORDER_APPROVED', 'ONLINE_ORDER_REJECTED', 'ONLINE_ORDER_PENDING'].includes(eventType) || !entityId) {
    return {
      html: String(row.html || `<p>${row.text_body || row.subject}</p>`),
      text: String(row.text_body || row.subject || ''),
      fromName: '',
    }
  }

  const { data: order, error: orderError } = await supabase
    .from('online_orders')
    .select('online_order_id, store_id, order_number, total, customer_name, customer_email, payment_status, status, store_snapshot')
    .eq('online_order_id', entityId)
    .maybeSingle()
  if (orderError || !order) {
    return {
      html: String(row.html || `<p>${row.text_body || row.subject}</p>`),
      text: String(row.text_body || row.subject || ''),
      fromName: '',
    }
  }

  const [{ data: store }, { data: lines }] = await Promise.all([
    supabase
      .from('online_stores')
      .select('store_id, brand_name, slug')
      .eq('store_id', order.store_id)
      .maybeSingle(),
    supabase
      .from('online_order_lines')
      .select('product_name, variant_name, sku, quantity, line_total')
      .eq('online_order_id', entityId)
      .order('created_at', { ascending: true }),
  ])

  return {
    html: buildOnlineOrderEmailHtml({
      eventType,
      order,
      store: store || null,
      lines: lines || [],
    }),
    text: buildOnlineOrderEmailText(eventType, order, store || null),
    fromName: String(store?.brand_name || getStoreSnapshotBrand(order) || '').trim(),
  }
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
    const limit = normalizeLimit(body?.limit)
    const notificationId = String(body?.notification_id || '').trim()
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    await supabase
      .from('notification_outbox')
      .update({
        status: 'pending',
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('locked_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

    let query = supabase
      .from('notification_outbox')
      .select('*')
      .in('status', ['pending', 'failed'])
      .eq('channel', 'email')
      .lte('next_attempt_at', new Date().toISOString())
      .lt('attempts', 3)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (notificationId) {
      query = query.eq('notification_id', notificationId)
    }

    const { data: rows, error: listError } = await query
    if (listError) throw listError

    const fromEmail = String(Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev').trim()
    const defaultFromName = sanitizeName(Deno.env.get('RESEND_FROM_NAME') || 'OfirOne')
    const results: Array<Record<string, unknown>> = []

    for (const row of rows || []) {
      const { data: claimedRows, error: claimError } = await supabase
        .from('notification_outbox')
        .update({
          status: 'processing',
          locked_at: new Date().toISOString(),
          attempts: Number(row.attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('notification_id', row.notification_id)
        .in('status', ['pending', 'failed'])
        .select('notification_id')

      if (claimError) {
        results.push({ notification_id: row.notification_id, ok: false, error: claimError.message })
        continue
      }
      if (!claimedRows?.length) {
        results.push({ notification_id: row.notification_id, ok: true, skipped: 'already_claimed' })
        continue
      }

      try {
        const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}
        const content = await buildEmailContent(supabase, row)
        const fromName = sanitizeName(payload.from_name || content.fromName || defaultFromName)
        const resendData = await sendResendEmail({
          from: `${fromName} <${fromEmail}>`,
          to: row.recipient_email,
          subject: row.subject,
          html: content.html,
          text: content.text,
        })

        const { error: sentError } = await supabase
          .from('notification_outbox')
          .update({
            status: 'sent',
            provider: 'resend',
            provider_message_id: resendData?.id || null,
            sent_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('notification_id', row.notification_id)

        if (sentError) throw sentError
        results.push({ notification_id: row.notification_id, ok: true, resend_id: resendData?.id || null })
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1
        const nextDelayMinutes = attempts >= Number(row.max_attempts || 3)
          ? 60
          : Math.min(60, 2 ** attempts)
        const nextAttemptAt = new Date(Date.now() + nextDelayMinutes * 60 * 1000).toISOString()
        const finalStatus = attempts >= Number(row.max_attempts || 3) ? 'failed' : 'pending'

        await supabase
          .from('notification_outbox')
          .update({
            status: finalStatus,
            next_attempt_at: nextAttemptAt,
            last_error: error instanceof Error ? error.message : 'Unexpected error',
            updated_at: new Date().toISOString(),
          })
          .eq('notification_id', row.notification_id)

        results.push({
          notification_id: row.notification_id,
          ok: false,
          error: error instanceof Error ? error.message : 'Unexpected error',
        })
      }
    }

    return jsonResponse({
      ok: true,
      processed: results.length,
      results,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
