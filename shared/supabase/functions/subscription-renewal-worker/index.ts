import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const FUNCTION_BUILD_ID = 'subscription-renewal-worker-v1'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = String(record.message || record.error || record.details || record.hint || '').trim()
    if (message) return message
  }
  return String(error || 'Error desconocido')
}

function assertCronAllowed(req: Request) {
  const expected = String(Deno.env.get('SUBSCRIPTION_RENEWAL_WORKER_SECRET') || Deno.env.get('CRON_SECRET') || '').trim()
  if (!expected) return

  const provided = String(req.headers.get('x-cron-secret') || '').trim()
  if (provided !== expected) {
    throw new Error('No autorizado.')
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return jsonResponse({ ok: true, function_name: 'subscription-renewal-worker', build_id: FUNCTION_BUILD_ID })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  try {
    assertCronAllowed(req)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')

    const body = await req.json().catch(() => ({}))
    const limit = Math.max(1, Math.min(1000, Number(body?.limit || 250)))

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: expirationResult, error: expError } = await serviceClient.rpc('fn_process_tenant_subscription_expirations', {
      p_limit: limit,
    })
    if (expError) throw expError

    let remindersResult = { success: true, processed: 0 }
    try {
      const { data: remData, error: remError } = await serviceClient.rpc('fn_enqueue_pre_expiry_reminders', {
        p_limit: limit,
      })
      if (!remError) remindersResult = remData || { success: true, processed: 0 }
    } catch (_reminderError) {
      console.warn('[subscription-renewal-worker] Pre-expiry reminders skipped:', getErrorMessage(_reminderError))
    }

    return jsonResponse({
      success: true,
      build_id: FUNCTION_BUILD_ID,
      expirations: expirationResult,
      reminders: remindersResult,
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error), build_id: FUNCTION_BUILD_ID }, 500)
  }
})
