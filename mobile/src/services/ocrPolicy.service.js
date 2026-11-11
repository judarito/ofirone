const DEFAULT_MIN_INVOICE_OCR_SCORE = 10;
const DEFAULT_MIN_INVOICE_OCR_CHARS = 30;
const DEFAULT_MAX_INVOICE_OCR_NOISE_RATIO = 0.55;

const OCR_POLICY_MODES = new Set(['native-first', 'auto', 'cloud-first']);

function normalizeOcrPolicyMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return OCR_POLICY_MODES.has(normalized) ? normalized : 'native-first';
}

export function resolveOcrPolicyMode({ mode = null, offlineMode = false } = {}) {
  if (offlineMode) return 'native-first';
  return normalizeOcrPolicyMode(mode || process.env.EXPO_PUBLIC_OCR_POLICY_MODE);
}

export function scoreInvoiceOcrText(text) {
  const normalized = String(text || '').replace(/\r/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return 0;

  const usefulLines = lines.filter((line) => /[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/.test(line)).length;
  const itemSignals = lines.filter((line) => /\b(cant|cantidad|descripcion|descripción|talla)\b/i.test(line)).length;
  const qtySignals = lines.filter((line) => /^\d+\s+/.test(line)).length;
  const longWords = lines.filter((line) => /\b[a-zA-ZáéíóúÁÉÍÓÚñÑ]{5,}\b/.test(line)).length;
  const charScore = Math.min(2000, normalized.length) * 0.005;

  return usefulLines + itemSignals * 2 + qtySignals * 2 + longWords * 0.8 + charScore;
}

export function analyzeInvoiceOcrQuality(text, options = {}) {
  const normalized = String(text || '').replace(/\r/g, '\n').trim();
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const charCount = normalized.length;
  const alphaNumericCount = (normalized.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]/g) || []).length;
  const noiseRatio = charCount > 0 ? 1 - alphaNumericCount / charCount : 1;
  const score = scoreInvoiceOcrText(normalized);
  const minScore = Number(options.minScore ?? DEFAULT_MIN_INVOICE_OCR_SCORE);
  const minChars = Number(options.minChars ?? DEFAULT_MIN_INVOICE_OCR_CHARS);
  const maxNoiseRatio = Number(options.maxNoiseRatio ?? DEFAULT_MAX_INVOICE_OCR_NOISE_RATIO);

  if (!normalized) {
    return { sufficient: false, reason: 'empty_text', score, charCount, lineCount: 0, noiseRatio };
  }
  if (charCount < minChars) {
    return { sufficient: false, reason: 'too_short', score, charCount, lineCount: lines.length, noiseRatio };
  }
  if (noiseRatio > maxNoiseRatio) {
    return { sufficient: false, reason: 'too_noisy', score, charCount, lineCount: lines.length, noiseRatio };
  }
  if (score < minScore) {
    return { sufficient: false, reason: 'low_score', score, charCount, lineCount: lines.length, noiseRatio };
  }

  return { sufficient: true, reason: 'sufficient', score, charCount, lineCount: lines.length, noiseRatio };
}

export function shouldTryCloudOcr({ policyMode, offlineMode = false, nativeAvailable = false, nativeQuality = null } = {}) {
  if (offlineMode) return { shouldTry: false, reason: 'offline' };
  const mode = normalizeOcrPolicyMode(policyMode);
  if (mode === 'cloud-first') return { shouldTry: true, reason: 'diagnostic_cloud_first' };
  if (!nativeAvailable) return { shouldTry: true, reason: 'native_unavailable' };
  if (!nativeQuality?.sufficient) {
    return { shouldTry: true, reason: `native_${nativeQuality?.reason || 'failed'}` };
  }
  return { shouldTry: false, reason: 'native_sufficient' };
}
