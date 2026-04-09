import { supabase } from '../lib/supabase';

const PRODUCT_MEDIA_BUCKET = 'productmedia';
const PRODUCT_MEDIA_AI_EDGE_FUNCTION =
  process.env.EXPO_PUBLIC_PRODUCT_PHOTO_ANALYZER_EDGE_FUNCTION || 'product-photo-analyzer';

export const MAX_PRODUCT_PHOTOS = 5;
export const PRODUCT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_PHOTO_SIGNED_URL_TTL = 60 * 60 * 24 * 7;

const UPLOAD_WIDTHS = [1600, 1400, 1280, 1080];
const UPLOAD_QUALITIES = [0.82, 0.72, 0.62, 0.52];
const AI_WIDTHS = [1400, 1200, 1000, 800];
const AI_QUALITIES = [0.35, 0.24, 0.16, 0.12];
const AI_MAX_BYTES = 980 * 1024;

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function estimateBase64Bytes(base64) {
  const raw = String(base64 || '');
  if (!raw) return 0;
  return Math.ceil((raw.length * 3) / 4);
}

function randomToken(length = 8) {
  return Math.random().toString(36).slice(2, 2 + length);
}

function base64ToArrayBuffer(base64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = String(base64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const bufferLength = clean.endsWith('==')
    ? (clean.length * 3) / 4 - 2
    : clean.endsWith('=')
      ? (clean.length * 3) / 4 - 1
      : (clean.length * 3) / 4;
  const bytes = new Uint8Array(bufferLength);

  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const encoded1 = alphabet.indexOf(clean[i]);
    const encoded2 = alphabet.indexOf(clean[i + 1]);
    const encoded3 = alphabet.indexOf(clean[i + 2]);
    const encoded4 = alphabet.indexOf(clean[i + 3]);

    const chunk = (encoded1 << 18) | (encoded2 << 12) | ((Math.max(encoded3, 0) & 63) << 6) | (Math.max(encoded4, 0) & 63);

    bytes[byteIndex++] = (chunk >> 16) & 255;
    if (clean[i + 2] !== '=') {
      bytes[byteIndex++] = (chunk >> 8) & 255;
    }
    if (clean[i + 3] !== '=') {
      bytes[byteIndex++] = chunk & 255;
    }
  }

  return bytes.buffer;
}

async function extractInvokeError(error) {
  const fragments = [];
  if (error?.message) fragments.push(String(error.message));
  const context = error?.context;
  if (!context) return fragments.join(' | ') || 'Error desconocido';

  try {
    const response = typeof context.clone === 'function' ? context.clone() : context;
    if (response?.status) fragments.push(`HTTP ${response.status}`);
    let bodyJson = null;
    if (typeof response?.json === 'function') {
      bodyJson = await response.json().catch(() => null);
    }
    if (bodyJson?.error) fragments.push(String(bodyJson.error));
    if (bodyJson?.details) fragments.push(String(bodyJson.details));
  } catch (_error) {
    // no-op
  }

  const unique = Array.from(new Set(fragments.filter(Boolean)));
  return unique.join(' | ') || 'Error desconocido';
}

async function pickImageAsset(source = 'library') {
  let ImagePicker;
  try {
    ImagePicker = require('expo-image-picker');
  } catch (_error) {
    return { success: false, error: 'Falta expo-image-picker. Instala la dependencia y recompila la app.' };
  }

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission?.granted) {
      return { success: false, error: 'Permiso de cámara denegado.' };
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission?.granted) {
      return { success: false, error: 'Permiso de galería denegado.' };
    }
  }

  const pickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? 'images',
    allowsEditing: false,
    quality: 1,
    base64: false,
    exif: false,
  };

  const capture = source === 'camera'
    ? await ImagePicker.launchCameraAsync(pickerOptions)
    : await ImagePicker.launchImageLibraryAsync(pickerOptions);

  if (capture?.canceled) {
    return { success: false, cancelled: true };
  }

  const asset = capture?.assets?.[0];
  if (!asset?.uri) {
    return { success: false, error: 'No se pudo obtener la imagen seleccionada.' };
  }

  return { success: true, data: asset };
}

