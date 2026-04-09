import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const UI_SOUND_SOURCES = {
  cartAdd: require('../../assets/sounds/cart-add.wav'),
};

let initPromise = null;
let initialized = false;
let players = {};

function buildPlayers() {
  return Object.entries(UI_SOUND_SOURCES).reduce((acc, [key, source]) => {
    acc[key] = createAudioPlayer(source);
    return acc;
  }, {});
}

export async function preloadUiSounds() {
  if (initialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        // interruptionMode omitido: el módulo nativo de Expo Go espera enum entero
        // pero el tipo JS envía string, causando ClassCastException en Android.
      });
      players = buildPlayers();
      initialized = true;
      return true;
    } catch (error) {
      console.warn('No fue posible inicializar sonidos UI.', error);
      players = {};
      initialized = false;
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function playUiSound(soundKey) {
  const ready = initialized ? true : await preloadUiSounds();
  if (!ready) return false;

  const player = players[soundKey];
  if (!player) return false;

  try {
    player.seekTo(0);
    player.play();
    return true;
  } catch (error) {
    console.warn(`No fue posible reproducir el sonido UI "${soundKey}".`, error);
    return false;
  }
}

export function playCartAddSound() {
  return playUiSound('cartAdd');
}

export function releaseUiSounds() {
  Object.values(players).forEach((player) => {
    try {
      player.release();
    } catch (_error) {}
  });
  players = {};
  initialized = false;
  initPromise = null;
}
