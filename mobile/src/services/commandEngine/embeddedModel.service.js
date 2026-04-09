import * as FileSystem from 'expo-file-system/legacy';
import { Paths } from 'expo-file-system';

const DEFAULT_MODEL_URL =
  process.env.EXPO_PUBLIC_EMBEDDED_LLM_MODEL_URL ||
  'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf?download=true';
const DEFAULT_MODEL_FILE_NAME =
  process.env.EXPO_PUBLIC_EMBEDDED_LLM_MODEL_FILENAME ||
  'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf';
const MODEL_DIR = 'llm-models';
const MIN_VALID_MODEL_BYTES = 10 * 1024 * 1024;

let activeDownloadPromise = null;
let activeDownloadProgress = {
  written: 0,
  expected: 0,
  progress: 0,
};
const progressListeners = new Set();

function resolveModelFileName() {
  const text = String(DEFAULT_MODEL_FILE_NAME || '').trim();
  return text || 'qwen2.5-1.5b-instruct-q4_k_m.gguf';
}

function resolveBaseDirectory() {
  const legacy = FileSystem.documentDirectory || FileSystem.cacheDirectory || null;
  if (legacy) return legacy;

  const modern = Paths?.document?.uri || Paths?.cache?.uri || null;
  if (!modern) return null;
  return modern.endsWith('/') ? modern : `${modern}/`;
}

function safeRoundMb(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number((n / (1024 * 1024)).toFixed(2));
}

function emitProgress(snapshot = {}) {
  activeDownloadProgress = {
    written: Number(snapshot.written || 0),
    expected: Number(snapshot.expected || 0),
    progress: Number(snapshot.progress || 0),
  };

  progressListeners.forEach((listener) => {
    try {
      listener(activeDownloadProgress);
    } catch (_error) {
      // no-op
    }
  });
}

export function getEmbeddedModelPath() {
  const base = resolveBaseDirectory();
  if (!base) return null;
  return `${base}${MODEL_DIR}/${resolveModelFileName()}`;
}

export async function getEmbeddedModelStatus() {
  const modelPath = getEmbeddedModelPath();
  if (!modelPath) {
    return {
      success: false,
      available: false,
      downloading: Boolean(activeDownloadPromise),
      download_progress: activeDownloadProgress.progress,
      download_bytes_written: activeDownloadProgress.written,
      download_bytes_expected: activeDownloadProgress.expected,
      error: 'No hay directorio local disponible para modelo embebido.',
    };
  }

  try {
    const info = await FileSystem.getInfoAsync(modelPath, { size: true });
    const exists = Boolean(info?.exists);
    const bytes = Number(info?.size || 0);
    const ready = exists && bytes >= MIN_VALID_MODEL_BYTES;

    return {
      success: true,
      available: ready,
      downloading: Boolean(activeDownloadPromise),
      download_progress: activeDownloadProgress.progress,
      download_bytes_written: activeDownloadProgress.written,
      download_bytes_expected: activeDownloadProgress.expected,
      path: modelPath,
      bytes,
      mb: safeRoundMb(bytes),
      model_url: DEFAULT_MODEL_URL,
      model_file_name: resolveModelFileName(),
    };
  } catch (error) {
    return {
      success: false,
      available: false,
      downloading: Boolean(activeDownloadPromise),
      download_progress: activeDownloadProgress.progress,
      download_bytes_written: activeDownloadProgress.written,
      download_bytes_expected: activeDownloadProgress.expected,
      path: modelPath,
      error: String(error?.message || 'No se pudo leer estado del modelo embebido.'),
    };
  }
}

async function ensureModelDirectory() {
  const base = resolveBaseDirectory();
  if (!base) throw new Error('No hay directorio local para almacenar modelo embebido.');

  const dir = `${base}${MODEL_DIR}`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info?.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  return dir;
}

export async function ensureEmbeddedModelReady({ onProgress = null } = {}) {
  const progressCallback = typeof onProgress === 'function' ? onProgress : null;
  if (progressCallback) {
    progressListeners.add(progressCallback);
    if (activeDownloadPromise || activeDownloadProgress.progress > 0) {
      progressCallback(activeDownloadProgress);
    }
  }

  try {
    const status = await getEmbeddedModelStatus();
    if (status.success && status.available && status.path) {
      return {
        success: true,
        downloaded: false,
        path: status.path,
        bytes: status.bytes,
      };
    }

    if (!DEFAULT_MODEL_URL) {
      return {
        success: false,
        error: 'EXPO_PUBLIC_EMBEDDED_LLM_MODEL_URL no configurada.',
      };
    }

    if (!activeDownloadPromise) {
      emitProgress({ written: 0, expected: 0, progress: 0 });
      activeDownloadPromise = (async () => {
        try {
          await ensureModelDirectory();
          const destination = getEmbeddedModelPath();
          if (!destination) {
            return {
              success: false,
              error: 'No se pudo resolver destino del modelo embebido.',
            };
          }

          const tmpPath = `${destination}.download`;
          const tmpInfo = await FileSystem.getInfoAsync(tmpPath);
          if (tmpInfo?.exists) {
            await FileSystem.deleteAsync(tmpPath, { idempotent: true });
          }

          const download = FileSystem.createDownloadResumable(
            DEFAULT_MODEL_URL,
            tmpPath,
            {},
            (progressEvent) => {
              const written = Number(progressEvent?.totalBytesWritten || 0);
              const expected = Number(progressEvent?.totalBytesExpectedToWrite || 0);
              const ratio = expected > 0 ? written / expected : 0;
              emitProgress({
                written,
                expected,
                progress: Number(Math.max(0, Math.min(1, ratio)).toFixed(4)),
              });
            },
          );

          const result = await download.downloadAsync();
          if (!result?.uri) {
            return {
              success: false,
              error: 'Descarga de modelo embebido sin URI de salida.',
            };
          }

          const finalInfo = await FileSystem.getInfoAsync(result.uri, { size: true });
          const finalBytes = Number(finalInfo?.size || 0);
          if (finalBytes < MIN_VALID_MODEL_BYTES) {
            await FileSystem.deleteAsync(result.uri, { idempotent: true });
            return {
              success: false,
              error: 'Modelo descargado inválido (tamaño insuficiente).',
            };
          }

          const currentInfo = await FileSystem.getInfoAsync(destination);
          if (currentInfo?.exists) {
            await FileSystem.deleteAsync(destination, { idempotent: true });
          }

          await FileSystem.moveAsync({
            from: result.uri,
            to: destination,
          });

          emitProgress({
            written: finalBytes,
            expected: finalBytes,
            progress: 1,
          });

          return {
            success: true,
            downloaded: true,
            path: destination,
            bytes: finalBytes,
            mb: safeRoundMb(finalBytes),
          };
        } catch (error) {
          emitProgress({ written: 0, expected: 0, progress: 0 });
          return {
            success: false,
            error: String(error?.message || 'No se pudo descargar modelo embebido.'),
          };
        } finally {
          activeDownloadPromise = null;
        }
      })();
    }

    return await activeDownloadPromise;
  } finally {
    if (progressCallback) {
      progressListeners.delete(progressCallback);
    }
  }
}

export function warmEmbeddedModelInBackground() {
  return ensureEmbeddedModelReady();
}
