import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_THEME_COLORS } from '../theme/colors';
import { getMobileAppBarTitle } from '../navigation/mobileScreenConfig';

/**
 * Barra superior de la app: menú, logo, título, notificaciones, estado de red, botón back.
 */
export function AppBar({
  isLightTheme,
  currentScreen,
  safeAreaTopInset,
  onMenuOpen,
  onOpenNotifications,
  unreadNotifications,
  offlineMode,
  pendingOpsCount,
  onGoBack,
  onOpenSyncQueue,
}) {
  return (
    <View
      style={[
        styles.appBar,
        isLightTheme ? styles.appBarLight : null,
        {
          paddingTop: safeAreaTopInset,
          height: 68 + safeAreaTopInset,
        },
      ]}
    >
      <View style={styles.appBarLeft}>
        <Pressable
          onPress={onMenuOpen}
          style={[styles.menuTrigger, isLightTheme ? styles.menuTriggerLight : null]}
        >
          <Ionicons
            name="menu"
            size={18}
            style={[styles.menuTriggerText, isLightTheme ? styles.menuTriggerTextLight : null]}
          />
        </Pressable>
        <View style={styles.appBrandLogoWrap}>
          <Image
            source={require('../../assets/ofirone-mark-web.png')}
            style={styles.appBrandLogo}
            resizeMode="contain"
          />
        </View>
        <View style={styles.appBrandTextWrap}>
          <Text numberOfLines={1} style={styles.brandWordmark}>
            <Text
              style={[styles.brandWordmarkOfir, isLightTheme ? styles.brandWordmarkOfirLight : null]}
            >
              Ofir
            </Text>
            <Text
              style={[styles.brandWordmarkOne, isLightTheme ? styles.brandWordmarkOneLight : null]}
            >
              One
            </Text>
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.appBarTitle, isLightTheme ? styles.appBarTitleLight : null]}
          >
            {getMobileAppBarTitle(currentScreen)}
          </Text>
        </View>
      </View>

      <View style={styles.appBarRight}>
        <Pressable
          onPress={onOpenNotifications}
          style={[styles.notificationsBtn, isLightTheme ? styles.notificationsBtnLight : null]}
        >
          <Ionicons
            name="notifications-outline"
            size={17}
            style={[
              styles.notificationsBtnText,
              isLightTheme ? styles.notificationsBtnTextLight : null,
            ]}
          />
          {unreadNotifications > 0 ? (
            <View style={styles.notificationsBadge}>
              <Text style={styles.notificationsBadgeText}>
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          onPress={pendingOpsCount > 0 ? onOpenSyncQueue : undefined}
          style={[
            styles.connectionChip,
            offlineMode ? styles.connectionChipOffline : styles.connectionChipOnline,
          ]}
        >
          <Ionicons
            name={offlineMode ? 'cloud-offline-outline' : 'cloud-done-outline'}
            size={16}
            style={[
              styles.connectionIcon,
              offlineMode ? styles.connectionIconOffline : styles.connectionIconOnline,
            ]}
          />
          {pendingOpsCount > 0 ? (
            <View style={styles.connectionBadge}>
              <Text style={styles.connectionBadgeText}>
                {pendingOpsCount > 99 ? '99+' : pendingOpsCount}
              </Text>
            </View>
          ) : null}
        </Pressable>

        {currentScreen !== 'Home' ? (
          <Pressable
            onPress={onGoBack}
            hitSlop={8}
            style={[styles.appBarBackBtn, isLightTheme ? styles.appBarBackBtnLight : null]}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              style={[styles.appBarBackIcon, isLightTheme ? styles.appBarBackIconLight : null]}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appBar: {
    height: 56,
    backgroundColor: APP_THEME_COLORS.dark.appBarBackground,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: APP_THEME_COLORS.dark.appBarBorder,
  },
  appBarLight: {
    backgroundColor: APP_THEME_COLORS.light.appBarBackground,
    borderBottomColor: APP_THEME_COLORS.light.appBarBorder,
  },
  appBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  appBrandLogoWrap: {
    width: 46,
    height: 46,
    marginLeft: 8,
    marginTop: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBrandLogo: {
    width: 42,
    height: 42,
    transform: [{ translateY: -2 }],
  },
  appBrandTextWrap: {
    marginLeft: 8,
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  brandWordmark: {
    fontSize: 26,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  brandWordmarkOfir: {
    color: APP_THEME_COLORS.dark.brandOfir,
  },
  brandWordmarkOfirLight: {
    color: APP_THEME_COLORS.light.brandOfir,
  },
  brandWordmarkOne: {
    color: APP_THEME_COLORS.dark.brandOne,
  },
  brandWordmarkOneLight: {
    color: APP_THEME_COLORS.light.brandOne,
  },
  appBarTitle: {
    color: APP_THEME_COLORS.dark.appBarTitle,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 0,
  },
  appBarTitleLight: {
    color: APP_THEME_COLORS.light.appBarTitle,
  },
  appBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  notificationsBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.iconButtonBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APP_THEME_COLORS.dark.iconButtonBackground,
    position: 'relative',
  },
  notificationsBtnLight: {
    backgroundColor: APP_THEME_COLORS.light.iconButtonBackground,
    borderColor: APP_THEME_COLORS.light.iconButtonBorder,
  },
  notificationsBtnText: {
    color: APP_THEME_COLORS.dark.iconButtonIcon,
  },
  notificationsBtnTextLight: {
    color: APP_THEME_COLORS.light.iconButtonIcon,
  },
  notificationsBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: APP_THEME_COLORS.shared.notificationBadgeBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationsBadgeText: {
    color: APP_THEME_COLORS.shared.notificationBadgeText,
    fontSize: 10,
    fontWeight: '700',
  },
  appBarBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.backButtonBorder,
    backgroundColor: APP_THEME_COLORS.dark.backButtonBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarBackBtnLight: {
    borderColor: APP_THEME_COLORS.light.backButtonBorder,
    backgroundColor: APP_THEME_COLORS.light.backButtonBackground,
  },
  appBarBackIcon: {
    color: APP_THEME_COLORS.dark.backButtonIcon,
    marginLeft: -1,
  },
  appBarBackIconLight: {
    color: APP_THEME_COLORS.light.backButtonIcon,
  },
  connectionChip: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  connectionChipOnline: {
    borderColor: APP_THEME_COLORS.shared.connectionOnlineBorder,
    backgroundColor: APP_THEME_COLORS.shared.connectionOnlineBackground,
  },
  connectionChipOffline: {
    borderColor: APP_THEME_COLORS.shared.connectionOfflineBorder,
    backgroundColor: APP_THEME_COLORS.shared.connectionOfflineBackground,
  },
  connectionIcon: {
    lineHeight: 16,
  },
  connectionIconOnline: { color: APP_THEME_COLORS.shared.connectionOnlineText },
  connectionIconOffline: { color: APP_THEME_COLORS.shared.connectionOfflineText },
  connectionBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  menuTrigger: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: APP_THEME_COLORS.dark.menuTriggerBackground,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.menuTriggerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTriggerLight: {
    backgroundColor: APP_THEME_COLORS.light.menuTriggerBackground,
    borderColor: APP_THEME_COLORS.light.menuTriggerBorder,
  },
  menuTriggerText: {
    color: APP_THEME_COLORS.dark.menuTriggerIcon,
  },
  menuTriggerTextLight: {
    color: APP_THEME_COLORS.light.menuTriggerIcon,
  },
});
