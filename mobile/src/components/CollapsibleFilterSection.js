import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function CollapsibleFilterSection({
  title = 'Filtros',
  children,
  themeMode = 'dark',
  defaultCollapsed = true,
  activeCount = 0,
  summary = '',
}) {
  const isLightTheme = themeMode === 'light';
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <View style={[styles.card, isLightTheme && styles.cardLight]}>
      <Pressable
        style={[styles.header, isLightTheme && styles.headerLight]}
        onPress={() => setCollapsed((prev) => !prev)}
      >
        <View style={styles.headerLeft}>
          <View style={[styles.iconWrap, isLightTheme && styles.iconWrapLight]}>
            <Ionicons name="options-outline" size={16} color={isLightTheme ? '#235ea9' : '#93c5fd'} />
          </View>
          <View style={styles.textWrap}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{title}</Text>
            {summary ? (
              <Text style={[styles.summary, isLightTheme && styles.summaryLight]} numberOfLines={1}>
                {summary}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.headerRight}>
          {activeCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeCount}</Text>
            </View>
          ) : null}
          <Ionicons
            name={collapsed ? 'chevron-down' : 'chevron-up'}
            size={18}
            color={isLightTheme ? '#235ea9' : '#93c5fd'}
          />
        </View>
      </Pressable>

      {!collapsed ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  cardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4ef',
  },
  header: {
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLight: {
    backgroundColor: '#ffffff',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#29436a',
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapLight: {
    borderColor: '#cfddf0',
    backgroundColor: '#f7fbff',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
  },
  titleLight: {
    color: '#0f172a',
  },
  summary: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  summaryLight: {
    color: '#64748b',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: '#235ea9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#eff6ff',
    fontSize: 12,
    fontWeight: '800',
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
});
