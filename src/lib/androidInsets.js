import { Dimensions, Platform, StatusBar as RNStatusBar } from 'react-native';

export function getAndroidNavigationBottomInset() {
  if (Platform.OS !== 'android') return 0;

  const screen = Dimensions.get('screen');
  const window = Dimensions.get('window');
  const screenHeight = Number(screen?.height || 0);
  const screenWidth = Number(screen?.width || 0);
  const windowHeight = Number(window?.height || 0);
  const statusBarInset = Number(RNStatusBar.currentHeight || 0);

  if (screenHeight <= 0 || windowHeight <= 0) return 0;

  const verticalInset = Math.max(0, screenHeight - windowHeight);
  return screenHeight >= screenWidth
    ? Math.max(0, verticalInset - statusBarInset)
    : 0;
}
