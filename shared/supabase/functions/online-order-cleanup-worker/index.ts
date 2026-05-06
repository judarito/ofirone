import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const FUNCTION_BUILD_ID = 'online-order-cleanup-worker-v1'

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
  const expected = String(Deno.env.get('CRON_SECRET') || Deno.env.get('SUBSCRIPTION_RENEWAL_WORKER_SECRET') || '').trim()
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
    return jsonResponse({ ok: true, function_name: 'online-order-cleanup-worker', build_id: FUNCTION_BUILD_ID })
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
    const limit = Math.max(1, Math.min(500, Number(body?.limit || 100)))

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Liberar órdenes online expiradas (Gateway Mercado Pago)
    const { data: gatewayResult, error: gatewayError } = await serviceClient.rpc('fn_release_expired_online_orders', {
      p_limit: limit,
    })

    if (gatewayError) {
      return jsonResponse({ error: getErrorMessage(gatewayError), build_id: FUNCTION_BUILD_ID }, 500)
    }

    const gatewayReleased = typeof gatewayResult === 'number' ? gatewayResult : 0

    return jsonResponse({
      success: true,
      build_id: FUNCTION_BUILD_ID,
      gateway_orders_released: gatewayReleased,
      processed_at: new Date().toISOString(),
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error), build_id: FUNCTION_BUILD_ID }, 500)
  }
})
