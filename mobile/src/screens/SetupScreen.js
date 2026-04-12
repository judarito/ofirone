import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  GUIDED_ROUTES,
  HELP_FAQS,
  RECOMMENDED_SETUP_STEPS,
  SETUP_OPTIONS,
} from '../constants/setupGuideContent';

export default function SetupScreen({ onOpenScreen, themeMode = 'dark' }) {
  const isLightTheme = themeMode === 'light';
  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>Configuración</Text>
      <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
        Selecciona el módulo que deseas administrar
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
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  titleLight: { color: '#0f172a' },
  subtitle: { color: '#94a3b8', marginTop: 4, marginBottom: 10, fontSize: 13 },
  subtitleLight: { color: '#475569' },
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
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 15 },
  cardTitleLight: { color: '#0f172a' },
  cardSubtitle: { color: '#94a3b8', marginTop: 4, fontSize: 12, lineHeight: 16 },
  cardSubtitleLight: { color: '#64748b' },
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
