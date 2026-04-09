import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authorization = req.headers.get('Authorization') || ''
    if (!authorization) {
      return new Response(
        JSON.stringify({ error: 'Authorization header requerido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY') ?? ''

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Faltan variables SUPABASE_URL o SUPABASE_ANON_KEY')
    }

    if (!deepseekApiKey) {
      throw new Error('Falta variable DEEPSEEK_API_KEY')
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authorization }
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({ error: 'Token de usuario inválido o expirado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    const {
      model = 'deepseek-chat',
      messages,
      image,
      prompt,
      mime_type,
      temperature = 0.3,
      max_tokens = 3000
    } = body || {}

    const isVisionRequest = typeof image === 'string' && image.trim().length > 0 && typeof prompt === 'string' && prompt.trim().length > 0
    if (!isVisionRequest && (!Array.isArray(messages) || messages.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'Debe enviar messages[] o image+prompt' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const deepseekResponse = isVisionRequest
      ? await fetch('https://api.deepseek.com/v1/vision', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${deepseekApiKey}`
          },
          body: JSON.stringify({
            model,
            image,
            prompt,
            mime_type,
            temperature,
            max_tokens
          })
        })
      : await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${deepseekApiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens,
            stream: false
          })
        })

    if (!deepseekResponse.ok) {
      const errorData = await deepseekResponse.json().catch(() => ({}))
      return new Response(
        JSON.stringify({
          error: `DeepSeek error ${deepseekResponse.status}`,
          details: errorData?.error?.message || 'Unknown error'
        }),
        { status: deepseekResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await deepseekResponse.json()
    const content = isVisionRequest
      ? (data?.content ?? data?.text ?? data?.output_text ?? data?.result ?? data?.choices?.[0]?.message?.content ?? null)
      : (data?.choices?.[0]?.message?.content ?? null)

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'DeepSeek respondió sin contenido', raw: data }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        content,
        usage: data?.usage || null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
