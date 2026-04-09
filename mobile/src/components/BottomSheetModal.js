import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useAndroidBottomInset } from '../lib/useAndroidBottomInset';

export default function BottomSheetModal({
  visible,
  onClose,
  children,
  footer = null,
  themeMode = 'dark',
  maxHeight = '90%',
  animationType = 'slide',
  dismissOnBackdropPress = true,
  scrollable = true,
  keyboardVerticalOffset = 0,
  overlayStyle = null,
  sheetStyle = null,
  contentContainerStyle = null,
}) {
  const isLightTheme = themeMode === 'light';
  const bottomInset = useAndroidBottomInset();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return undefined;
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow = (event) => {
      const nextHeight = Number(event?.endCoordinates?.height || 0);
      setKeyboardHeight(nextHeight > 0 ? nextHeight : 0);
    };

    const handleKeyboardHide = () => {
      setKeyboardHeight(0);
    };

    const showSub = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const keyboardInset = Platform.OS === 'android' ? keyboardHeight : 0;
  const resolvedBottomInset = Math.max(8, Number(bottomInset || 0));
  const resolvedSheetStyle = useMemo(
    () => [
      styles.sheet,
      isLightTheme && styles.sheetLight,
      { maxHeight, paddingBottom: 14 + resolvedBottomInset + keyboardInset },
      sheetStyle,
    ],
    [isLightTheme, keyboardInset, maxHeight, resolvedBottomInset, sheetStyle],
  );

  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose}>
      <View style={[styles.overlay, overlayStyle]}>
        {dismissOnBackdropPress ? <Pressable style={StyleSheet.absoluteFill} onPress={onClose} /> : null}
        <KeyboardAvoidingView
          style={styles.keyboardShell}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={keyboardVerticalOffset}
        >
          <View style={resolvedSheetStyle}>
            {scrollable ? (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={[styles.content, contentContainerStyle]}>{children}</View>
            )}
            {footer}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  keyboardShell: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: '#1e293b',
    paddingTop: 14,
    paddingHorizontal: 14,
  },
  sheetLight: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4ef',
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 8 },
  content: { minHeight: 0 },
});