async function buildOptimizedImage(asset, widths, qualities, maxBytes) {
  if (!asset?.uri) {
    return { success: false, error: 'No se pudo obtener la URI de la imagen.' };
  }

  let ImageManipulator;
  try {
    ImageManipulator = require('expo-image-manipulator');
  } catch (_error) {
    return { success: false, error: 'Falta expo-image-manipulator. Instala la dependencia y recompila la app.' };
  }

  for (const width of widths) {
    for (const quality of qualities) {
      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width } }],
        {
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );

      const sizeBytes = estimateBase64Bytes(result?.base64);
      if (result?.base64 && sizeBytes > 0 && sizeBytes <= maxBytes) {
        return {
          success: true,
          data: {
            base64: result.base64,
            mimeType: 'image/jpeg',
            sizeBytes,
            width: Number(result.width || asset.width || 0) || null,
            height: Number(result.height || asset.height || 0) || null,
            uri: result.uri || asset.uri,
          },
        };
      }
    }
  }

  return {
    success: false,
    error: `No se pudo optimizar la imagen por debajo de ${Math.round(maxBytes / 1024 / 1024)}MB.`,
  };
}

function normalizeAiData(payload) {
  return {
    ai_status: payload ? 'READY' : 'FAILED',
    ai_summary: payload
      ? [
          payload.suggested_name ? `Nombre sugerido: ${payload.suggested_name}` : null,
          payload.suggested_category ? `Categoría sugerida: ${payload.suggested_category}` : null,
          payload.suggested_brand ? `Marca detectada: ${payload.suggested_brand}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null
      : null,
    ai_detected_name: normalizeText(payload?.suggested_name),
    ai_detected_brand: normalizeText(payload?.suggested_brand),
    ai_detected_category: normalizeText(payload?.suggested_category),
    ai_suggested_description: normalizeText(payload?.suggested_description),
    ai_labels: Array.isArray(payload?.labels) ? payload.labels : [],
    ai_warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
  };
}

async function signMediaRows(rows, expiresIn = PRODUCT_PHOTO_SIGNED_URL_TTL) {
  const source = Array.isArray(rows) ? rows : [];
  if (!source.length) return [];

  return Promise.all(
    source.map(async (row) => {
      const { data: signedData, error } = await supabase
        .storage
        .from(PRODUCT_MEDIA_BUCKET)
        .createSignedUrl(row.storage_path, expiresIn);

      return {
        ...row,
        signed_url: error ? null : signedData?.signedUrl || null,
      };
    }),
  );
}

export async function listProductMedia({ tenantId, productId, signedUrlExpiresIn = PRODUCT_PHOTO_SIGNED_URL_TTL } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.', data: [] };
  if (!productId) return { success: false, error: 'productId es requerido.', data: [] };

  try {
    const { data, error } = await supabase
      .from('product_media')
      .select(`
        media_id,
        tenant_id,
        product_id,
        variant_id,
        storage_path,
        mime_type,
        size_bytes,
        width,
        height,
        sort_order,
        is_cover,
        ai_status,
        ai_summary,
        ai_detected_name,
        ai_detected_brand,
        ai_detected_category,
        ai_suggested_description,
        ai_labels,
        ai_warnings,
        created_at,
        updated_at
      `)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .order('is_cover', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;

    const signedRows = await signMediaRows(data || [], signedUrlExpiresIn);
    return { success: true, data: signedRows };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function uploadProductPhoto({
  tenantId,
  productId,
  source = 'library',
  currentCount = 0,
  analyzeWithAi = true,
} = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' };
  if (!productId) return { success: false, error: 'productId es requerido.' };
  if (Number(currentCount || 0) >= MAX_PRODUCT_PHOTOS) {
    return { success: false, error: `Máximo ${MAX_PRODUCT_PHOTOS} fotos por producto.` };
  }

  const picked = await pickImageAsset(source);
  if (!picked.success) {
    if (picked.cancelled) return { success: false, cancelled: true };
    return picked;
  }

  const optimizedForUpload = await buildOptimizedImage(
    picked.data,
    UPLOAD_WIDTHS,
    UPLOAD_QUALITIES,
    PRODUCT_PHOTO_MAX_BYTES,
  );
  if (!optimizedForUpload.success) {
    return optimizedForUpload;
  }

  const uploadData = optimizedForUpload.data;
  const storagePath = `${tenantId}/${productId}/${Date.now()}_${randomToken(10)}.jpg`;
  let uploadedToStorage = false;

  try {
    const { error: uploadError } = await supabase
      .storage
      .from(PRODUCT_MEDIA_BUCKET)
      .upload(storagePath, base64ToArrayBuffer(uploadData.base64), {
        contentType: uploadData.mimeType,
        upsert: false,
      });

    if (uploadError) throw uploadError;
    uploadedToStorage = true;

    const insertPayload = {
      tenant_id: tenantId,
      product_id: productId,
      storage_path: storagePath,
      mime_type: uploadData.mimeType,
      size_bytes: uploadData.sizeBytes,
      width: uploadData.width,
      height: uploadData.height,
      sort_order: Number(currentCount || 0),
      is_cover: Number(currentCount || 0) === 0,
      ai_status: analyzeWithAi ? 'PROCESSING' : 'NOT_ANALYZED',
    };

    const { data: inserted, error: insertError } = await supabase
      .from('product_media')
      .insert(insertPayload)
      .select(`
        media_id,
        tenant_id,
        product_id,
        variant_id,
        storage_path,
        mime_type,
        size_bytes,
        width,
        height,
        sort_order,
        is_cover,
        ai_status,
        ai_summary,
        ai_detected_name,
        ai_detected_brand,
        ai_detected_category,
        ai_suggested_description,
        ai_labels,
        ai_warnings,
        created_at,
        updated_at
      `)
      .single();

    if (insertError) throw insertError;

    let aiResult = null;
    let finalRecord = inserted;

    if (analyzeWithAi) {
      const optimizedForAi = await buildOptimizedImage(picked.data, AI_WIDTHS, AI_QUALITIES, AI_MAX_BYTES);
      if (optimizedForAi.success) {
        const { data, error } = await supabase.functions.invoke(PRODUCT_MEDIA_AI_EDGE_FUNCTION, {
          body: {
            image: optimizedForAi.data.base64,
            mime_type: optimizedForAi.data.mimeType || 'image/jpeg',
            model: process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL || 'deepseek-chat',
          },
        });

        if (error) {
          const details = await extractInvokeError(error);
          const failWarnings = [`No se pudo analizar la foto con IA: ${details}`];
          const { data: updated } = await supabase
            .from('product_media')
            .update({
              ai_status: 'FAILED',
              ai_summary: null,
              ai_detected_name: null,
              ai_detected_brand: null,
              ai_detected_category: null,
              ai_suggested_description: null,
              ai_labels: [],
              ai_warnings: failWarnings,
            })
            .eq('tenant_id', tenantId)
            .eq('media_id', inserted.media_id)
            .select(`
              media_id,
              tenant_id,
              product_id,
              variant_id,
              storage_path,
              mime_type,
              size_bytes,
              width,
              height,
              sort_order,
              is_cover,
              ai_status,
              ai_summary,
              ai_detected_name,
              ai_detected_brand,
              ai_detected_category,
              ai_suggested_description,
              ai_labels,
              ai_warnings,
              created_at,
              updated_at
            `)
            .single();

          finalRecord = updated || {
            ...inserted,
            ai_status: 'FAILED',
            ai_warnings: failWarnings,
          };
        } else {
          aiResult = data?.data || null;
          const normalizedAi = normalizeAiData(aiResult);
          const { data: updated, error: updateAiError } = await supabase
            .from('product_media')
            .update(normalizedAi)
            .eq('tenant_id', tenantId)
            .eq('media_id', inserted.media_id)
            .select(`
              media_id,
              tenant_id,
              product_id,
              variant_id,
              storage_path,
              mime_type,
              size_bytes,
              width,
              height,
              sort_order,
              is_cover,
              ai_status,
              ai_summary,
              ai_detected_name,
              ai_detected_brand,
              ai_detected_category,
              ai_suggested_description,
              ai_labels,
              ai_warnings,
              created_at,
              updated_at
            `)
            .single();

          if (!updateAiError && updated) {
            finalRecord = updated;
          }
        }
      } else {
        const failWarnings = [optimizedForAi.error || 'No se pudo preparar la foto para IA.'];
        const { data: updated } = await supabase
          .from('product_media')
          .update({
            ai_status: 'FAILED',
            ai_summary: null,
            ai_detected_name: null,
            ai_detected_brand: null,
            ai_detected_category: null,
            ai_suggested_description: null,
            ai_labels: [],
            ai_warnings: failWarnings,
          })
          .eq('tenant_id', tenantId)
          .eq('media_id', inserted.media_id)
          .select(`
            media_id,
            tenant_id,
            product_id,
            variant_id,
            storage_path,
            mime_type,
            size_bytes,
            width,
            height,
            sort_order,
            is_cover,
            ai_status,
            ai_summary,
            ai_detected_name,
            ai_detected_brand,
            ai_detected_category,
            ai_suggested_description,
            ai_labels,
            ai_warnings,
            created_at,
            updated_at
          `)
          .single();

        finalRecord = updated || {
          ...inserted,
          ai_status: 'FAILED',
          ai_warnings: failWarnings,
        };
      }
    }

    const signedRows = await signMediaRows([finalRecord]);
    return {
      success: true,
      data: signedRows[0] || finalRecord,
      ai: aiResult,
    };
  } catch (error) {
    if (uploadedToStorage) {
      await supabase.storage.from(PRODUCT_MEDIA_BUCKET).remove([storagePath]).catch(() => null);
    }
    return { success: false, error: error.message };
  }
}

export async function setProductCover({ tenantId, productId, mediaId } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' };
  if (!productId) return { success: false, error: 'productId es requerido.' };
  if (!mediaId) return { success: false, error: 'mediaId es requerido.' };

  try {
    const { data, error } = await supabase
      .from('product_media')
      .update({ is_cover: true })
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .eq('media_id', mediaId)
      .select(`
        media_id,
        tenant_id,
        product_id,
        variant_id,
        storage_path,
        mime_type,
        size_bytes,
        width,
        height,
        sort_order,
        is_cover,
        ai_status,
        ai_summary,
        ai_detected_name,
        ai_detected_brand,
        ai_detected_category,
        ai_suggested_description,
        ai_labels,
        ai_warnings,
        created_at,
        updated_at
      `)
      .single();

    if (error) throw error;
    const signedRows = await signMediaRows([data]);
    return { success: true, data: signedRows[0] || data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteProductPhoto({ tenantId, mediaId } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' };
  if (!mediaId) return { success: false, error: 'mediaId es requerido.' };

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('product_media')
      .select('media_id, tenant_id, product_id, storage_path')
      .eq('tenant_id', tenantId)
      .eq('media_id', mediaId)
      .single();

    if (fetchError) throw fetchError;

    const { error: deleteRowError } = await supabase
      .from('product_media')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('media_id', mediaId);

    if (deleteRowError) throw deleteRowError;

    let warning = null;
    if (existing?.storage_path) {
      const { error: storageError } = await supabase
        .storage
        .from(PRODUCT_MEDIA_BUCKET)
        .remove([existing.storage_path]);
      if (storageError) {
        warning = `La metadata fue eliminada pero no se pudo borrar el archivo físico: ${storageError.message}`;
      }
    }

    return { success: true, data: existing, warning };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
