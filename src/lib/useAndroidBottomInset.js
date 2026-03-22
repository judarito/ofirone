import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import { getAndroidNavigationBottomInset } from './androidInsets';

export function useAndroidBottomInset() {
  const [androidBottomInset, setAndroidBottomInset] = useState(getAndroidNavigationBottomInset);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const updateInsets = () => {
      setAndroidBottomInset(getAndroidNavigationBottomInset());
    };

    updateInsets();
    const subscription = Dimensions.addEventListener('change', updateInsets);

    return () => {
      subscription?.remove?.();
    };
  }, []);

  return androidBottomInset;
}
