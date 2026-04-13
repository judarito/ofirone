import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  HELP_CENTER_ARTICLES,
  HELP_CENTER_FAQS,
  HELP_CENTER_PROCESSES,
} from '../constants/helpCenterContent';
import { filterHelpArticles, getHelpProcess } from '../lib/helpCenter';

export default function HelpCenterScreen({ onOpenScreen, themeMode = 'dark' }) {
  const isLightTheme = themeMode === 'light';
  const [query, setQuery] = useState('');
  const [selectedProcess, setSelectedProcess] = useState('all');
  const [selectedSlug, setSelectedSlug] = useState(HELP_CENTER_ARTICLES[0]?.slug || '');

  const visibleArticles = useMemo(
    () => filterHelpArticles(query, selectedProcess),
    [query, selectedProcess],
  );

  const selectedArticle = useMemo(() => {
    if (visibleArticles.length === 0) return null;
    const active = visibleArticles.find((article) => article.slug === selectedSlug);
    return active || visibleArticles[0] || null;
  }, [selectedSlug, visibleArticles]);

  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.heroCard, isLightTheme && styles.heroCardLight]}>
        <Text style={[styles.eyebrow, isLightTheme && styles.eyebrowLight]}>Manual operativo</Text>
        <Text style={[styles.title, isLightTheme && styles.titleLight]}>Centro de Ayuda</Text>
        <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
          Guías compactas para operar ventas, compras, inventario, caja y administración desde mobile.
        </Text>

        <View style={[styles.searchWrap, isLightTheme && styles.searchWrapLight]}>
          <Ionicons
            name="search-outline"
            size={16}
            color={isLightTheme ? '#47638b' : '#9fb7dc'}
            style={styles.searchIcon}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar ayuda"
            placeholderTextColor={isLightTheme ? '#64748b' : '#7f95b5'}
            style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          />
        </View>

        <View style={styles.processRow}>
          {HELP_CENTER_PROCESSES.map((process) => {
            const active = selectedProcess === process.key;
            return (
              <Pressable
                key={process.key}
                onPress={() => setSelectedProcess(process.key)}
                style={[
                  styles.processChip,
                  isLightTheme && styles.processChipLight,
                  active && styles.processChipActive,
                  active && isLightTheme && styles.processChipActiveLight,
                ]}
              >
                <Text
                  style={[
                    styles.processChipText,
                    isLightTheme && styles.processChipTextLight,
                    active && styles.processChipTextActive,
                    active && isLightTheme && styles.processChipTextActiveLight,
                  ]}
                >
                  {process.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.noticeCard, isLightTheme && styles.noticeCardLight]}>
        <Ionicons name="globe-outline" size={16} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
        <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
          Contabilidad y billing avanzados siguen web-only. Mobile ahora los marca así para evitar confusión.
        </Text>
      </View>

      <View style={styles.articleList}>
        {visibleArticles.length === 0 ? (
          <View style={[styles.emptyCard, isLightTheme && styles.emptyCardLight]}>
            <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>
              No encontramos guías con ese filtro.
            </Text>
          </View>
        ) : visibleArticles.map((article) => {
          const process = getHelpProcess(article.process);
          const active = selectedArticle?.slug === article.slug;
          return (
            <Pressable
              key={article.slug}
              onPress={() => setSelectedSlug(article.slug)}
              style={[
                styles.articleCard,
                isLightTheme && styles.articleCardLight,
                active && styles.articleCardActive,
                active && isLightTheme && styles.articleCardActiveLight,
              ]}
            >
              <View style={styles.articleHeader}>
                <Text style={[styles.articleTitle, isLightTheme && styles.articleTitleLight]}>
                  {article.title}
                </Text>
                <Text style={[styles.articleMeta, isLightTheme && styles.articleMetaLight]}>
                  {process?.label || 'General'} · {article.estimatedMinutes} min
                </Text>
              </View>
              <Text style={[styles.articleSummary, isLightTheme && styles.articleSummaryLight]} numberOfLines={2}>
                {article.summary}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selectedArticle ? (
        <View style={[styles.detailCard, isLightTheme && styles.detailCardLight]}>
          <Text style={[styles.detailTitle, isLightTheme && styles.detailTitleLight]}>
            {selectedArticle.title}
          </Text>
          <Text style={[styles.detailMeta, isLightTheme && styles.detailMetaLight]}>
            {selectedArticle.audience} · {selectedArticle.estimatedMinutes} min
          </Text>
          <Text style={[styles.detailSummary, isLightTheme && styles.detailSummaryLight]}>
            {selectedArticle.summary}
          </Text>

          <View style={styles.stepsWrap}>
            {(selectedArticle.steps || []).map((step, index) => (
              <View key={step.id} style={[styles.stepCard, isLightTheme && styles.stepCardLight]}>
                <View style={styles.stepIndex}>
                  <Text style={styles.stepIndexText}>{index + 1}</Text>
                </View>
                <View style={styles.stepBody}>
                  <View style={styles.stepHeader}>
                    <Text style={[styles.stepTitle, isLightTheme && styles.stepTitleLight]}>{step.title}</Text>
                    {step.webOnly ? (
                      <View style={[styles.webBadge, isLightTheme && styles.webBadgeLight]}>
                        <Text style={[styles.webBadgeText, isLightTheme && styles.webBadgeTextLight]}>WEB</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.stepDescription, isLightTheme && styles.stepDescriptionLight]}>
                    {step.description}
                  </Text>
                  {step.screen && !step.webOnly ? (
                    <Pressable
                      onPress={() => onOpenScreen?.(step.screen)}
                      style={[styles.stepAction, isLightTheme && styles.stepActionLight]}
                    >
                      <Text style={[styles.stepActionText, isLightTheme && styles.stepActionTextLight]}>
                        Abrir módulo
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={14}
                        color={isLightTheme ? '#1d4ed8' : '#93c5fd'}
                      />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.faqCard, isLightTheme && styles.faqCardLight]}>
        <Text style={[styles.faqTitle, isLightTheme && styles.faqTitleLight]}>FAQs rápidas</Text>
        {HELP_CENTER_FAQS.map((item) => (
          <View key={item.id} style={[styles.faqItem, isLightTheme && styles.faqItemLight]}>
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
  eyebrow: {
    color: '#8ec5ff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  eyebrowLight: {
    color: '#235ea9',
  },
  title: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 24,
    marginTop: 4,
  },
  titleLight: {
    color: '#0f172a',
  },
  subtitle: {
    color: '#9fb7dc',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  subtitleLight: {
    color: '#47638b',
  },
  searchWrap: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#29456d',
    backgroundColor: '#101d34',
    borderRadius: 12,
    minHeight: 42,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchWrapLight: {
    borderColor: '#d7e4f5',
    backgroundColor: '#f8fbff',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 13,
    paddingVertical: 0,
  },
  searchInputLight: {
    color: '#0f172a',
  },
  processRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  processChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#314b72',
    backgroundColor: '#11203a',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  processChipLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#eff5ff',
  },
  processChipActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#1d4ed8',
  },
  processChipActiveLight: {
    borderColor: '#93c5fd',
    backgroundColor: '#dbeafe',
  },
  processChipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
  },
  processChipTextLight: {
    color: '#334155',
  },
  processChipTextActive: {
    color: '#f8fafc',
  },
  processChipTextActiveLight: {
    color: '#1d4ed8',
  },
  noticeCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#2c4570',
    backgroundColor: '#0f1f3a',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  noticeCardLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#f8fbff',
  },
  noticeText: {
    flex: 1,
    color: '#c7d8f3',
    fontSize: 12,
    lineHeight: 18,
  },
  noticeTextLight: {
    color: '#345070',
  },
  articleList: {
    marginTop: 10,
    gap: 8,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 14,
  },
  emptyCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  emptyText: {
    color: '#9fb7dc',
    fontSize: 12,
    textAlign: 'center',
  },
  emptyTextLight: {
    color: '#47638b',
  },
  articleCard: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
  },
  articleCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  articleCardActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#12213d',
  },
  articleCardActiveLight: {
    borderColor: '#93c5fd',
    backgroundColor: '#eef5ff',
  },
  articleHeader: {
    gap: 3,
  },
  articleTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '800',
  },
  articleTitleLight: {
    color: '#0f172a',
  },
  articleMeta: {
    color: '#8fb0d7',
    fontSize: 11,
  },
  articleMetaLight: {
    color: '#607b9f',
  },
  articleSummary: {
    color: '#9fb7dc',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  articleSummaryLight: {
    color: '#47638b',
  },
  detailCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
  },
  detailCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  detailTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 18,
  },
  detailTitleLight: {
    color: '#0f172a',
  },
  detailMeta: {
    color: '#8fb0d7',
    fontSize: 12,
    marginTop: 4,
  },
  detailMetaLight: {
    color: '#607b9f',
  },
  detailSummary: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  detailSummaryLight: {
    color: '#334155',
  },
  stepsWrap: {
    marginTop: 12,
    gap: 8,
  },
  stepCard: {
    borderWidth: 1,
    borderColor: '#29456d',
    borderRadius: 14,
    backgroundColor: '#101d34',
    padding: 12,
    flexDirection: 'row',
    gap: 10,
  },
  stepCardLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#f8fbff',
  },
  stepIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepIndexText: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 12,
  },
  stepBody: {
    flex: 1,
  },
  stepHeader: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  stepTitleLight: {
    color: '#0f172a',
  },
  stepDescription: {
    color: '#9fb7dc',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  stepDescriptionLight: {
    color: '#47638b',
  },
  stepAction: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#31548a',
    borderRadius: 10,
    backgroundColor: '#132744',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepActionLight: {
    borderColor: '#cfe0f6',
    backgroundColor: '#eaf3ff',
  },
  stepActionText: {
    color: '#bfdbfe',
    fontWeight: '700',
    fontSize: 12,
  },
  stepActionTextLight: {
    color: '#1d4ed8',
  },
  webBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fcd34d',
    backgroundColor: '#3b2a04',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  webBadgeLight: {
    borderColor: '#facc15',
    backgroundColor: '#fef3c7',
  },
  webBadgeText: {
    color: '#fde68a',
    fontSize: 10,
    fontWeight: '800',
  },
  webBadgeTextLight: {
    color: '#92400e',
  },
  faqCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
  },
  faqCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  faqTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  faqTitleLight: {
    color: '#0f172a',
  },
  faqItem: {
    borderTopWidth: 1,
    borderTopColor: '#223a5e',
    paddingTop: 10,
    marginTop: 10,
  },
  faqItemLight: {
    borderTopColor: '#dde7f6',
  },
  faqQuestion: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  faqQuestionLight: {
    color: '#0f172a',
  },
  faqAnswer: {
    color: '#9fb7dc',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  faqAnswerLight: {
    color: '#47638b',
  },
});
