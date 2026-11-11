import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function RuntimeDiagnosticsScreen({
  payload,
  title = 'OfirOne detecto un error',
  subtitle = 'La app guardo el detalle tecnico para diagnostico.',
  onClear,
  onRetry,
}) {
  const stack = String(payload?.stack || '').trim();

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.badge}>Modo diagnostico</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>Mensaje</Text>
          <Text style={styles.metaValue}>{payload?.message || 'Sin mensaje'}</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Origen</Text>
            <Text style={styles.metaValue}>{payload?.origin || 'desconocido'}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Fatal</Text>
            <Text style={styles.metaValue}>{payload?.isFatal ? 'si' : 'no'}</Text>
          </View>
        </View>

        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>Fecha</Text>
          <Text style={styles.metaValue}>{payload?.timestamp || 'sin fecha'}</Text>
        </View>

        {stack ? (
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Stack</Text>
            <ScrollView style={styles.stackBox}>
              <Text style={styles.stackText}>{stack}</Text>
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.actions}>
          {onRetry ? (
            <Pressable style={[styles.button, styles.primaryButton]} onPress={onRetry}>
              <Text style={[styles.buttonText, styles.primaryButtonText]}>Reintentar</Text>
            </Pressable>
          ) : null}
          {onClear ? (
            <Pressable style={styles.button} onPress={onClear}>
              <Text style={styles.buttonText}>Limpiar log</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  badge: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metaCell: {
    flex: 1,
  },
  metaBlock: {
    gap: 6,
  },
  metaLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metaValue: {
    color: '#e2e8f0',
    fontSize: 14,
  },
  stackBox: {
    maxHeight: 220,
    backgroundColor: '#020617',
    borderRadius: 12,
    padding: 12,
  },
  stackText: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
  },
  buttonText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  primaryButtonText: {
    color: '#eff6ff',
  },
});
