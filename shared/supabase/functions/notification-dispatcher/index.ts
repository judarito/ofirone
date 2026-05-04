import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
        const fromName = sanitizeName(payload.from_name || defaultFromName)
        const resendData = await sendResendEmail({
          from: `${fromName} <${fromEmail}>`,
          to: row.recipient_email,
          subject: row.subject,
          html: row.html || `<p>${row.text_body || row.subject}</p>`,
          text: row.text_body || row.subject,
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
