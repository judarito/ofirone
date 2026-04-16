import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  GUIDED_ROUTES,
  HELP_FAQS,
  RECOMMENDED_SETUP_STEPS,
  SETUP_OPTIONS,
} from '../constants/setupGuideContent';
import { buildSetupOverall, loadSetupReadiness } from '../services/setupAssistant.service';

function ProgressBar({ value = 0, color = '#22c55e', trackColor = '#1e293b', isLightTheme = false }) {
  const clamped = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <View style={[styles.progressTrack, isLightTheme && styles.progressTrackLight, { backgroundColor: trackColor }]}>
      <View style={[styles.progressFill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

function StepBadge({ step, isLightTheme }) {
  const complete = step.completed === true;
  return (
    <View
      style={[
        styles.stepBadge,
        isLightTheme && styles.stepBadgeLight,
        complete && styles.stepBadgeComplete,
      ]}
    >
      <Text
        style={[
          styles.stepBadgeText,
          isLightTheme && styles.stepBadgeTextLight,
          complete && styles.stepBadgeTextComplete,
        ]}
        numberOfLines={2}
      >
        {step.title}
      </Text>
    </View>
  );
}

export default function SetupScreen({
  tenant = null,
  onOpenScreen,
  themeMode = 'dark',
  offlineMode = false,
}) {
  const isLightTheme = themeMode === 'light';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [processes, setProcesses] = useState([]);
  const [source, setSource] = useState('default');

  const overall = useMemo(() => buildSetupOverall(processes), [processes]);

  const refreshReadiness = async () => {
    if (!tenant?.tenant_id) {
      setProcesses([]);
      setSource('default');
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    const result = await loadSetupReadiness({
      tenantId: tenant.tenant_id,
      offlineMode,
    });

    if (!result.success) {
      setProcesses([]);
      setSource('default');
      setError(result.error || 'No fue posible evaluar el estado de arranque.');
      setLoading(false);
      return;
    }

    setProcesses(result.data?.processes || []);
    setSource(result.source || 'server');
    setError(result.warning || '');
    setLoading(false);
  };

  useEffect(() => {
    refreshReadiness();
  }, [offlineMode, tenant?.tenant_id]);

  const summaryMessage = overall.totalProcesses === 0
    ? 'Aquí centralizamos la puesta en marcha operativa del tenant.'
    : overall.isFullyOperational
      ? 'Los procesos operativos principales ya están listos para usar en mobile.'
      : `Llevas ${overall.completedRequired}/${overall.requiredSteps} pasos esenciales.`;

  const continueToStep = (stepOrProcess) => {
    const screen = stepOrProcess?.screen || null;
    const webOnly = stepOrProcess?.webOnly === true;

    if (webOnly && !screen) {
      Alert.alert(
        'Continúa en web',
        'Este frente todavía requiere la app web para completarse por completo.',
      );
      return;
    }

    if (webOnly) {
      Alert.alert(
        'Paridad parcial',
        'Te llevamos al módulo base en mobile, pero el flujo avanzado de este frente sigue concentrado en web.',
      );
    }

    if (screen) {
      onOpenScreen?.(screen);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.heroCard, isLightTheme && styles.heroCardLight]}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroCopy}>
            <Text style={[styles.eyebrow, isLightTheme && styles.eyebrowLight]}>Onboarding operativo</Text>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>Configuración inicial</Text>
            <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
              Seguimos el estado real del tenant para dejar ventas, compras, caja e inventario listos desde mobile.
            </Text>
          </View>

          <Pressable
            style={[styles.refreshBtn, isLightTheme && styles.refreshBtnLight, loading && styles.refreshBtnDisabled]}
            disabled={loading}
            onPress={refreshReadiness}
          >
            <Ionicons name="refresh" size={16} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
            <Text style={[styles.refreshBtnText, isLightTheme && styles.refreshBtnTextLight]}>
              Actualizar
            </Text>
          </Pressable>
        </View>

        <View style={styles.heroStatsRow}>
          <View style={[styles.statCard, isLightTheme && styles.statCardLight]}>
            <Text style={[styles.statLabel, isLightTheme && styles.statLabelLight]}>Progreso esencial</Text>
            <Text style={[styles.statValue, isLightTheme && styles.statValueLight]}>
              {overall.completedRequired}/{overall.requiredSteps || 0}
            </Text>
          </View>
          <View style={[styles.statCard, isLightTheme && styles.statCardLight]}>
            <Text style={[styles.statLabel, isLightTheme && styles.statLabelLight]}>Procesos operativos</Text>
            <Text style={[styles.statValue, isLightTheme && styles.statValueLight]}>
              {overall.operationalProcesses}/{overall.totalProcesses || 0}
            </Text>
          </View>
          <View style={[styles.statCard, isLightTheme && styles.statCardLight]}>
            <Text style={[styles.statLabel, isLightTheme && styles.statLabelLight]}>Estado</Text>
            <Text style={[styles.statValue, isLightTheme && styles.statValueLight]}>
              {overall.progressPercentage || 0}%
            </Text>
          </View>
        </View>

        <ProgressBar
          value={overall.progressPercentage || 0}
          color={overall.isFullyOperational ? '#22c55e' : '#38bdf8'}
          trackColor={isLightTheme ? '#dbe7f6' : '#15243c'}
          isLightTheme={isLightTheme}
        />

        <Text style={[styles.summaryCopy, isLightTheme && styles.summaryCopyLight]}>{summaryMessage}</Text>
        {source && source !== 'server' ? (
          <Text style={[styles.metaCopy, isLightTheme && styles.metaCopyLight]}>
            Fuente actual: {source === 'cache' ? 'caché offline' : source}.
          </Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      {loading ? (
        <View style={[styles.loadingCard, isLightTheme && styles.loadingCardLight]}>
          <ActivityIndicator color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
          <Text style={[styles.loadingText, isLightTheme && styles.loadingTextLight]}>
            Evaluando checklist operativo...
          </Text>
        </View>
      ) : null}

      <View style={[styles.helperCard, isLightTheme && styles.helperCardLight]}>
        <Text style={[styles.helperTitle, isLightTheme && styles.helperTitleLight]}>Siguiente acción</Text>
        {overall.nextAction ? (
          <>
            <Text style={[styles.nextActionTitle, isLightTheme && styles.nextActionTitleLight]}>
              {overall.nextAction.processTitle}: {overall.nextAction.title}
            </Text>
            <Text style={[styles.helperCopy, isLightTheme && styles.helperCopyLight]}>
              {overall.nextAction.description}
            </Text>
            <Pressable
              style={[styles.primaryBtn, overall.nextAction.webOnly && styles.primaryBtnWarning]}
              onPress={() => continueToStep(overall.nextAction)}
            >
              <Text style={styles.primaryBtnText}>{overall.nextAction.label || 'Continuar'}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={[styles.helperCopy, isLightTheme && styles.helperCopyLight]}>
            Cuando todos los pasos esenciales estén completos, aquí verás el siguiente movimiento recomendado.
          </Text>
        )}
      </View>

      {processes.length ? (
        <View style={styles.processGrid}>
          {processes.map((process) => (
            <View key={process.id} style={[styles.processCard, isLightTheme && styles.processCardLight]}>
              <View style={styles.processHeader}>
                <View style={[styles.iconBadge, isLightTheme && styles.iconBadgeLight, { borderColor: `${process.stateColor}66` }]}>
                  <Ionicons name={process.icon || 'checkmark-circle-outline'} size={18} color={process.stateColor} />
                </View>
                <View style={styles.processHeaderCopy}>
                  <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>{process.title}</Text>
                  <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]}>{process.description}</Text>
                </View>
              </View>

              <View style={[styles.statusPill, { borderColor: `${process.stateColor}66`, backgroundColor: `${process.stateColor}18` }]}>
                <Text style={[styles.statusPillText, { color: process.stateColor }]}>{process.stateLabel}</Text>
              </View>

              <View style={styles.progressMetaRow}>
                <Text style={[styles.progressMetaText, isLightTheme && styles.progressMetaTextLight]}>
                  {process.completedRequired}/{process.requiredStepsCount} esenciales
                </Text>
                <Text style={[styles.progressMetaText, isLightTheme && styles.progressMetaTextLight]}>
                  {process.progressPercentage}%
                </Text>
              </View>
              <ProgressBar
                value={process.progressPercentage}
                color={process.stateColor}
                trackColor={isLightTheme ? '#e2e8f0' : '#122033'}
                isLightTheme={isLightTheme}
              />

              <Text style={[styles.stepsLabel, isLightTheme && styles.stepsLabelLight]}>Checklist</Text>
              <View style={styles.stepsWrap}>
                {(process.steps || []).map((step) => (
                  <StepBadge key={step.id} step={step} isLightTheme={isLightTheme} />
                ))}
              </View>

              <Text style={[styles.helperCopy, isLightTheme && styles.helperCopyLight]}>
                {process.nextStep
                  ? `Siguiente paso: ${process.nextStep.title}`
                  : 'Proceso completo en mobile.'}
              </Text>

              <Pressable
                style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]}
                onPress={() => continueToStep(process.nextStep || process)}
              >
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>
                  {process.nextStep?.actionLabel || 'Abrir proceso'}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.helperCard, isLightTheme && styles.helperCardLight]}>
        <Text style={[styles.helperTitle, isLightTheme && styles.helperTitleLight]}>Módulos de configuración</Text>
        <Text style={[styles.helperCopy, isLightTheme && styles.helperCopyLight]}>
          Accesos directos para administrar el tenant sin recorrer todo el menú.
        </Text>
        <View style={styles.gridWrap}>
          {SETUP_OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              style={[styles.card, isLightTheme && styles.cardLight]}
              onPress={() => onOpenScreen?.(option.key)}
            >
              <View
                style={[
                  styles.iconBadge,
                  isLightTheme && styles.iconBadgeLight,
                  {
                    backgroundColor: `${option.accent}20`,
                    borderColor: `${option.accent}66`,
                  },
                ]}
              >
                <Ionicons name={option.icon} size={18} color={option.accent} />
              </View>
              <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>{option.title}</Text>
              <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]} numberOfLines={2}>
                {option.subtitle}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={[styles.cardAction, isLightTheme && styles.cardActionLight]}>Abrir módulo</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  style={[styles.chevron, isLightTheme && styles.chevronLight]}
                />
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.helperCard, isLightTheme && styles.helperCardLight]}>
        <Text style={[styles.helperTitle, isLightTheme && styles.helperTitleLight]}>Flujo recomendado</Text>
        {RECOMMENDED_SETUP_STEPS.map((step) => (
          <Text key={step} style={[styles.helperLine, isLightTheme && styles.helperLineLight]}>{step}</Text>
        ))}
      </View>

      <View style={[styles.helperCard, isLightTheme && styles.helperCardLight]}>
        <Text style={[styles.helperTitle, isLightTheme && styles.helperTitleLight]}>Rutas guiadas</Text>
        <Text style={[styles.helperCopy, isLightTheme && styles.helperCopyLight]}>
          Atajos para entrar a la operación sin recorrer todo el menú.
        </Text>
        <View style={styles.routeGrid}>
          {GUIDED_ROUTES.map((route) => (
            <Pressable
              key={route.key}
              style={[styles.routeCard, isLightTheme && styles.routeCardLight]}
              onPress={() => onOpenScreen?.(route.key)}
            >
              <View
                style={[
                  styles.routeBadge,
                  {
                    backgroundColor: `${route.accent}20`,
                    borderColor: `${route.accent}66`,
                  },
                ]}
              >
                <Ionicons name={route.icon} size={16} color={route.accent} />
              </View>
              <Text style={[styles.routeTitle, isLightTheme && styles.routeTitleLight]}>{route.title}</Text>
              <Text style={[styles.routeSubtitle, isLightTheme && styles.routeSubtitleLight]}>{route.subtitle}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.helperCard, isLightTheme && styles.helperCardLight]}>
        <Text style={[styles.helperTitle, isLightTheme && styles.helperTitleLight]}>Ayuda rápida</Text>
        <Text style={[styles.helperCopy, isLightTheme && styles.helperCopyLight]}>
          Respuestas cortas para alinear al equipo antes de entrar a operar.
        </Text>
        {HELP_FAQS.map((item) => (
          <View key={item.question} style={[styles.faqItem, isLightTheme && styles.faqItemLight]}>
            <Text style={[styles.faqQuestion, isLightTheme && styles.faqQuestionLight]}>{item.question}</Text>
            <Text style={[styles.faqAnswer, isLightTheme && styles.faqAnswerLight]}>{item.answer}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: '#060b16',
  },
  containerLight: {
    backgroundColor: '#edf2fb',
  },
  heroCard: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
  },
  heroCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  heroCopy: {
    flex: 1,
    minWidth: 220,
  },
  eyebrow: {
    color: '#8ec5ff',
    fontWeight: '800',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  eyebrowLight: {
    color: '#235ea9',
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22, marginTop: 6 },
  titleLight: { color: '#0f172a' },
  subtitle: { color: '#94a3b8', marginTop: 6, fontSize: 13, lineHeight: 19 },
  subtitleLight: { color: '#475569' },
  refreshBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27446c',
    backgroundColor: '#0b1220',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshBtnLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#f8fbff',
  },
  refreshBtnDisabled: {
    opacity: 0.55,
  },
  refreshBtnText: {
    color: '#93c5fd',
    fontWeight: '700',
    fontSize: 12,
  },
  refreshBtnTextLight: {
    color: '#1d4ed8',
  },
  heroStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#20385c',
    backgroundColor: '#101b31',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statCardLight: {
    borderColor: '#d8e3f3',
    backgroundColor: '#f8fbff',
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statLabelLight: {
    color: '#64748b',
  },
  statValue: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  statValueLight: {
    color: '#0f172a',
  },
  progressTrack: {
    marginTop: 14,
    height: 12,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressTrackLight: {},
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  summaryCopy: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  summaryCopyLight: {
    color: '#334155',
  },
  metaCopy: {
    color: '#7dd3fc',
    fontSize: 12,
    marginTop: 4,
  },
  metaCopyLight: {
    color: '#235ea9',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },
  loadingCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 18,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  loadingCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  loadingText: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  loadingTextLight: { color: '#334155' },
  helperCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
  },
  helperCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  helperTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '800', marginBottom: 6 },
  helperTitleLight: { color: '#0f172a' },
  helperCopy: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginBottom: 10 },
  helperCopyLight: { color: '#64748b' },
  nextActionTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  nextActionTitleLight: {
    color: '#0f172a',
  },
  primaryBtn: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryBtnWarning: {
    backgroundColor: '#d97706',
  },
  primaryBtnText: {
    color: '#eff6ff',
    fontWeight: '800',
    fontSize: 13,
  },
  processGrid: {
    marginTop: 10,
    gap: 10,
  },
  processCard: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
  },
  processCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  processHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  processHeaderCopy: {
    flex: 1,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    backgroundColor: '#0b1220',
  },
  iconBadgeLight: {
    backgroundColor: '#f8fbff',
    borderColor: '#d5e2f4',
  },
  cardTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 15 },
  cardTitleLight: { color: '#0f172a' },
  cardSubtitle: { color: '#94a3b8', marginTop: 4, fontSize: 12, lineHeight: 16 },
  cardSubtitleLight: { color: '#64748b' },
  statusPill: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  progressMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  progressMetaText: {
    color: '#9fb7dc',
    fontSize: 12,
    fontWeight: '600',
  },
  progressMetaTextLight: {
    color: '#47638b',
  },
  stepsLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepsLabelLight: {
    color: '#334155',
  },
  stepsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stepBadge: {
    minWidth: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#263d61',
    backgroundColor: '#101a2e',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  stepBadgeLight: {
    borderColor: '#d8e3f3',
    backgroundColor: '#f8fbff',
  },
  stepBadgeComplete: {
    borderColor: '#22c55e66',
    backgroundColor: '#14532d22',
  },
  stepBadgeText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  stepBadgeTextLight: {
    color: '#0f172a',
  },
  stepBadgeTextComplete: {
    color: '#bbf7d0',
  },
  secondaryBtn: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2c4f7d',
    backgroundColor: '#0c1627',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryBtnLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#f8fbff',
  },
  secondaryBtnText: {
    color: '#93c5fd',
    fontWeight: '800',
    fontSize: 13,
  },
  secondaryBtnTextLight: {
    color: '#235ea9',
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
    minHeight: 148,
    width: '48%',
  },
  cardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  cardFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  cardAction: { color: '#8ec5ff', fontWeight: '700', fontSize: 11, textTransform: 'uppercase' },
  cardActionLight: { color: '#235ea9' },
  chevron: { color: '#60a5fa' },
  chevronLight: { color: '#235ea9' },
  helperLine: { color: '#9fb7dc', fontSize: 13, marginTop: 2 },
  helperLineLight: { color: '#47638b' },
  routeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  routeCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#101a2e',
    padding: 12,
  },
  routeCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#f8fbff',
  },
  routeBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  routeTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '800' },
  routeTitleLight: { color: '#0f172a' },
  routeSubtitle: { color: '#94a3b8', fontSize: 12, marginTop: 4, lineHeight: 16 },
  routeSubtitleLight: { color: '#64748b' },
  faqItem: {
    borderTopWidth: 1,
    borderTopColor: '#1f3350',
    paddingTop: 10,
    marginTop: 10,
  },
  faqItemLight: {
    borderTopColor: '#dde7f6',
  },
  faqQuestion: { color: '#e2e8f0', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  faqQuestionLight: { color: '#0f172a' },
  faqAnswer: { color: '#94a3b8', fontSize: 12, lineHeight: 18 },
  faqAnswerLight: { color: '#64748b' },
});
