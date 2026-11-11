import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const RUNTIME_ERROR_KEY = '@ofirone/runtime_error_v1';

let runtimeErrorListener = null;
let globalHandlerInstalled = false;

function normalizeError(error) {
  if (!error) {
    return {
      name: 'UnknownError',
      message: 'Error desconocido',
      stack: '',
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Error sin mensaje',
      stack: error.stack || '',
    };
  }

  return {
    name: 'NonErrorThrowable',
    message: typeof error === 'string' ? error : JSON.stringify(error),
    stack: '',
  };
}

function createPayload(error, options = {}) {
  const normalized = normalizeError(error);
  return {
    ...normalized,
    isFatal: options.isFatal === true,
    origin: options.origin || 'runtime',
    timestamp: new Date().toISOString(),
    platform: Platform.OS,
    appVersion: '1.0.0',
    extra: options.extra || null,
  };
}

export async function saveRuntimeError(error, options = {}) {
  const payload = createPayload(error, options);
  try {
    await AsyncStorage.setItem(RUNTIME_ERROR_KEY, JSON.stringify(payload));
  } catch (_error) {
    // no-op: if storage fails we still want the in-memory notifier
  }
  if (typeof runtimeErrorListener === 'function') {
    runtimeErrorListener(payload);
  }
  return payload;
}

export async function readRuntimeError() {
  try {
    const raw = await AsyncStorage.getItem(RUNTIME_ERROR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export async function clearRuntimeError() {
  try {
    await AsyncStorage.removeItem(RUNTIME_ERROR_KEY);
  } catch (_error) {
    // no-op
  }
}

export function setRuntimeErrorListener(listener) {
  runtimeErrorListener = typeof listener === 'function' ? listener : null;
}

export function installGlobalRuntimeErrorHandler() {
  if (globalHandlerInstalled) return;
  globalHandlerInstalled = true;

  const errorUtils = globalThis.ErrorUtils;
  if (!errorUtils?.getGlobalHandler || !errorUtils?.setGlobalHandler) return;

  const previousHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    saveRuntimeError(error, { isFatal, origin: 'global_js' }).catch(() => {});
    if (typeof previousHandler === 'function') {
      previousHandler(error, isFatal);
    }
  });
}
