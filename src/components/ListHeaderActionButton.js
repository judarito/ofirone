import { Pressable, StyleSheet, Text } from 'react-native';

export default function ListHeaderActionButton({ label, onPress, themeMode = 'dark', disabled = false }) {
  const isLightTheme = themeMode === 'light';

  return (
    <Pressable
      style={[
        styles.button,
        isLightTheme && styles.buttonLight,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.text, isLightTheme && styles.textLight]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 38,
    minWidth: 110,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22c55e',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  buttonLight: {
    backgroundColor: '#22c55e',
    borderColor: '#16a34a',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  text: {
    color: '#052e16',
    fontWeight: '800',
    fontSize: 13,
  },
  textLight: {
    color: '#052e16',
  },
});
