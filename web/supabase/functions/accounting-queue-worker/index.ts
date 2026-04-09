import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function readCronKey(req: Request) {
  const headerKey = req.headers.get('x-cron-key') || ''
  if (headerKey) return headerKey

  const auth = req.headers.get('Authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  return ''
}

function isAsyncMode(mode: unknown) {
  return String(mode || '')
    .trim()
    .toUpperCase()
    .startsWith('ASYNC')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const expectedCronKey = Deno.env.get('ACCOUNTING_QUEUE_CRON_KEY') || ''

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500)
    }

    if (expectedCronKey) {
      const providedKey = readCronKey(req)
      if (!providedKey || providedKey !== expectedCronKey) {
        return jsonResponse({ error: 'Unauthorized cron key' }, 401)
      }
    }

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch (_) {
      body = {}
    }

    const pLimit = Number(body.limit || 100)
    const limit = Number.isFinite(pLimit) ? Math.max(1, Math.min(500, Math.floor(pLimit))) : 100
    const tenantId = body.tenant_id ? String(body.tenant_id) : null

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    let tenants: string[] = []

    if (tenantId) {
      tenants = [tenantId]
    } else {
      const { data, error } = await admin
        .from('tenant_settings')
        .select('tenant_id')
        .eq('accounting_enabled', true)
        .eq('accounting_mode', 'ASYNC')

      if (error) {
        return jsonResponse({ error: `No se pudieron cargar tenants: ${error.message}` }, 500)
      }

      tenants = (data || [])
        .map((row: { tenant_id?: string }) => row.tenant_id)
        .filter((id): id is string => Boolean(id))
    }

    let processedTenants = 0
    let failedTenants = 0
    const results: Array<Record<string, unknown>> = []
    const totals = { taken: 0, processed: 0, failed: 0, skipped: 0 }

    for (const tId of tenants) {
      const { data, error } = await admin.rpc('fn_accounting_process_queue', {
        p_tenant_id: tId,
        p_limit: limit,
        p_only_event_id: null,
      })

      if (error) {
        failedTenants += 1
        results.push({ tenant_id: tId, success: false, error: error.message })
        continue
      }

      const payload = (data || {}) as Record<string, unknown>
      if (payload.success === false) {
        failedTenants += 1
        results.push({ tenant_id: tId, success: false, error: String(payload.message || 'RPC returned success=false'), payload })
        continue
      }

      processedTenants += 1
      totals.taken += Number(payload.taken || 0)
      totals.processed += Number(payload.processed || 0)
      totals.failed += Number(payload.failed || 0)
      totals.skipped += Number(payload.skipped || 0)

      results.push({ tenant_id: tId, success: true, ...payload })
    }

    const readyPendingCountResp = await admin
      .from('accounting_event_queue')
      .select('*', { count: 'exact', head: true })
      .in('status', ['PENDING', 'FAILED'])
      .lte('available_at', new Date().toISOString())

    const readyPendingCount = readyPendingCountResp.count || 0

    // If there are pending events but no ASYNC-enabled tenants targeted, surface a real error.
    if (!tenantId && tenants.length === 0 && readyPendingCount > 0) {
      const { data: pendingTenantRows } = await admin
        .from('accounting_event_queue')
        .select('tenant_id')
        .in('status', ['PENDING', 'FAILED'])
        .lte('available_at', new Date().toISOString())
        .limit(200)

      const candidateTenantIds = Array.from(
        new Set((pendingTenantRows || []).map((row: { tenant_id?: string }) => row.tenant_id).filter(Boolean)),
      ) as string[]

      let settingsByTenant = new Map<string, { accounting_enabled: boolean; accounting_mode: string | null }>()
      if (candidateTenantIds.length > 0) {
        const { data: tenantSettingsRows } = await admin
          .from('tenant_settings')
          .select('tenant_id, accounting_enabled, accounting_mode')
          .in('tenant_id', candidateTenantIds)

        settingsByTenant = new Map(
          (tenantSettingsRows || []).map((row: { tenant_id: string; accounting_enabled?: boolean; accounting_mode?: string | null }) => [
            row.tenant_id,
            {
              accounting_enabled: Boolean(row.accounting_enabled),
              accounting_mode: row.accounting_mode ?? null,
            },
          ]),
        )
      }

      const diagnostics = candidateTenantIds.map((id) => {
        const cfg = settingsByTenant.get(id)
        return {
          tenant_id: id,
          accounting_enabled: cfg?.accounting_enabled ?? null,
          accounting_mode: cfg?.accounting_mode ?? null,
          async_mode_detected: isAsyncMode(cfg?.accounting_mode),
        }
      })

      return jsonResponse(
        {
          success: false,
          error: 'Hay eventos pendientes, pero no hay tenants elegibles en modo ASYNC habilitado.',
          ready_pending_events: readyPendingCount,
          tenant_diagnostics: diagnostics,
          ran_at: new Date().toISOString(),
        },
        409,
      )
    }

    const success = failedTenants === 0
    return jsonResponse({
      success,
      tenants_targeted: tenants.length,
      tenants_processed: processedTenants,
      tenants_failed: failedTenants,
      ready_pending_events: readyPendingCount,
      totals,
      results,
      ran_at: new Date().toISOString(),
    }, success ? 200 : 500)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
