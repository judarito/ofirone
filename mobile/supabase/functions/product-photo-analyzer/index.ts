import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: unknown }).text || '');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseAiJson(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (_e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch (_err) {
      return null;
    }
  }
}

async function extractTextWithOcrSpace(imageDataUrl: string, apiKey: string) {
  const form = new FormData();
  form.append('base64Image', imageDataUrl);
  form.append('language', 'spa');
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      apikey: apiKey,
    },
    body: form,
  });

  const rawText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch (_error) {
    json = null;
  }

  if (!response.ok) {
    return {
      success: false,
      error: `OCR.Space HTTP ${response.status}`,
      details: rawText.slice(0, 1200),
    };
  }

  const parsedResults = Array.isArray(json?.ParsedResults)
    ? (json.ParsedResults as Array<Record<string, unknown>>)
    : [];

  const parsedText = parsedResults
    .map((item) => String(item?.ParsedText || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return {
    success: true,
    text: parsedText,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    return jsonResponse({ error: 'Missing DEEPSEEK_API_KEY secret in Edge Function' }, 500);
  }

  const ocrSpaceApiKey = Deno.env.get('OCR_SPACE_API_KEY') || 'helloworld';

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const image = String(body.image || '').trim();
  const mimeType = String(body.mime_type || 'image/jpeg').trim();
  if (!image) {
    return jsonResponse({ error: 'image is required (base64 or data URL)' }, 400);
  }

  const imageUrl = image.startsWith('data:') ? image : `data:${mimeType};base64,${image}`;
  const ocrResult = await extractTextWithOcrSpace(imageUrl, ocrSpaceApiKey);
  const ocrText = String(ocrResult?.text || '').slice(0, 8000);

  const upstreamPayload = {
    model: String(body.model || 'deepseek-chat'),
    temperature: 0.1,
    max_tokens: 1800,
    messages: [
      {
        role: 'system',
        content:
          'Eres un asistente para catalogo POS. Analizas texto visible en la foto de un producto y respondes SOLO JSON valido.',
      },
      {
        role: 'user',
        content: `A partir del texto OCR de una foto de producto, responde JSON EXACTO con esta forma:
{
  "suggested_name": "string|null",
  "suggested_brand": "string|null",
  "suggested_category": "string|null",
  "suggested_description": "string|null",
  "labels": ["string"],
  "warnings": ["string"],
  "confidence": number
}

Reglas:
- No inventes datos que no estén razonablemente sustentados por el OCR.
- Si no estás seguro, usa null o warnings.
- suggested_name debe ser corto y apto para catálogo POS.
- confidence entre 0 y 1.
- Responde SOLO JSON.

Texto OCR:
"""${ocrText}"""`,
      },
    ],
    stream: false,
  };

  const upstream = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamPayload),
  });

  const rawText = await upstream.text();
  let rawJson: Record<string, unknown> | null = null;
  try {
    rawJson = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch (_error) {
    rawJson = null;
  }

  if (!upstream.ok) {
    return jsonResponse(
      {
        error: 'DeepSeek request failed',
        details: rawText.slice(0, 1200) || `HTTP ${upstream.status}`,
        status: upstream.status,
      },
      upstream.status,
    );
  }

  const choice = Array.isArray(rawJson?.choices) ? (rawJson.choices?.[0] as Record<string, unknown>) : null;
  const message = choice && typeof choice === 'object' ? (choice.message as Record<string, unknown> | undefined) : null;
  const content = normalizeContent(message?.content);
  const parsed = parseAiJson(content || '');

  if (!parsed) {
    return jsonResponse({ error: 'Could not parse JSON from model output', content }, 502);
  }

  return jsonResponse({
    success: true,
    data: {
      suggested_name: parsed.suggested_name || null,
      suggested_brand: parsed.suggested_brand || null,
      suggested_category: parsed.suggested_category || null,
      suggested_description: parsed.suggested_description || null,
      labels: Array.isArray(parsed.labels) ? parsed.labels : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      confidence: Number(parsed.confidence || 0),
      ocr_text: ocrText || null,
    },
  });
});
