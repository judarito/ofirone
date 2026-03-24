import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const textEncoder = new TextEncoder();

let cachedFcmAccessToken: string | null = null;
let cachedFcmAccessTokenExpiresAt = 0;

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function getBackoffMinutes(attempt: number): number {
  if (attempt <= 1) return 1;
  if (attempt === 2) return 3;
  if (attempt === 3) return 10;
  if (attempt === 4) return 30;
  return 120;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncodeBytes(textEncoder.encode(value));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const sanitized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(sanitized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function normalizePushPayload(payload: unknown): Record<string, string> {
  const source =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue;
    if (value === undefined) continue;
    if (value === null) {
      normalized[key] = '';
      continue;
    }
    if (typeof value === 'string') {
      normalized[key] = value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = String(value);
      continue;
    }
    try {
      normalized[key] = JSON.stringify(value);
    } catch (_error) {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

function getFirebaseServiceAccount() {
  const raw =
    Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ||
    Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ||
    '';
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      client_email?: string;
      private_key?: string;
      project_id?: string;
    };
    if (!parsed?.client_email || !parsed?.private_key || !parsed?.project_id) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

async function getFcmAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  project_id: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedFcmAccessToken && cachedFcmAccessTokenExpiresAt - 60 > now) {
    return cachedFcmAccessToken;
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const claims = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    scope: FCM_SCOPE,
    iat: now,
    exp: now + 3600,
  };

  const unsignedToken = [
    base64UrlEncodeString(JSON.stringify(header)),
    base64UrlEncodeString(JSON.stringify(claims)),
  ].join('.');

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    textEncoder.encode(unsignedToken),
  );
  const jwt = `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;

  const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenText = await tokenResponse.text();
  let tokenJson: Record<string, unknown> | null = null;
  try {
    tokenJson = tokenText ? (JSON.parse(tokenText) as Record<string, unknown>) : null;
  } catch (_error) {
    tokenJson = null;
  }

  if (!tokenResponse.ok) {
    throw new Error(
      String(tokenJson?.error_description || tokenJson?.error || tokenText || 'No fue posible autenticar contra Google OAuth'),
    );
  }

  const accessToken = String(tokenJson?.access_token || '').trim();
  const expiresIn = Math.max(Number(tokenJson?.expires_in || 0), 300);
  if (!accessToken) {
    throw new Error('Google OAuth no devolvio access_token para FCM.');
  }

  cachedFcmAccessToken = accessToken;
  cachedFcmAccessTokenExpiresAt = now + expiresIn;
  return accessToken;
}

function extractFcmError(responseJson: Record<string, unknown> | null, responseText: string) {
  const error = (responseJson?.error || {}) as Record<string, unknown>;
  const details = Array.isArray(error.details) ? error.details : [];
  const detailText = details
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      try {
        return JSON.stringify(entry);
      } catch (_error) {
        return String(entry);
      }
    })
    .filter(Boolean)
    .join(' | ');
  const status = String(error.status || '');
  const message = String(error.message || responseText || 'FCM push failed').slice(0, 500);
  const diagnostic = `${status} ${message} ${detailText}`.toLowerCase();
  return {
    status,
    message,
    disableDevice:
      diagnostic.includes('unregistered') ||
      diagnostic.includes('not a valid fcm registration token') ||
      diagnostic.includes('registration token is not a valid') ||
      diagnostic.includes('requested entity was not found'),
  };
}

async function sendViaExpo(row: Record<string, unknown>, expoAccessToken: string | null) {
  const expoPayload = {
    to: row.expo_push_token,
    title: row.title,
    body: row.message,
    data: row.payload || {},
    sound: 'default',
    channelId: 'default',
    priority: 'high',
    ttl: 3600,
  };

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
    },
    body: JSON.stringify(expoPayload),
  });

  const responseText = await response.text();
  let responseJson: Record<string, unknown> | null = null;
  try {
    responseJson = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : null;
  } catch (_error) {
    responseJson = null;
  }

  const data = responseJson?.data as Record<string, unknown> | undefined;
  const status = String(data?.status || '');
  const details = data?.details as Record<string, unknown> | undefined;
  const errorCode = String(details?.error || '');
  const errorMessage = String(data?.message || responseText || '').slice(0, 500);

  return {
    ok: response.ok && status === 'ok',
    errorMessage,
    disableDevice: errorCode === 'DeviceNotRegistered',
  };
}

async function sendViaFcm(
  row: Record<string, unknown>,
  serviceAccount: {
    client_email: string;
    private_key: string;
    project_id: string;
  },
) {
  const accessToken = await getFcmAccessToken(serviceAccount);
  const payload = normalizePushPayload(row.payload);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          token: row.push_token,
          notification: {
            title: row.title,
            body: row.message,
          },
          data: payload,
          android: {
            priority: 'HIGH',
            ttl: '3600s',
            notification: {
              channel_id: 'default',
              sound: 'default',
            },
          },
        },
      }),
    },
  );

  const responseText = await response.text();
  let responseJson: Record<string, unknown> | null = null;
  try {
    responseJson = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : null;
  } catch (_error) {
    responseJson = null;
  }

  if (response.ok) {
    return {
      ok: true,
      errorMessage: '',
      disableDevice: false,
    };
  }

  const errorInfo = extractFcmError(responseJson, responseText);
  return {
    ok: false,
    errorMessage: errorInfo.message,
    disableDevice: errorInfo.disableDevice,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const dispatcherSecret = Deno.env.get('PUSH_DISPATCHER_SECRET');
  if (!dispatcherSecret) {
    return jsonResponse({ error: 'Missing PUSH_DISPATCHER_SECRET' }, 500);
  }

  const auth = req.headers.get('Authorization') || '';
  if (auth !== `Bearer ${dispatcherSecret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || null;
  const firebaseServiceAccount = getFirebaseServiceAccount();

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (_e) {
    body = {};
  }

  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);

  const { data: rows, error: fetchError } = await supabase
    .from('notification_push_queue')
    .select(
      'push_queue_id, push_device_id, push_provider, push_token, expo_push_token, title, message, payload, attempts, status, next_attempt_at, device:user_push_devices(is_active, app_version)',
    )
    .in('status', ['PENDING', 'RETRY'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchError) {
    return jsonResponse({ error: 'Failed to fetch queue', details: fetchError.message }, 500);
  }

  const queue = Array.isArray(rows) ? rows : [];
  if (!queue.length) {
    return jsonResponse({ success: true, processed: 0, sent: 0, failed: 0, retried: 0, skipped: 0 });
  }

  let sent = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  for (const row of queue) {
    const attempts = Number(row.attempts || 0);
    const nowIso = new Date().toISOString();
    const claimUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Claim atomico para evitar duplicados cuando hay ejecuciones concurrentes del dispatcher.
    const { data: claimed, error: claimError } = await supabase
      .from('notification_push_queue')
      .update({ next_attempt_at: claimUntil })
      .eq('push_queue_id', row.push_queue_id)
      .eq('attempts', attempts)
      .in('status', ['PENDING', 'RETRY'])
      .lte('next_attempt_at', nowIso)
      .select('push_queue_id')
      .maybeSingle();

    if (claimError || !claimed) {
      skipped += 1;
      continue;
    }

    const device = (row?.device || {}) as { is_active?: boolean; app_version?: string };
    const appVersion = String(device?.app_version || '').toLowerCase();
    const isDeviceInactive = device.is_active === false;
    const isExpoGoDevice = appVersion.includes('(expo)');
    if (isDeviceInactive) {
      await supabase
        .from('notification_push_queue')
        .update({
          status: 'FAILED',
          attempts: attempts + 1,
          last_error: 'Push device inactive',
        })
        .eq('push_queue_id', row.push_queue_id);
      failed += 1;
      continue;
    }
    if (isExpoGoDevice) {
      if (row.push_device_id) {
        await supabase
          .from('user_push_devices')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('push_device_id', row.push_device_id);
      }
      await supabase
        .from('notification_push_queue')
        .update({
          status: 'FAILED',
          attempts: attempts + 1,
          last_error: 'Expo Go token disabled. Re-register from native build.',
        })
        .eq('push_queue_id', row.push_queue_id);
      failed += 1;
      continue;
    }

    try {
      const provider = String(row.push_provider || 'expo').toLowerCase();
      const hasExpoToken = String(row.expo_push_token || '').trim() !== '';
      const hasPushToken = String(row.push_token || '').trim() !== '';

      let sendResult: {
        ok: boolean;
        errorMessage: string;
        disableDevice: boolean;
      };

      if (provider === 'fcm') {
        if (!hasPushToken) {
          sendResult = {
            ok: false,
            errorMessage: 'FCM token vacio en cola',
            disableDevice: true,
          };
        } else if (!firebaseServiceAccount) {
          sendResult = {
            ok: false,
            errorMessage: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON for FCM dispatch',
            disableDevice: false,
          };
        } else {
          sendResult = await sendViaFcm(row as Record<string, unknown>, firebaseServiceAccount);
        }
      } else {
        if (!hasExpoToken) {
          sendResult = {
            ok: false,
            errorMessage: 'Expo token vacio en cola',
            disableDevice: true,
          };
        } else {
          sendResult = await sendViaExpo(row as Record<string, unknown>, expoAccessToken);
        }
      }

      if (sendResult.ok) {
        await supabase
          .from('notification_push_queue')
          .update({
            status: 'SENT',
            attempts: attempts + 1,
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('push_queue_id', row.push_queue_id);
        sent += 1;
        continue;
      }

      if (sendResult.disableDevice && row.push_device_id) {
        await supabase
          .from('user_push_devices')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('push_device_id', row.push_device_id);
      }

      const nextAttempts = attempts + 1;
      if (nextAttempts >= 5 || sendResult.disableDevice) {
        await supabase
          .from('notification_push_queue')
          .update({
            status: 'FAILED',
            attempts: nextAttempts,
            last_error: sendResult.errorMessage || 'Push failed',
          })
          .eq('push_queue_id', row.push_queue_id);
        failed += 1;
      } else {
        const nextAt = new Date(Date.now() + getBackoffMinutes(nextAttempts) * 60 * 1000).toISOString();
        await supabase
          .from('notification_push_queue')
          .update({
            status: 'RETRY',
            attempts: nextAttempts,
            last_error: sendResult.errorMessage || 'Push retry',
            next_attempt_at: nextAt,
          })
          .eq('push_queue_id', row.push_queue_id);
        retried += 1;
      }
    } catch (error) {
      const nextAttempts = attempts + 1;
      const errText = String((error as { message?: unknown })?.message || 'Push dispatch error').slice(0, 500);
      const nextAt = new Date(Date.now() + getBackoffMinutes(nextAttempts) * 60 * 1000).toISOString();

      await supabase
        .from('notification_push_queue')
        .update({
          status: nextAttempts >= 5 ? 'FAILED' : 'RETRY',
          attempts: nextAttempts,
          last_error: errText,
          next_attempt_at: nextAt,
        })
        .eq('push_queue_id', row.push_queue_id);

      if (nextAttempts >= 5) failed += 1;
      else retried += 1;
    }
  }

  return jsonResponse({
    success: true,
    processed: queue.length,
    sent,
    failed,
    retried,
    skipped,
  });
});
