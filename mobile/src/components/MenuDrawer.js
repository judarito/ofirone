import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_TEXT, COMMON_TEXT } from '../constants/uiText';
import {
  MENU_DISPLAY_MODE_GRID,
  MENU_DISPLAY_MODE_LIST,
} from '../lib/menuDisplayMode';

/**
 * Drawer lateral de navegación con secciones de menú, switch de tema y botón de logout.
 */
export function MenuDrawer({
  visible,
  isLightTheme,
  menuTree,
  menuDisplayMode,
  expandedSections,
  userProfile,
  userEmail,
  tenant,
  appContentBottomInset,
  onClose,
  onLogout,
  onThemeToggle,
  onMenuDisplayModeChange,
  onMenuAction,
  onToggleSection,
  canAccessScreenByMenu,
  resolveMenuAccent,
  resolveMenuIcon,
}) {
  const isGridMode = menuDisplayMode === MENU_DISPLAY_MODE_GRID;

  const buildSectionMeta = (section) => {
    const code = section.code || section.title;
    const hasChildren = Boolean(section.children?.length);
    const isExpanded = Boolean(expandedSections[code]);
    const sectionRoleAllowed = section.targetScreen
      ? canAccessScreenByMenu(section.targetScreen, section.route)
      : true;
    const hasEnabledChild = hasChildren
      ? (section.children || []).some((child) => {
          const childUnsupported = !child.supportedOnMobile && !child.action;
          if (childUnsupported) return false;
          if (!child.targetScreen) return true;
          return canAccessScreenByMenu(child.targetScreen, child.route);
        })
      : false;
    const sectionDisabled = hasChildren
      ? !sectionRoleAllowed && !hasEnabledChild
      : !sectionRoleAllowed;

    return {
      code,
      hasChildren,
      isExpanded,
      sectionDisabled,
    };
  };

  const buildChildMeta = (child) => {
    const childUnsupported = !child.supportedOnMobile && !child.action;
    const childRoleBlocked =
      Boolean(child.targetScreen) && !canAccessScreenByMenu(child.targetScreen, child.route);

    return {
      childDisabled: childUnsupported || childRoleBlocked,
    };
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.menuOverlay}>
        <Pressable style={styles.menuBackdrop} onPress={onClose} />
        <View style={[styles.menuDrawer, isLightTheme ? null : styles.menuDrawerDark]}>
          <View style={[styles.menuHeader, isLightTheme ? null : styles.menuHeaderDark]}>
            <View style={styles.menuHeaderBrand}>
              <Image
                source={require('../../assets/ofirone-mark-web.png')}
                style={styles.menuHeaderLogo}
                resizeMode="contain"
              />
              <Text style={styles.menuHeaderWordmark}>
                <Text
                  style={[
                    styles.brandWordmarkOfir,
                    isLightTheme ? styles.brandWordmarkOfirLight : null,
                  ]}
                >
                  Ofir
                </Text>
                <Text
                  style={[
                    styles.brandWordmarkOne,
                    isLightTheme ? styles.brandWordmarkOneLight : null,
                  ]}
                >
                  One
                </Text>
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={[styles.menuCloseBtn, isLightTheme ? null : styles.menuCloseBtnDark]}
            >
              <Text style={[styles.menuCloseText, isLightTheme ? null : styles.menuCloseTextDark]}>
                {COMMON_TEXT.close}
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.menuUser, isLightTheme ? null : styles.menuUserDark]}>
            {userProfile?.full_name || userEmail || APP_TEXT.userFallback}
          </Text>
          <Text style={[styles.menuTenant, isLightTheme ? null : styles.menuTenantDark]}>
            {tenant?.tenant_name || APP_TEXT.tenantFallback}
          </Text>

          <Pressable
            onPress={onThemeToggle}
            style={[styles.themeSwitchCard, isLightTheme && styles.themeSwitchCardLight]}
          >
            <View style={styles.themeSwitchTextWrap}>
              <Text style={[styles.themeSwitchTitle, isLightTheme && styles.themeSwitchTitleLight]}>
                Tema
              </Text>
              <Text
                style={[
                  styles.themeSwitchSubtitle,
                  isLightTheme && styles.themeSwitchSubtitleLight,
                ]}
              >
                {isLightTheme ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
              </Text>
            </View>
            <View style={styles.themeSwitchControlWrap}>
              <Ionicons
                name={isLightTheme ? 'sunny-outline' : 'moon-outline'}
                size={18}
                color={isLightTheme ? '#0f172a' : '#e2e8f0'}
              />
              <Text
                style={[styles.themeSwitchMode, isLightTheme && styles.themeSwitchModeLight]}
              >
                {isLightTheme ? 'Claro' : 'Oscuro'}
              </Text>
            </View>
          </Pressable>

          <View style={[styles.viewModeCard, isLightTheme && styles.viewModeCardLight]}>
            <Text style={[styles.viewModeTitle, isLightTheme && styles.viewModeTitleLight]}>
              Vista del menú
            </Text>
            <View style={styles.viewModeActions}>
              <Pressable
                onPress={() => onMenuDisplayModeChange?.(MENU_DISPLAY_MODE_LIST)}
                style={[
                  styles.viewModeOption,
                  isLightTheme && styles.viewModeOptionLight,
                  menuDisplayMode === MENU_DISPLAY_MODE_LIST && styles.viewModeOptionActive,
                  menuDisplayMode === MENU_DISPLAY_MODE_LIST &&
                  isLightTheme &&
                  styles.viewModeOptionActiveLight,
                ]}
                >
                  <Ionicons
                    name="list-outline"
                    size={18}
                    color={
                      menuDisplayMode === MENU_DISPLAY_MODE_LIST
                        ? (isLightTheme ? '#1d4ed8' : '#f8fafc')
                        : (isLightTheme ? '#64748b' : '#9fb3d3')
                    }
                  />
              </Pressable>
              <Pressable
                onPress={() => onMenuDisplayModeChange?.(MENU_DISPLAY_MODE_GRID)}
                style={[
                  styles.viewModeOption,
                  isLightTheme && styles.viewModeOptionLight,
                  menuDisplayMode === MENU_DISPLAY_MODE_GRID && styles.viewModeOptionActive,
                  menuDisplayMode === MENU_DISPLAY_MODE_GRID &&
                  isLightTheme &&
                  styles.viewModeOptionActiveLight,
                ]}
                >
                  <Ionicons
                    name="grid-outline"
                    size={18}
                    color={
                      menuDisplayMode === MENU_DISPLAY_MODE_GRID
                        ? (isLightTheme ? '#1d4ed8' : '#f8fafc')
                        : (isLightTheme ? '#64748b' : '#9fb3d3')
                    }
                  />
              </Pressable>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.menuContent,
              { paddingBottom: 30 + appContentBottomInset },
            ]}
          >
            {(menuTree || []).length === 0 ? (
              <Text style={[styles.menuEmptyText, isLightTheme ? null : styles.menuEmptyTextDark]}>
                {APP_TEXT.noMenuAvailable}
              </Text>
            ) : null}

            {!isGridMode
              ? (menuTree || []).map((section) => {
                  const { code, hasChildren, isExpanded, sectionDisabled } = buildSectionMeta(section);

                  return (
                    <View key={code} style={styles.menuSection}>
                      <Pressable
                        disabled={sectionDisabled}
                        style={[
                          styles.menuSectionBtn,
                          isLightTheme ? null : styles.menuSectionBtnDark,
                          sectionDisabled ? styles.menuSectionBtnDisabled : null,
                        ]}
                        onPress={() => {
                          if (hasChildren) {
                            onToggleSection(code);
                            return;
                          }
                          onMenuAction(section);
                        }}
                      >
                        <View style={styles.menuSectionLeft}>
                          <View
                            style={[
                              styles.menuIconBadge,
                              sectionDisabled ? styles.menuIconBadgeDisabled : null,
                              {
                                backgroundColor: `${resolveMenuAccent(section)}22`,
                                borderColor: `${resolveMenuAccent(section)}66`,
                              },
                            ]}
                          >
                            <Ionicons
                              name={resolveMenuIcon(section)}
                              size={14}
                              color={resolveMenuAccent(section)}
                            />
                          </View>
                          <Text
                            style={[
                              styles.menuSectionText,
                              isLightTheme ? null : styles.menuSectionTextDark,
                              sectionDisabled ? styles.menuSectionTextDisabled : null,
                            ]}
                          >
                            {section.label || section.title}
                          </Text>
                        </View>
                        {hasChildren && !sectionDisabled ? (
                          <Text
                            style={[styles.menuChevron, isLightTheme ? null : styles.menuChevronDark]}
                          >
                            {isExpanded ? '−' : '+'}
                          </Text>
                        ) : sectionDisabled ? (
                          <Ionicons
                            name="lock-closed-outline"
                            size={13}
                            style={styles.menuLockedIcon}
                          />
                        ) : null}
                      </Pressable>

                      {hasChildren && isExpanded ? (
                        <View style={styles.menuChildren}>
                          {section.children.map((child) => {
                            const { childDisabled } = buildChildMeta(child);

                            return (
                              <Pressable
                                key={child.code || child.title}
                                disabled={childDisabled}
                                onPress={() => onMenuAction(child)}
                                style={[
                                  styles.menuChildBtn,
                                  isLightTheme ? null : styles.menuChildBtnDark,
                                  childDisabled && styles.menuChildBtnDisabled,
                                ]}
                              >
                                <View
                                  style={[
                                    styles.menuIconBadge,
                                    styles.menuChildIconBadge,
                                    childDisabled ? styles.menuIconBadgeDisabled : null,
                                    {
                                      backgroundColor: `${resolveMenuAccent(child)}20`,
                                      borderColor: `${resolveMenuAccent(child)}55`,
                                    },
                                  ]}
                                >
                                  <Ionicons
                                    name={resolveMenuIcon(child)}
                                    size={13}
                                    color={resolveMenuAccent(child)}
                                  />
                                </View>
                                <Text
                                  style={[
                                    styles.menuChildText,
                                    isLightTheme ? null : styles.menuChildTextDark,
                                    childDisabled && styles.menuChildTextDisabled,
                                  ]}
                                >
                                  {child.label || child.title}
                                </Text>
                                {childDisabled ? (
                                  <Ionicons
                                    name="lock-closed-outline"
                                    size={13}
                                    style={styles.menuLockedIcon}
                                  />
                                ) : (
                                  <Ionicons
                                    name="chevron-forward"
                                    size={14}
                                    style={[
                                      styles.menuChildChevron,
                                      isLightTheme ? styles.menuChildChevronLight : null,
                                    ]}
                                  />
                                )}
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              : (
                <View style={styles.menuGrid}>
                  {(menuTree || []).map((section) => {
                    const { code, hasChildren, isExpanded, sectionDisabled } =
                      buildSectionMeta(section);

                    return (
                      <View
                        key={code}
                        style={[
                          styles.menuGridCard,
                          isLightTheme ? styles.menuGridCardLight : styles.menuGridCardDark,
                          isExpanded && hasChildren ? styles.menuGridCardExpanded : null,
                          sectionDisabled ? styles.menuGridCardDisabled : null,
                        ]}
                      >
                        <Pressable
                          disabled={sectionDisabled}
                          onPress={() => {
                            if (hasChildren) {
                              onToggleSection(code);
                              return;
                            }
                            onMenuAction(section);
                          }}
                          style={styles.menuGridTrigger}
                        >
                          <View
                            style={[
                              styles.menuGridIconWrap,
                              {
                                backgroundColor: `${resolveMenuAccent(section)}22`,
                                borderColor: `${resolveMenuAccent(section)}66`,
                              },
                            ]}
                          >
                            <Ionicons
                              name={resolveMenuIcon(section)}
                              size={20}
                              color={resolveMenuAccent(section)}
                            />
                          </View>
                          <Text
                            style={[
                              styles.menuGridTitle,
                              isLightTheme ? styles.menuGridTitleLight : styles.menuGridTitleDark,
                              sectionDisabled ? styles.menuGridTitleDisabled : null,
                            ]}
                            numberOfLines={2}
                          >
                            {section.label || section.title}
                          </Text>
                          <Text
                            style={[
                              styles.menuGridSubtitle,
                              isLightTheme
                                ? styles.menuGridSubtitleLight
                                : styles.menuGridSubtitleDark,
                            ]}
                          >
                            {hasChildren
                              ? `${section.children.length} accesos`
                              : 'Abrir módulo'}
                          </Text>
                          {sectionDisabled ? (
                            <Ionicons
                              name="lock-closed-outline"
                              size={14}
                              style={styles.menuLockedIcon}
                            />
                          ) : (
                            <Ionicons
                              name={hasChildren && isExpanded ? 'chevron-up' : 'chevron-forward'}
                              size={16}
                              color={isLightTheme ? '#607b9f' : '#9fb3d3'}
                              style={styles.menuGridChevron}
                            />
                          )}
                        </Pressable>

                        {hasChildren && isExpanded ? (
                          <View style={styles.menuGridChildren}>
                            {section.children.map((child) => {
                              const { childDisabled } = buildChildMeta(child);

                              return (
                                <Pressable
                                  key={child.code || child.title}
                                  disabled={childDisabled}
                                  onPress={() => onMenuAction(child)}
                                  style={[
                                    styles.menuGridChildChip,
                                    isLightTheme
                                      ? styles.menuGridChildChipLight
                                      : styles.menuGridChildChipDark,
                                    childDisabled ? styles.menuGridChildChipDisabled : null,
                                  ]}
                                >
                                  <Ionicons
                                    name={resolveMenuIcon(child)}
                                    size={14}
                                    color={resolveMenuAccent(child)}
                                  />
                                  <Text
                                    style={[
                                      styles.menuGridChildText,
                                      isLightTheme
                                        ? styles.menuGridChildTextLight
                                        : styles.menuGridChildTextDark,
                                    ]}
                                    numberOfLines={2}
                                  >
                                    {child.label || child.title}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
                )}
          </ScrollView>

          <View
            style={[
              styles.menuFooter,
              isLightTheme ? null : styles.menuFooterDark,
              { paddingBottom: 10 + appContentBottomInset },
            ]}
          >
            <Pressable
              onPress={onLogout}
              style={[styles.menuLogoutBtn, isLightTheme ? null : styles.menuLogoutBtnDark]}
            >
              <Text style={styles.menuLogoutText}>{APP_TEXT.closeSession}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.5)',
  },
  menuDrawer: {
    width: '86%',
    maxWidth: 392,
    backgroundColor: '#f8fbff',
    borderLeftWidth: 1,
    borderLeftColor: '#cddcf1',
    paddingBottom: 14,
  },
  menuDrawerDark: {
    backgroundColor: '#0c1528',
    borderLeftColor: '#213755',
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  menuHeaderDark: {
    borderBottomColor: '#1f2937',
  },
  menuHeaderBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuHeaderLogo: {
    width: 42,
    height: 42,
  },
  menuHeaderWordmark: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
  },
  brandWordmarkOfir: {
    color: '#1e40af',
  },
  brandWordmarkOfirLight: {
    color: '#1e3a8a',
  },
  brandWordmarkOne: {
    color: '#3b82f6',
  },
  brandWordmarkOneLight: {
    color: '#2563eb',
  },
  menuCloseBtn: {
    borderWidth: 1,
    borderColor: '#cfddf0',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#ffffff',
  },
  menuCloseBtnDark: {
    borderColor: '#334d74',
    backgroundColor: '#11203a',
  },
  menuCloseText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  menuCloseTextDark: {
    color: '#cbd5e1',
  },
  menuUser: {
    paddingHorizontal: 14,
    paddingTop: 10,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
  },
  menuUserDark: {
    color: '#e2e8f0',
  },
  menuTenant: {
    paddingHorizontal: 14,
    color: '#5d7394',
    fontSize: 11,
    marginBottom: 8,
  },
  menuTenantDark: {
    color: '#94a3b8',
  },
  themeSwitchCard: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#0f1a30',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeSwitchCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  themeSwitchTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  themeSwitchTitle: {
    color: '#dbeafe',
    fontWeight: '700',
    fontSize: 13,
  },
  themeSwitchTitleLight: {
    color: '#0f172a',
  },
  themeSwitchSubtitle: {
    color: '#9fb3d3',
    marginTop: 2,
    fontSize: 11,
  },
  themeSwitchSubtitleLight: {
    color: '#64748b',
  },
  themeSwitchControlWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  themeSwitchMode: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 12,
    minWidth: 50,
    textAlign: 'right',
  },
  themeSwitchModeLight: {
    color: '#334155',
  },
  viewModeCard: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#0f1a30',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  viewModeCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  viewModeTitle: {
    color: '#dbeafe',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 8,
  },
  viewModeTitleLight: {
    color: '#0f172a',
  },
  viewModeActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewModeOption: {
    flex: 1,
    minHeight: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#334d74',
    backgroundColor: '#11203a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewModeOptionLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#eff5ff',
  },
  viewModeOptionActive: {
    borderColor: '#8bc34a',
    backgroundColor: '#1e3a24',
  },
  viewModeOptionActiveLight: {
    borderColor: '#93c5fd',
    backgroundColor: '#dbeafe',
  },
  menuContent: {
    paddingHorizontal: 10,
    paddingBottom: 30,
  },
  menuEmptyText: {
    color: '#64748b',
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  menuEmptyTextDark: {
    color: '#94a3b8',
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  menuGridCard: {
    width: '48.4%',
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuGridCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#d7e3f4',
  },
  menuGridCardDark: {
    backgroundColor: '#101a2e',
    borderColor: '#253957',
  },
  menuGridCardExpanded: {
    width: '100%',
  },
  menuGridCardDisabled: {
    opacity: 0.55,
  },
  menuGridTrigger: {
    minHeight: 102,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  menuGridIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  menuGridTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  menuGridTitleLight: {
    color: '#0f172a',
  },
  menuGridTitleDark: {
    color: '#e2e8f0',
  },
  menuGridTitleDisabled: {
    color: '#64748b',
  },
  menuGridSubtitle: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
  },
  menuGridSubtitleLight: {
    color: '#607b9f',
  },
  menuGridSubtitleDark: {
    color: '#9fb3d3',
  },
  menuGridChevron: {
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  menuGridChildren: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
  },
  menuGridChildChip: {
    width: '48.5%',
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  menuGridChildChipLight: {
    backgroundColor: '#eff5ff',
    borderColor: '#d8e5f5',
  },
  menuGridChildChipDark: {
    backgroundColor: '#172236',
    borderColor: '#2a3f60',
  },
  menuGridChildChipDisabled: {
    opacity: 0.55,
  },
  menuGridChildText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  menuGridChildTextLight: {
    color: '#1e293b',
  },
  menuGridChildTextDark: {
    color: '#e2e8f0',
  },
  menuSection: {
    marginBottom: 6,
  },
  menuSectionBtn: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f5f8ff',
    borderWidth: 1,
    borderColor: '#d9e4f4',
  },
  menuSectionBtnDark: {
    backgroundColor: '#101a2e',
    borderColor: '#253957',
  },
  menuSectionBtnDisabled: {
    opacity: 0.52,
  },
  menuSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  menuIconBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconBadgeDisabled: {
    opacity: 0.65,
  },
  menuSectionText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 13,
  },
  menuSectionTextDark: {
    color: '#e2e8f0',
  },
  menuSectionTextDisabled: {
    color: '#64748b',
  },
  menuChevron: {
    color: '#334155',
    fontSize: 18,
    fontWeight: '700',
  },
  menuChevronDark: {
    color: '#cbd5e1',
  },
  menuChildren: {
    marginTop: 4,
    marginLeft: 8,
  },
  menuChildBtn: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 10,
    backgroundColor: '#f0f5ff',
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dbe7f7',
  },
  menuChildBtnDark: {
    backgroundColor: '#172236',
    borderColor: '#2a3f60',
  },
  menuChildIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 7,
  },
  menuChildBtnDisabled: {
    opacity: 0.55,
  },
  menuChildText: {
    color: '#1e293b',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    marginLeft: 8,
  },
  menuChildTextDark: {
    color: '#e2e8f0',
  },
  menuChildTextDisabled: {
    color: '#64748b',
  },
  menuChildChevron: {
    color: '#4b5f84',
  },
  menuChildChevronLight: {
    color: '#607b9f',
  },
  menuLockedIcon: {
    color: '#7c8fae',
  },
  menuFooter: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuFooterDark: {
    borderTopColor: '#1f2937',
  },
  menuLogoutBtn: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLogoutBtnDark: {
    backgroundColor: '#b91c1c',
  },
  menuLogoutText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
