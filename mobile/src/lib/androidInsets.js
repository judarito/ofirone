import { Dimensions, Platform, StatusBar as RNStatusBar } from 'react-native';

export function getAndroidNavigationBottomInset() {
  if (Platform.OS !== 'android') return 0;

  const screen = Dimensions.get('screen');
  const window = Dimensions.get('window');
  const screenHeight = Number(screen?.height || 0);
  const screenWidth = Number(screen?.width || 0);
  const windowHeight = Number(window?.height || 0);
  const windowWidth = Number(window?.width || 0);
  const statusBarInset = Number(RNStatusBar.currentHeight || 0);
  const shortestSide = Math.min(
    screenHeight || Number.MAX_SAFE_INTEGER,
    screenWidth || Number.MAX_SAFE_INTEGER,
    windowHeight || Number.MAX_SAFE_INTEGER,
    windowWidth || Number.MAX_SAFE_INTEGER,
  );
  const isLargeScreen = shortestSide >= 600;

  if (screenHeight <= 0 || windowHeight <= 0) return 0;

  const verticalInset = Math.max(0, screenHeight - windowHeight);
  const horizontalInset = Math.max(0, screenWidth - windowWidth);

  if (screenHeight >= screenWidth) {
    if (verticalInset > statusBarInset + 8) {
      return Math.max(0, verticalInset - statusBarInset);
    }
    if (verticalInset > 0) {
      return verticalInset;
    }
    return isLargeScreen ? 44 : 0;
  }

  if (horizontalInset > 0) {
    return horizontalInset;
  }

  return 0;
}
