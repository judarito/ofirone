import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COMMON_TEXT, APP_TEXT } from '../constants/uiText';

const HOME_ACTION_LABELS = {
  Products: 'Productos',
  ThirdParties: 'Clientes',
  Inventory: 'Inventario',
  Reports: 'Reportes',
};

/**
 * Pantalla de inicio: KPIs, mini-chart de 7 días, acciones rápidas, dock inferior.
 */
export function HomeScreen({
  isLightTheme,
  kpis,
  loadingKpis,
  homeLast7Series,
  homeMaxDaily,
  homePrimaryActions,
  homeBarColors,
  appContentBottomInset,
  lastMenuAction,
  error,
  formatMoney,
  navigateToScreen,
  resolveMenuAccent,
  resolveMenuIcon,
}) {
  const todayVsPrev = Number(kpis?.today?.vs_prev || 0);
  const monthVsPrev = Number(kpis?.month?.vs_prev || 0);

  return (
    <View style={styles.homeScreenContainer}>
      <ScrollView
        contentContainerStyle={[
          styles.homeScrollDark,
          styles.homeScrollWithDock,
          isLightTheme && styles.homeScrollLight,
          { paddingBottom: 110 + Math.min(appContentBottomInset, 20) },
        ]}
      >
        <View style={styles.homeWrap}>
          {/* KPI principal: ventas hoy */}
          <View
            style={[styles.mobileMetricMainCard, isLightTheme && styles.mobileMetricMainCardLight]}
          >
            <View style={styles.mobileMetricMainLeft}>
              <Image
                source={require('../../assets/ofirone-mark-web.png')}
                style={styles.mobileMetricMainLogo}
                resizeMode="contain"
              />
              <View style={styles.mobileMetricMainTextWrap}>
                <Text
                  style={[styles.mobileMetricTitle, isLightTheme && styles.mobileMetricTitleLight]}
                >
                  {APP_TEXT.todaySales}
                </Text>
                <Text
                  style={[
                    styles.mobileMetricMainAmount,
                    isLightTheme && styles.mobileMetricMainAmountLight,
                  ]}
                >
                  {loadingKpis ? '...' : formatMoney(kpis?.today?.total || 0)}
                </Text>
              </View>
            </View>
            <Text style={todayVsPrev >= 0 ? styles.mobileTrendUp : styles.mobileTrendDown}>
              {loadingKpis
                ? '...'
                : `${todayVsPrev >= 0 ? '↗' : '↘'} ${Math.abs(todayVsPrev || 0).toFixed(0)}%`}
            </Text>
          </View>

          {/* KPI mes */}
          <View style={[styles.mobileMetricCard, isLightTheme && styles.mobileMetricCardLight]}>
            <View style={styles.mobileMetricRow}>
              <View
                style={[
                  styles.mobileMetricIconWrap,
                  isLightTheme && styles.mobileMetricIconWrapLight,
                ]}
              >
                <Ionicons name="briefcase-outline" size={18} style={styles.mobileMetricIconGold} />
              </View>
              <View style={styles.mobileMetricTextWrap}>
                <Text
                  style={[styles.mobileMetricTitle, isLightTheme && styles.mobileMetricTitleLight]}
                >
                  {APP_TEXT.thisMonth}
                </Text>
                <Text
                  style={[styles.mobileMetricAmount, isLightTheme && styles.mobileMetricAmountLight]}
                >
                  {loadingKpis ? '...' : formatMoney(kpis?.month?.total || 0)}
                </Text>
              </View>
              <Text style={monthVsPrev >= 0 ? styles.mobileTrendUp : styles.mobileTrendDown}>
                {loadingKpis
                  ? '...'
                  : `${monthVsPrev >= 0 ? '↗' : '↘'} ${Math.abs(monthVsPrev || 0).toFixed(0)}%`}
              </Text>
            </View>
          </View>

          {/* KPI año */}
          <View
            style={[
              styles.mobileMetricCard,
              styles.mobileMetricThinCard,
              isLightTheme && styles.mobileMetricCardLight,
            ]}
          >
            <View style={styles.mobileMetricRow}>
              <View
                style={[
                  styles.mobileMetricIconWrap,
                  isLightTheme && styles.mobileMetricIconWrapLight,
                ]}
              >
                <Ionicons name="bar-chart-outline" size={18} style={styles.mobileMetricIconBlue} />
              </View>
              <Text
                style={[styles.mobileMetricTitle, isLightTheme && styles.mobileMetricTitleLight]}
              >
                {APP_TEXT.thisYear}
              </Text>
              <Text
                style={[styles.mobileMetricAmount, isLightTheme && styles.mobileMetricAmountLight]}
              >
                {loadingKpis ? '...' : formatMoney(kpis?.year?.total || 0)}
              </Text>
            </View>
          </View>

          {/* Botón nueva venta */}
          <Pressable
            onPress={() => navigateToScreen('PointOfSale', { routeHint: '/pos' })}
            style={[styles.quickSaleBtn, isLightTheme && styles.quickSaleBtnLight]}
          >
            <View style={styles.quickSaleContent}>
              <View style={[styles.quickSaleIconWrap, isLightTheme && styles.quickSaleIconWrapLight]}>
                <Ionicons
                  name="storefront-outline"
                  size={20}
                  style={[styles.quickSaleIcon, isLightTheme && styles.quickSaleIconLight]}
                />
              </View>
              <View style={styles.quickSaleTextWrap}>
                <Text style={[styles.quickSaleBtnText, isLightTheme && styles.quickSaleBtnTextLight]}>
                  {APP_TEXT.newSale}
                </Text>
                <Text style={[styles.quickSaleHint, isLightTheme && styles.quickSaleHintLight]}>
                  {APP_TEXT.newSaleHint}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                style={[styles.quickSaleChevron, isLightTheme && styles.quickSaleChevronLight]}
              />
            </View>
          </Pressable>

          {/* Mini-chart 7 días */}
          <View style={[styles.homeMiniChartCard, isLightTheme && styles.homeMiniChartCardLight]}>
            <Text
              style={[styles.homeMiniChartTitle, isLightTheme && styles.homeMiniChartTitleLight]}
            >
              Ventas últimos 7 días
            </Text>
            {loadingKpis ? (
              <Text
                style={[styles.homeMiniChartEmpty, isLightTheme && styles.homeMiniChartEmptyLight]}
              >
                {COMMON_TEXT.loading}
              </Text>
            ) : homeLast7Series.length === 0 ? (
              <Text
                style={[styles.homeMiniChartEmpty, isLightTheme && styles.homeMiniChartEmptyLight]}
              >
                {COMMON_TEXT.noData}
              </Text>
            ) : (
              <View style={styles.homeMiniBarsWrap}>
                {homeLast7Series.map((entry, idx) => {
                  const dayDate = new Date(entry?.date || '');
                  const dayLabel = Number.isNaN(dayDate.getTime())
                    ? '-'
                    : ['D', 'L', 'M', 'M', 'J', 'V', 'S'][dayDate.getDay()];
                  const barHeight = Math.max(
                    10,
                    Math.round((Number(entry?.total || 0) / homeMaxDaily) * 100),
                  );
                  return (
                    <View key={`${entry?.date || idx}-${idx}`} style={styles.homeMiniBarCol}>
                      <View
                        style={[
                          styles.homeMiniBarTrack,
                          isLightTheme && styles.homeMiniBarTrackLight,
                        ]}
                      >
                        <View
                          style={[
                            styles.homeMiniBarFill,
                            {
                              height: `${barHeight}%`,
                              backgroundColor: homeBarColors[idx % homeBarColors.length],
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.homeMiniBarDay,
                          isLightTheme && styles.homeMiniBarDayLight,
                        ]}
                      >
                        {dayLabel}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Acciones primarias */}
          {homePrimaryActions.length > 0 ? (
            <View style={[styles.mobileModulesCard, isLightTheme && styles.mobileModulesCardLight]}>
              {homePrimaryActions.map((item) => (
                <Pressable
                  key={item.code}
                  onPress={() => navigateToScreen(item.targetScreen, { routeHint: item.route })}
                  style={[styles.mobileModuleItem, isLightTheme && styles.mobileModuleItemLight]}
                >
                  <View
                    style={[
                      styles.mobileModuleIconWrap,
                      {
                        backgroundColor: `${resolveMenuAccent(item)}24`,
                        borderColor: `${resolveMenuAccent(item)}70`,
                      },
                    ]}
                  >
                    <Ionicons
                      name={resolveMenuIcon(item)}
                      size={20}
                      color={resolveMenuAccent(item)}
                    />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.mobileModuleLabel, isLightTheme && styles.mobileModuleLabelLight]}
                  >
                    {HOME_ACTION_LABELS[item.targetScreen] || item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Shortcut IA */}
          <Pressable
            onPress={() => navigateToScreen('AIInsights')}
            style={[styles.aiInsightsShortcut, isLightTheme && styles.aiInsightsShortcutLight]}
          >
            <View
              style={[
                styles.aiInsightsShortcutIconWrap,
                isLightTheme && styles.aiInsightsShortcutIconWrapLight,
              ]}
            >
              <Ionicons
                name="sparkles-outline"
                size={20}
                style={[
                  styles.aiInsightsShortcutIcon,
                  isLightTheme && styles.aiInsightsShortcutIconLight,
                ]}
              />
            </View>
            <View style={styles.aiInsightsShortcutTextWrap}>
              <Text
                style={[
                  styles.aiInsightsShortcutTitle,
                  isLightTheme && styles.aiInsightsShortcutTitleLight,
                ]}
              >
                {APP_TEXT.aiCenter}
              </Text>
              <Text
                style={[
                  styles.aiInsightsShortcutSub,
                  isLightTheme && styles.aiInsightsShortcutSubLight,
                ]}
              >
                {APP_TEXT.aiCenterSummary}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              style={[
                styles.aiInsightsShortcutChevron,
                isLightTheme && styles.aiInsightsShortcutChevronLight,
              ]}
            />
          </Pressable>

          {lastMenuAction ? <Text style={styles.successText}>{lastMenuAction}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </ScrollView>

      {/* Dock inferior flotante */}
      <View
        style={[
          styles.mobileBottomDock,
          styles.mobileBottomDockFixed,
          isLightTheme && styles.mobileBottomDockLight,
          { bottom: 10 + Math.min(appContentBottomInset, 18) },
        ]}
      >
        <Pressable
          style={styles.mobileDockSideBtn}
          onPress={() => navigateToScreen('AIInsights', { routeHint: '/ai-insights' })}
        >
          <Ionicons
            name="sparkles"
            size={20}
            style={[styles.mobileDockSideIcon, isLightTheme && styles.mobileDockSideIconLight]}
          />
          <Text style={[styles.mobileDockSideText, isLightTheme && styles.mobileDockSideTextLight]}>
            IA
          </Text>
        </Pressable>

        <Pressable
          style={[styles.mobileDockMainBtn, isLightTheme && styles.mobileDockMainBtnLight]}
          onPress={() => navigateToScreen('PointOfSale', { routeHint: '/pos' })}
        >
          <Ionicons name="add" size={34} style={styles.mobileDockMainIcon} />
        </Pressable>

        <Pressable
          style={styles.mobileDockSideBtn}
          onPress={() => navigateToScreen('Sales', { routeHint: '/sales' })}
        >
          <Ionicons
            name="receipt"
            size={20}
            style={[styles.mobileDockSideIcon, isLightTheme && styles.mobileDockSideIconLight]}
          />
          <Text style={[styles.mobileDockSideText, isLightTheme && styles.mobileDockSideTextLight]}>
            Ventas
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  homeScreenContainer: {
    flex: 1,
  },
  homeScrollDark: {
    paddingBottom: 24,
  },
  homeScrollWithDock: {
    paddingBottom: 124,
  },
  homeScrollLight: {
    backgroundColor: '#f8fafc',
  },
  homeWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 30,
  },
  mobileMetricMainCard: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#111c33',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileMetricMainCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileMetricMainLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  mobileMetricMainLogo: {
    width: 58,
    height: 58,
    marginRight: 10,
  },
  mobileMetricMainTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  mobileMetricTitle: {
    color: '#e7efff',
    fontSize: 14,
    fontWeight: '700',
  },
  mobileMetricTitleLight: {
    color: '#223b64',
  },
  mobileMetricMainAmount: {
    marginTop: 4,
    color: '#f8fafc',
    fontSize: 42,
    lineHeight: 44,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  mobileMetricMainAmountLight: {
    color: '#1e2f4d',
  },
  mobileMetricCard: {
    marginBottom: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#111c33',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  mobileMetricCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileMetricThinCard: {
    paddingVertical: 10,
  },
  mobileMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mobileMetricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  mobileMetricIconWrapLight: {
    backgroundColor: '#edf2fb',
  },
  mobileMetricIconGold: {
    color: '#f6c84a',
  },
  mobileMetricIconBlue: {
    color: '#5caeff',
  },
  mobileMetricTextWrap: {
    flex: 1,
  },
  mobileMetricAmount: {
    marginTop: 2,
    color: '#f8fafc',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  mobileMetricAmountLight: {
    color: '#1e2f4d',
  },
  mobileTrendUp: {
    color: '#65db72',
    fontWeight: '800',
    fontSize: 17,
  },
  mobileTrendDown: {
    color: '#f48a7d',
    fontWeight: '800',
    fontSize: 17,
  },
  quickSaleBtn: {
    marginBottom: 12,
    backgroundColor: '#3cae4d',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#7fe06e',
    shadowColor: '#020617',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 5,
  },
  quickSaleBtnLight: {
    backgroundColor: '#47b954',
    borderColor: '#92dc84',
    shadowColor: '#2f8a3a',
    shadowOpacity: 0.18,
  },
  quickSaleContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickSaleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 25, 8, 0.24)',
  },
  quickSaleIconWrapLight: {
    backgroundColor: 'rgba(235, 255, 234, 0.5)',
  },
  quickSaleIcon: {
    color: '#dbeafe',
  },
  quickSaleIconLight: {
    color: '#eff6ff',
  },
  quickSaleTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  quickSaleBtnText: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 15,
  },
  quickSaleBtnTextLight: {
    color: '#ffffff',
  },
  quickSaleHint: {
    color: '#e9ffe8',
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  quickSaleHintLight: {
    color: '#efffef',
  },
  quickSaleChevron: {
    color: '#efffef',
  },
  quickSaleChevronLight: {
    color: '#ffffff',
  },
  homeMiniChartCard: {
    marginBottom: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#101a2f',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  homeMiniChartCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  homeMiniChartTitle: {
    color: '#f0f4ff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  homeMiniChartTitleLight: {
    color: '#1f365c',
  },
  homeMiniChartEmpty: {
    color: '#8ca2c8',
    fontSize: 13,
  },
  homeMiniChartEmptyLight: {
    color: '#64748b',
  },
  homeMiniBarsWrap: {
    height: 116,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  homeMiniBarCol: {
    flex: 1,
    alignItems: 'center',
  },
  homeMiniBarTrack: {
    width: '100%',
    height: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2f456b',
    backgroundColor: '#0e1627',
    justifyContent: 'flex-end',
    padding: 4,
    overflow: 'hidden',
  },
  homeMiniBarTrackLight: {
    borderColor: '#dbe5f2',
    backgroundColor: '#eef3fb',
  },
  homeMiniBarFill: {
    width: '100%',
    borderRadius: 6,
    minHeight: 6,
  },
  homeMiniBarDay: {
    marginTop: 5,
    color: '#d4def3',
    fontSize: 10,
    fontWeight: '700',
  },
  homeMiniBarDayLight: {
    color: '#475569',
  },
  mobileModulesCard: {
    marginBottom: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#0f1a2f',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  mobileModulesCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileModuleItem: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d4264',
    backgroundColor: '#131f35',
    paddingHorizontal: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileModuleItemLight: {
    borderColor: '#dbe5f2',
    backgroundColor: '#f6f9ff',
  },
  mobileModuleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  mobileModuleLabel: {
    color: '#e0ebff',
    fontSize: 11,
    fontWeight: '700',
  },
  mobileModuleLabelLight: {
    color: '#2a466f',
  },
  aiInsightsShortcut: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a4670',
    backgroundColor: '#111f37',
    borderRadius: 14,
    minHeight: 66,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiInsightsShortcutLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  aiInsightsShortcutIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4f67a0',
    backgroundColor: '#162744',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiInsightsShortcutIconWrapLight: {
    borderColor: '#c9d8eb',
    backgroundColor: '#f1f6ff',
  },
  aiInsightsShortcutIcon: {
    color: '#8f7cff',
  },
  aiInsightsShortcutIconLight: {
    color: '#5d58d8',
  },
  aiInsightsShortcutTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  aiInsightsShortcutTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '800',
  },
  aiInsightsShortcutTitleLight: {
    color: '#0f172a',
  },
  aiInsightsShortcutSub: {
    color: '#9fb7dc',
    fontSize: 11,
    marginTop: 2,
  },
  aiInsightsShortcutSubLight: {
    color: '#47638b',
  },
  aiInsightsShortcutChevron: {
    color: '#93c5fd',
  },
  aiInsightsShortcutChevronLight: {
    color: '#235ea9',
  },
  mobileBottomDock: {
    marginTop: 2,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#101b30',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileBottomDockFixed: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    zIndex: 8,
  },
  mobileBottomDockLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileDockSideBtn: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  mobileDockSideIcon: {
    color: '#60adff',
  },
  mobileDockSideIconLight: {
    color: '#235ea9',
  },
  mobileDockSideText: {
    color: '#ccd9f3',
    fontSize: 11,
    fontWeight: '600',
  },
  mobileDockSideTextLight: {
    color: '#516a8f',
  },
  mobileDockMainBtn: {
    width: 152,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: '#8ce37f',
    backgroundColor: '#47be53',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#05280f',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 6,
  },
  mobileDockMainBtnLight: {
    borderColor: '#83d77a',
    backgroundColor: '#4ec45b',
  },
  mobileDockMainIcon: {
    color: '#f2fff1',
    fontWeight: '700',
  },
  errorText: {
    marginTop: 8,
    color: '#f87171',
    fontSize: 13,
  },
  successText: {
    marginTop: 8,
    color: '#4ade80',
    fontSize: 13,
  },
});
