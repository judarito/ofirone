import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAndroidNavigationBottomInset } from './androidInsets';

export function useAndroidBottomInset() {
  const insets = useSafeAreaInsets();
  const [androidBottomInset, setAndroidBottomInset] = useState(getAndroidNavigationBottomInset);

  useEffect(() => {
    const updateInsets = () => {
      setAndroidBottomInset(getAndroidNavigationBottomInset());
    };

    updateInsets();
    const subscription = Dimensions.addEventListener('change', updateInsets);
    return () => {
      subscription?.remove?.();
    };
  }, []);

  return useMemo(() => {
    const safeAreaBottomInset = Math.max(0, Number(insets?.bottom || 0));
    if (Platform.OS !== 'android') return safeAreaBottomInset;
    return Math.max(androidBottomInset, safeAreaBottomInset);
  }, [androidBottomInset, insets?.bottom]);
}
