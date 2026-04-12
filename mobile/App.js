import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Appearance,
  ActivityIndicator,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from './src/lib/supabase';
import {
  loadMenuDisplayMode,
  MENU_DISPLAY_MODE_LIST,
  normalizeMenuDisplayMode,
  persistMenuDisplayMode,
} from './src/lib/menuDisplayMode';
import { ThemeModeProvider } from './src/lib/themeMode';
import { normalizeThemePreference, resolveThemeMode } from './src/lib/themePreferences';
import {
  clearAuthCache,
  clearOfflineOperationalData,
  clearMenuCache,
  getAuthCache,
  getMenuCache,
  getPendingOpsCount,
  initOfflineDatabase,
  saveMenuCache,
  saveAuthCache,
} from './src/storage/sqlite/database';
import {
  annotateMenuTreeWithSupport,
  canAccessPathByMenu,
  collectAllowedMenuRoutes,
  collectAllowedMobileScreens,
  collectMenuScreenRouteHints,
  normalizeMenuRoute,
} from './src/navigation/menuMapper';
import {
  getMobileAppBarTitle,
  isMobileScreenSupported,
  resolveReportsInitialTab,
} from './src/navigation/mobileScreenConfig';
import { APP_THEME_COLORS, HOME_BAR_THEME_COLORS, SCREEN_ACCENT_COLORS } from './src/theme/colors';
import { fetchUserMenus, isFreshCache } from './src/services/menu.service';
import {
  getCachedUserThemePreference,
  getTenantSettings,
  setCachedUserThemePreference,
} from './src/services/tenantSettings.service';
import { savePageCache } from './src/services/offlineCache.service';
import { listProducts } from './src/services/productsCatalog.service';
import { getSales } from './src/services/sales.service';
import { listCashSessions, listActiveCashRegisters } from './src/services/cashMenu.service';
import { listLocations, listStockBalances } from './src/services/inventoryCatalog.service';
import { warmEmbeddedModelInBackground } from './src/services/commandEngine';
import {
  configurePushNotifications,
  registerPushTokenForCurrentUser,
  subscribeToPushForeground,
  subscribeToPushResponses,
} from './src/services/pushNotifications.service';
import { preloadUiSounds, releaseUiSounds } from './src/services/soundFeedback.service';
import {
  getCurrentUserOpenSession,
  getPaymentMethodsForDropdown,
  warmCustomersCatalog,
  warmPosCatalog,
} from './src/services/pos.service';
import BulkImportsScreen from './src/screens/BulkImportsScreen';
import BOMsScreen from './src/screens/BOMsScreen';
import BatchesScreen from './src/screens/BatchesScreen';
import CarteraScreen from './src/screens/CarteraScreen';
import CashAssignmentsScreen from './src/screens/CashAssignmentsScreen';
import CashRegistersScreen from './src/screens/CashRegistersScreen';
import CashSessionsScreen from './src/screens/CashSessionsScreen';
import CategoriesScreen from './src/screens/CategoriesScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import LayawayScreen from './src/screens/LayawayScreen';
import AboutScreen from './src/screens/AboutScreen';
import { APP_TEXT, COMMON_TEXT, buildMobileUnavailableText, buildNoAccessLabelText, buildNoAccessModuleText } from './src/constants/uiText';
import PaymentMethodsScreen from './src/screens/PaymentMethodsScreen';
import PointOfSaleScreen from './src/screens/PointOfSaleScreen';
import ProductionOrdersScreen from './src/screens/ProductionOrdersScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import PurchasesScreen from './src/screens/PurchasesScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import AIInsightsScreen from './src/screens/AIInsightsScreen';
import SalesHistoryScreen from './src/screens/SalesHistoryScreen';
import LoginScreen from './src/screens/LoginScreen';
import SetupScreen from './src/screens/SetupScreen';
import TaxRulesScreen from './src/screens/TaxRulesScreen';
import TaxesScreen from './src/screens/TaxesScreen';
import TenantConfigScreen from './src/screens/TenantConfigScreen';
import ThirdPartiesScreen from './src/screens/ThirdPartiesScreen';
import UnitsScreen from './src/screens/UnitsScreen';
import LocationsScreen from './src/screens/LocationsScreen';
import PricingRulesScreen from './src/screens/PricingRulesScreen';
import UsersScreen from './src/screens/UsersScreen';
import RolesMenusScreen from './src/screens/RolesMenusScreen';
import { useConnectivity } from './src/hooks/useConnectivity';
import { useNotifications } from './src/hooks/useNotifications';
import { useSync } from './src/hooks/useSync';
import { useDashboard } from './src/hooks/useDashboard';
import { AppBar } from './src/components/AppBar';
import { MenuDrawer } from './src/components/MenuDrawer';
import { NotificationsModal } from './src/components/NotificationsModal';
import { SyncQueueModal } from './src/components/SyncQueueModal';
import { HomeScreen } from './src/screens/HomeScreen';

function isJwtSessionError(error) {
  if (!error) return false;

  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 401 || status === 403) return true;

  const message = String(error?.message || error?.error_description || error?.code || '').toLowerCase();
  return (
    message.includes('jwt') ||
    message.includes('token') ||
    message.includes('session') ||
    message.includes('expired') ||
    message.includes('refresh')
  );
}

function isTransientLoadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('failed to fetch')
  );
}

function isFatalProfileAccessError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    isJwtSessionError(error) ||
    message.includes('no se encontro perfil') ||
    message.includes('no se encontró perfil') ||
    message.includes('usuario esta inactivo') ||
    message.includes('usuario está inactivo') ||
    message.includes('tu usuario esta inactivo') ||
    message.includes('tu usuario está inactivo')
  );
}

const SCREEN_ICON_MAP = {
  Home: 'home-outline',
  PointOfSale: 'cart-outline',
  Sales: 'receipt-outline',
  Layaway: 'wallet-outline',
  ThirdParties: 'people-outline',
  Customers: 'people-outline',
  Suppliers: 'briefcase-outline',
  Cartera: 'card-outline',
  Products: 'cube-outline',
  Categories: 'grid-outline',
  Units: 'scale-outline',
  BulkImports: 'cloud-upload-outline',
  Inventory: 'layers-outline',
  Batches: 'albums-outline',
  Purchases: 'bag-handle-outline',
  ProductionOrders: 'construct-outline',
  BOMs: 'build-outline',
  CashSessions: 'cash-outline',
  CashRegisters: 'calculator-outline',
  CashAssignments: 'person-add-outline',
  PaymentMethods: 'wallet-outline',
  Reports: 'bar-chart-outline',
  AIInsights: 'sparkles-outline',
  Setup: 'settings-outline',
  TenantConfig: 'business-outline',
  TenantManagement: 'business-outline',
  Locations: 'location-outline',
  Taxes: 'pricetag-outline',
  TaxRules: 'document-text-outline',
  PricingRules: 'trending-up-outline',
  Users: 'person-outline',
  RolesMenus: 'shield-checkmark-outline',
  About: 'information-circle-outline',
};

const SCREEN_ACCENT_MAP = {
  PointOfSale: SCREEN_ACCENT_COLORS.PointOfSale,
  Sales: SCREEN_ACCENT_COLORS.Sales,
  Inventory: SCREEN_ACCENT_COLORS.Inventory,
  Reports: SCREEN_ACCENT_COLORS.Reports,
  AIInsights: SCREEN_ACCENT_COLORS.Reports,
  ThirdParties: SCREEN_ACCENT_COLORS.ThirdParties,
  Customers: SCREEN_ACCENT_COLORS.ThirdParties,
  Suppliers: SCREEN_ACCENT_COLORS.Products,
  Products: SCREEN_ACCENT_COLORS.Products,
  CashSessions: SCREEN_ACCENT_COLORS.CashSessions,
  Setup: SCREEN_ACCENT_COLORS.Setup,
  TenantManagement: SCREEN_ACCENT_COLORS.Setup,
};

function resolveMenuIcon(item) {
  const target = String(item?.targetScreen || '').trim();
  return SCREEN_ICON_MAP[target] || 'ellipse-outline';
}

function resolveMenuAccent(item) {
  const target = String(item?.targetScreen || '').trim();
  return SCREEN_ACCENT_MAP[target] || SCREEN_ACCENT_COLORS.fallback;
}

const HOME_BAR_COLORS = HOME_BAR_THEME_COLORS;
const ALWAYS_ALLOWED_SCREENS = new Set(['Home', 'About', 'AIInsights']);

const ActiveModuleScreen = memo(function ActiveModuleScreen({
  currentScreen,
  tenant,
  userProfile,
  tenantSettings,
  themeMode,
  offlineMode,
  onPendingOpsChange,
  onPointOfSaleSaleCompleted,
  formatMoney,
  pendingOpsCount,
  pageSize,
  reportsInitialTab,
  navigateToScreen,
  handleLocalThemeChange,
}) {
  switch (currentScreen) {
    case 'PointOfSale':
      return (
        <PointOfSaleScreen
          tenant={tenant}
          userProfile={userProfile}
          tenantSettings={tenantSettings}
          themeMode={themeMode}
          offlineMode={offlineMode}
          onPendingOpsChange={onPendingOpsChange}
          onSaleCompleted={onPointOfSaleSaleCompleted}
        />
      );
    case 'Sales':
      return (
        <SalesHistoryScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pendingOpsCount={pendingOpsCount}
          onPendingOpsChange={onPendingOpsChange}
          pageSize={pageSize}
        />
      );
    case 'Layaway':
      return (
        <LayawayScreen
          tenant={tenant}
          userProfile={userProfile}
          tenantSettings={tenantSettings}
          formatMoney={formatMoney}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
        />
      );
    case 'ThirdParties':
      return <ThirdPartiesScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'Customers':
      return (
        <ThirdPartiesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
          forcedType="customer"
          title="Clientes"
        />
      );
    case 'Suppliers':
      return (
        <ThirdPartiesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
          forcedType="supplier"
          title="Proveedores"
        />
      );
    case 'Cartera':
      return (
        <CarteraScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          themeMode={themeMode}
          offlineMode={offlineMode}
        />
      );
    case 'Products':
      return <ProductsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'Categories':
      return <CategoriesScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'Units':
      return <UnitsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'BulkImports':
      return <BulkImportsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} />;
    case 'Inventory':
      return (
        <InventoryScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
          formatMoney={formatMoney}
        />
      );
    case 'Batches':
      return <BatchesScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'Purchases':
      return (
        <PurchasesScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
          formatMoney={formatMoney}
        />
      );
    case 'ProductionOrders':
      return <ProductionOrdersScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'BOMs':
      return <BOMsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'CashSessions':
      return (
        <CashSessionsScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
          formatMoney={formatMoney}
        />
      );
    case 'CashRegisters':
      return <CashRegistersScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'CashAssignments':
      return (
        <CashAssignmentsScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
        />
      );
    case 'PaymentMethods':
      return <PaymentMethodsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'Reports':
      return (
        <ReportsScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          formatMoney={formatMoney}
          initialTab={reportsInitialTab}
        />
      );
    case 'AIInsights':
      return <AIInsightsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} />;
    case 'Setup':
      return <SetupScreen onOpenScreen={navigateToScreen} themeMode={themeMode} />;
    case 'TenantConfig':
    case 'TenantManagement':
      return (
        <TenantConfigScreen
          tenant={tenant}
          offlineMode={offlineMode}
          themeMode={themeMode}
          onLocalThemeChange={handleLocalThemeChange}
        />
      );
    case 'Locations':
      return <LocationsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'Taxes':
      return <TaxesScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'TaxRules':
      return <TaxRulesScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'PricingRules':
      return <PricingRulesScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'Users':
      return <UsersScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={pageSize} />;
    case 'RolesMenus':
      return (
        <RolesMenusScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={pageSize}
        />
      );
    case 'About':
      return <AboutScreen tenant={tenant} userProfile={userProfile} themeMode={themeMode} offlineMode={offlineMode} />;
    default:
      return null;
  }
});

function AppContent() {
  const insets = useSafeAreaInsets();
  const safeAreaTopInset = Math.max(
    Platform.OS === 'android' ? Number(RNStatusBar.currentHeight || 0) : 0,
    Number(insets?.top || 0),
  );
  const safeAreaBottomInset = Math.max(0, Number(insets?.bottom || 0));

  const [session, setSession] = useState(null);
  const [loadingBoot, setLoadingBoot] = useState(true);
  const [bootStep, setBootStep] = useState('iniciando...');
  // true mientras bootstrap muestra datos de caché antes de confirmar la sesión de red.
  // Evita mostrar Login cuando session=null pero tenemos datos locales válidos.
  const [bootingFromCache, setBootingFromCache] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  // offlineMode es DERIVADO — nunca es estado manual.
  // true cuando no hay sesión activa O cuando no hay red.
  // Esto elimina el parpadeo: offlineMode solo cambia cuando session o networkReachable cambian.
  // (Se define después de declarar session y networkReachable más abajo)
  const [userExplicitlyLoggedOut, setUserExplicitlyLoggedOut] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [cachedAt, setCachedAt] = useState('');
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [rawMenuTree, setRawMenuTree] = useState([]);
  const [menuTree, setMenuTree] = useState([]);
  const [menuCachedAt, setMenuCachedAt] = useState('');
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDisplayMode, setMenuDisplayMode] = useState(MENU_DISPLAY_MODE_LIST);
  const [syncQueueOpen, setSyncQueueOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [tenantSettings, setTenantSettings] = useState({});
  const [lastMenuAction, setLastMenuAction] = useState('');
  const [currentScreen, setCurrentScreen] = useState('Home');
  const [screenHistory, setScreenHistory] = useState([]);
  const [reportsInitialTab, setReportsInitialTab] = useState('sales');
  const [themePreference, setThemePreference] = useState('dark');
  const [themeMode, setThemeMode] = useState('dark');
  const [error, setError] = useState('');

  // Hooks extraídos
  const { networkReachable } = useConnectivity();

  // offlineMode DERIVADO: true si no hay sesión válida o no hay red.
  // Al ser useMemo (no state), no dispara re-renders por sí mismo —
  // solo se recalcula cuando session o networkReachable cambian de verdad.
  const offlineMode = useMemo(
    () => !session || !networkReachable,
    [session, networkReachable],
  );

  const {
    kpis,
    dailySeries,
    topProducts,
    paymentMethodsSeries,
    loadingKpis,
    applyPendingSaleToDashboard,
    loadDashboard,
    resetDashboard,
  } = useDashboard();
  const {
    notificationsOpen,
    setNotificationsOpen,
    notifications,
    unreadNotifications,
    loadingNotifications,
    refreshNotifications,
    handleOpenNotifications,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
    reset: resetNotifications,
  } = useNotifications({ session, offlineMode, tenant, userProfile });

  useEffect(() => {
    preloadUiSounds();
    return () => {
      releaseUiSounds();
    };
  }, []);

  useEffect(() => {
    let active = true;

    loadMenuDisplayMode().then((storedMode) => {
      if (!active) return;
      setMenuDisplayMode(storedMode);
    });

    return () => {
      active = false;
    };
  }, []);

  const allowedMenuRoutes = useMemo(() => collectAllowedMenuRoutes(rawMenuTree), [rawMenuTree]);
  const allowedMenuScreens = useMemo(() => collectAllowedMobileScreens(rawMenuTree), [rawMenuTree]);
  const menuScreenRouteHints = useMemo(() => collectMenuScreenRouteHints(rawMenuTree), [rawMenuTree]);

  const handleMenuDisplayModeChange = useCallback((nextMode) => {
    const normalized = normalizeMenuDisplayMode(nextMode);
    setMenuDisplayMode(normalized);
    persistMenuDisplayMode(normalized);
  }, []);

  const canAccessScreenByMenu = useCallback((screenName, routeHint = '') => {
    const targetScreen = String(screenName || '').trim();
    if (!targetScreen) return false;
    if (ALWAYS_ALLOWED_SCREENS.has(targetScreen)) return true;

    if (allowedMenuRoutes.length > 0) {
      const normalizedHint = normalizeMenuRoute(routeHint);
      if (normalizedHint && canAccessPathByMenu(normalizedHint, allowedMenuRoutes)) {
        return true;
      }
      const screenRoutes = menuScreenRouteHints[targetScreen] || [];
      return screenRoutes.some((candidateRoute) => canAccessPathByMenu(candidateRoute, allowedMenuRoutes));
    }

    if (allowedMenuScreens.length > 0) {
      return allowedMenuScreens.includes(targetScreen);
    }

    return true;
  }, [allowedMenuRoutes, allowedMenuScreens, menuScreenRouteHints]);

  const navigateToScreen = useCallback((nextScreen, options = {}) => {
    const { reset = false, routeHint = '', denyMessage = '' } = options;
    const target = String(nextScreen || '').trim();
    if (!target) return false;

    if (!reset && !canAccessScreenByMenu(target, routeHint)) {
      setError(
        denyMessage || buildNoAccessModuleText(getMobileAppBarTitle(target)),
      );
      return false;
    }

    if (reset) {
      setScreenHistory([]);
      setCurrentScreen(target);
      return true;
    }

    setCurrentScreen((prevScreen) => {
      if (target === prevScreen) return prevScreen;
      setScreenHistory((prevHistory) => [...prevHistory, prevScreen].slice(-50));
      return target;
    });
    return true;
  }, [canAccessScreenByMenu]);

  const resetToHome = useCallback(() => {
    setScreenHistory([]);
    setCurrentScreen('Home');
  }, []);

  const goBack = useCallback(() => {
    setScreenHistory((prev) => {
      if (!prev.length) {
        setCurrentScreen('Home');
        return prev;
      }
      const next = [...prev];
      const previousScreen = next.pop() || 'Home';
      setCurrentScreen(previousScreen);
      return next;
    });
  }, []);

  const forceSessionToLogin = useCallback((reason = APP_TEXT.sessionExpired) => {
    setError(reason);
    setUserExplicitlyLoggedOut(true);
    setSession(null);
    setUserProfile(null);
    setTenant(null);
    resetDashboard();
    setTenantSettings({});
    setRawMenuTree([]);
    setMenuTree([]);
    setMenuCachedAt('');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
    resetNotifications();
    resetToHome();
    setReportsInitialTab('sales');
  }, [resetToHome, resetDashboard, resetNotifications]);

  const applyThemeFromLocalCache = async (cachedAuth = null) => {
    const cached = cachedAuth || (await getAuthCache());
    const tenantId = cached?.tenant?.tenant_id || null;
    const userId = cached?.userProfile?.user_id || null;

    if (!tenantId || !userId) {
      setThemePreference('dark');
      setThemeMode('dark');
      return;
    }

    const cachedThemeResult = await getCachedUserThemePreference(tenantId, userId);
    const cachedTheme = cachedThemeResult?.data?.theme
      ? normalizeThemePreference(cachedThemeResult.data.theme)
      : null;

    if (cachedTheme) {
      setThemePreference(cachedTheme);
      setThemeMode(resolveThemeMode(cachedTheme));
      return;
    }

    const tenantSettingsResult = await getTenantSettings(tenantId, { offlineMode: true });
    const fallbackTenantTheme = normalizeThemePreference(tenantSettingsResult?.data?.theme || 'dark');
    setThemePreference(fallbackTenantTheme);
    setThemeMode(resolveThemeMode(fallbackTenantTheme));
    await setCachedUserThemePreference(tenantId, userId, fallbackTenantTheme);
  };

  useEffect(() => {
    configurePushNotifications();
    let mounted = true;

    const safeStep = async (label, fn) => {
      setBootStep(label);
      try {
        return await fn();
      } catch (e) {
        const msg = `[${label}] ${e?.message ?? String(e)}`;
        setBootStep(msg);
        throw new Error(msg);
      }
    };

    const bootstrap = async () => {
      try {
        await safeStep('initDB', () => initOfflineDatabase());

        const cached = await safeStep('getAuthCache', () => getAuthCache());
        const cachedMenu = await safeStep('getMenuCache', () => getMenuCache());
        const pendingCount = await safeStep('getPendingOps', () =>
          getPendingOpsCount({
            tenantId: cached?.tenant?.tenant_id || null,
            userId: cached?.userProfile?.user_id || null,
          }));

        if (mounted) setPendingOpsCount(pendingCount);
        if (cached && mounted) {
          setOfflineAvailable(true);
          setCachedAt(cached.cachedAt);
        }
        if (cachedMenu && mounted) {
          setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
          setMenuTree(annotateMenuTreeWithSupport(cachedMenu.menuTree));
          setMenuCachedAt(cachedMenu.cachedAt);
        }

        await safeStep('applyTheme', () => applyThemeFromLocalCache(cached));

        // Inicio instantáneo desde caché: si hay datos de perfil y tenant guardados,
        // mostrar la app inmediatamente y confirmar la sesión en background.
        setBootStep('checkCache');
        const hasCachedProfile = cached?.userProfile && cached?.tenant;
        if (hasCachedProfile && mounted) {
          setUserProfile(cached.userProfile);
          setTenant(cached.tenant);
          // bootingFromCache=true evita que "!session && !offlineMode" muestre Login
          // sin tocar offlineMode, así no se disparan los effects que lo escuchan.
          setBootingFromCache(true);
          setLoadingBoot(false);

          // Confirmar sesión en background con timeout — sin llamar hydrateProfile()
          // (hydrateProfile pone loadingProfile=true y puede colgar la UI de nuevo).
          Promise.race([
            supabase.auth.getSession(),
            new Promise((resolve) =>
              setTimeout(() => resolve({ data: { session: null }, error: null }), 6000),
            ),
          ])
            .then(({ data: sessionData }) => {
              if (!mounted) return;
              const activeSession = sessionData?.session ?? null;
              setSession(activeSession);
              setBootingFromCache(false);
              if (activeSession?.user?.id) {
                hydrateProfile(activeSession.user.id, { background: true });
                warmCriticalOfflineCaches(
                  cached.tenant?.tenant_id,
                  cached.userProfile?.user_id,
                );
              }
            })
            .catch(() => {
              if (mounted) setBootingFromCache(false);
            });
          return;
        }

        // Sin caché: getSession() con timeout de seguridad de 6 segundos
        const sessionResult = await safeStep('getSession', () =>
          Promise.race([
            supabase.auth.getSession(),
            new Promise((resolve) =>
              setTimeout(() => resolve({ data: { session: null }, error: null }), 6000),
            ),
          ]),
        );
        const { data, error: sessionError } = sessionResult;

        if (!mounted) return;
        if (sessionError) {
          setError(sessionError.message);
          return;
        }

        const activeSession = data?.session ?? null;
        setSession(activeSession);
        if (activeSession?.user?.id) {
          await safeStep('hydrateProfile', () => hydrateProfile(activeSession.user.id));
          return;
        }

        // No forzar modo offline automáticamente cuando no hay sesión activa.
        // El usuario puede elegir "Continuar sin conexión" desde Login si desea.
      } catch (e) {
        if (!mounted) return;
        setError(e?.message ?? APP_TEXT.offlineInitError);
      } finally {
        if (mounted) setLoadingBoot(false);
      }
    };

    bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      setSession(nextSession);
      if (
        nextSession?.user?.id &&
        (event === 'INITIAL_SESSION' || event === 'USER_UPDATED')
      ) {
        await hydrateProfile(nextSession.user.id, { background: true });
      }
      if (!nextSession) {
        const reason = event === 'TOKEN_REFRESH_FAILED'
          ? APP_TEXT.sessionExpired
          : APP_TEXT.sessionEnded;
        forceSessionToLogin(reason);
        await applyThemeFromLocalCache();
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [forceSessionToLogin]);

  useEffect(() => {
    if (!session || offlineMode || !tenant?.tenant_id || !userProfile?.user_id) return undefined;

    let active = true;
    (async () => {
      const result = await registerPushTokenForCurrentUser({
        tenantId: tenant.tenant_id,
        userId: userProfile.user_id,
      });

      if (!active || result?.success) return;

      console.warn('[push] registro no completado:', result?.error || 'sin detalle', result?.data || {});
    })().catch((error) => {
      if (!active) return;
      console.warn('[push] error inesperado registrando token:', error?.message || error);
    });

    const responseSub = subscribeToPushResponses((response) => {
      if (!active) return;
      const data = response?.notification?.request?.content?.data || {};
      const actionUrl = String(data?.action_url || '');
      if (actionUrl.includes('/reports')) {
        navigateToScreen('Reports', { routeHint: '/reports' });
      } else if (actionUrl.includes('/sales') || actionUrl.includes('/ventas')) {
        navigateToScreen('Sales', { routeHint: '/sales' });
      } else if (actionUrl.includes('/point-of-sale') || actionUrl.includes('/pos')) {
        navigateToScreen('PointOfSale', { routeHint: '/pos' });
      }
    });

    const foregroundSub = subscribeToPushForeground(() => {
      if (!active) return;
      refreshNotifications();
    });

    return () => {
      active = false;
      responseSub?.remove?.();
      foregroundSub?.remove?.();
    };
  }, [session, offlineMode, tenant?.tenant_id, userProfile?.user_id, navigateToScreen]);


  // [eliminado] Effect de setOfflineMode manual — offlineMode ahora es useMemo derivado.

  useEffect(() => {
    if (!session || offlineMode) return undefined;

    let active = true;
    let intervalId = null;
    let expiryTimer = null;

    const validateSession = async () => {
      if (!active) return;

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;

        if (sessionError && isJwtSessionError(sessionError)) {
          forceSessionToLogin(APP_TEXT.sessionExpired);
          return;
        }

        const activeSession = sessionData?.session || null;
        if (!activeSession) {
          forceSessionToLogin(APP_TEXT.sessionExpired);
          return;
        }

        const expiresAtSec = Number(activeSession?.expires_at || 0);
        if (Number.isFinite(expiresAtSec) && expiresAtSec > 0) {
          const expiresAtMs = expiresAtSec * 1000;
          if (expiresAtMs <= Date.now()) {
            forceSessionToLogin(APP_TEXT.sessionExpired);
            return;
          }
        }

        const { error: userError } = await supabase.auth.getUser();
        if (!active) return;
        if (userError && isJwtSessionError(userError)) {
          forceSessionToLogin(APP_TEXT.sessionExpired);
        }
      } catch (_e) {
        // Validación best-effort para expiración JWT.
      }
    };

    validateSession();
    intervalId = setInterval(validateSession, 60000);

    const expiresAtSec = Number(session?.expires_at || 0);
    if (Number.isFinite(expiresAtSec) && expiresAtSec > 0) {
      const msUntilExpiry = expiresAtSec * 1000 - Date.now();
      expiryTimer = setTimeout(
        validateSession,
        Math.max(1000, msUntilExpiry + 1500),
      );
    }

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        validateSession();
      }
    });

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
      if (expiryTimer) clearTimeout(expiryTimer);
      appStateSub.remove();
    };
  }, [session?.user?.id, session?.expires_at, offlineMode, forceSessionToLogin]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    if (!session && !offlineMode) return undefined;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        setMenuOpen(false);
        return true;
      }
      if (notificationsOpen) {
        setNotificationsOpen(false);
        return true;
      }
      if (currentScreen !== 'Home') {
        goBack();
        return true;
      }
      return false;
    });

    return () => sub.remove();
  }, [session, offlineMode, menuOpen, notificationsOpen, currentScreen, goBack]);

  useEffect(() => {
    if (ALWAYS_ALLOWED_SCREENS.has(currentScreen)) return;
    if (canAccessScreenByMenu(currentScreen)) return;
    setError(buildNoAccessLabelText(getMobileAppBarTitle(currentScreen)));
    resetToHome();
    setMenuOpen(false);
  }, [currentScreen, canAccessScreenByMenu, resetToHome]);

  const userEmail = useMemo(() => session?.user?.email ?? '', [session]);
  const homeQuickActions = useMemo(() => {
    const flat = [];
    (menuTree || []).forEach((section) => {
      if (section.supportedOnMobile && section.targetScreen && section.targetScreen !== 'Home') {
        flat.push({
          code: section.code || section.targetScreen,
          label: section.label || section.title || section.targetScreen,
          targetScreen: section.targetScreen,
          route: section.route || '',
        });
      }
      (section.children || []).forEach((child) => {
        if (!child.supportedOnMobile || !child.targetScreen || child.targetScreen === 'Home') return;
        flat.push({
          code: child.code || child.targetScreen,
          label: child.label || child.title || child.targetScreen,
          targetScreen: child.targetScreen,
          route: child.route || '',
        });
      });
    });

    const unique = [];
    const seen = new Set();
    flat.forEach((item) => {
      const key = `${item.targetScreen}:${item.route}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    return unique.slice(0, 12);
  }, [menuTree]);
  const homePrimaryActions = useMemo(() => {
    const preferredTargets = ['Products', 'ThirdParties', 'Inventory', 'Reports'];
    const byTarget = new Map();
    homeQuickActions.forEach((item) => {
      if (!item?.targetScreen || byTarget.has(item.targetScreen)) return;
      byTarget.set(item.targetScreen, item);
    });

    const prioritized = preferredTargets
      .map((target) => byTarget.get(target))
      .filter(Boolean);

    if (prioritized.length >= 4) return prioritized.slice(0, 4);

    const used = new Set(prioritized.map((item) => `${item.targetScreen}:${item.route || ''}`));
    homeQuickActions.forEach((item) => {
      const key = `${item.targetScreen}:${item.route || ''}`;
      if (used.has(key)) return;
      if (prioritized.length >= 4) return;
      used.add(key);
      prioritized.push(item);
    });

    return prioritized.slice(0, 4);
  }, [homeQuickActions]);
  const homeLast7Series = useMemo(() => (dailySeries || []).slice(-7), [dailySeries]);
  const homeMaxDaily = useMemo(() => {
    if (!homeLast7Series.length) return 1;
    return Math.max(...homeLast7Series.map((entry) => Number(entry?.total || 0)), 1);
  }, [homeLast7Series]);
  const formatMoney = useCallback((value) => {
    const currency = tenant?.currency_code || 'COP';
    const amount = Number(value || 0);
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch (_e) {
      return `$ ${Math.round(amount).toLocaleString('es-CO')}`;
    }
  }, [tenant?.currency_code]);
  const defaultPageSize = Number(tenantSettings?.default_page_size || 20);
  const localLlmMode = useMemo(
    () => String(process.env.EXPO_PUBLIC_LOCAL_LLM_MODE || 'auto').trim().toLowerCase(),
    [],
  );
  const formatDateTime = (value) => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString();
    } catch (_e) {
      return String(value);
    }
  };
  const loadMenusForUser = async (authUserId, { preferFreshCache = true } = {}) => {
    if (!authUserId) return [];

    const cachedMenu = await getMenuCache();
    if (
      preferFreshCache &&
      cachedMenu?.authUserId === authUserId &&
      isFreshCache(cachedMenu.cachedAt)
    ) {
      const annotated = annotateMenuTreeWithSupport(cachedMenu.menuTree);
      setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
      setMenuTree(annotated);
      setMenuCachedAt(cachedMenu.cachedAt);
      return annotated;
    }

    setLoadingMenu(true);
    try {
      const { tree } = await fetchUserMenus(authUserId);
      const annotated = annotateMenuTreeWithSupport(tree);
      setRawMenuTree(Array.isArray(tree) ? tree : []);
      setMenuTree(annotated);
      const now = new Date().toISOString();
      setMenuCachedAt(now);
      await saveMenuCache({ authUserId, menuTree: tree });
      return annotated;
    } catch (menuError) {
      if (cachedMenu?.authUserId === authUserId && Array.isArray(cachedMenu.menuTree)) {
        const annotated = annotateMenuTreeWithSupport(cachedMenu.menuTree);
        setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
        setMenuTree(annotated);
        setMenuCachedAt(cachedMenu.cachedAt);
        return annotated;
      }
      throw menuError;
    } finally {
      setLoadingMenu(false);
    }
  };
  const loadTenantConfig = async (tenantId, { forceOffline = false, userId = null } = {}) => {
    if (!tenantId) {
      setTenantSettings({});
      return;
    }

    const result = await getTenantSettings(tenantId, {
      offlineMode: forceOffline || offlineMode,
    });

    if (result.success) {
      const nextSettings = result.data || {};
      setTenantSettings(nextSettings);
      const tenantDefaultTheme = normalizeThemePreference(nextSettings.theme);
      let effectiveTheme = tenantDefaultTheme;

      if (userId) {
        const cachedThemeResult = await getCachedUserThemePreference(tenantId, userId);
        const cachedTheme = cachedThemeResult?.data?.theme
          ? normalizeThemePreference(cachedThemeResult.data.theme)
          : null;

        if (cachedTheme) {
          effectiveTheme = cachedTheme;
        } else {
          await setCachedUserThemePreference(tenantId, userId, tenantDefaultTheme);
        }
      }

      setThemePreference(effectiveTheme);
      setThemeMode(resolveThemeMode(effectiveTheme));
      return;
    }

    setTenantSettings({});
  };

  const warmCriticalOfflineCaches = async (tenantId, userId) => {
    if (!tenantId || !userId) return;
    try {
      const [sessionResult] = await Promise.all([
        getCurrentUserOpenSession(tenantId, userId, { offlineMode: false }),
        getPaymentMethodsForDropdown(tenantId, { offlineMode: false }),
        warmCustomersCatalog(tenantId),
        listActiveCashRegisters(tenantId),
      ]);

      const locationId = sessionResult?.success
        ? sessionResult?.data?.cash_register?.location_id || null
        : null;

      await Promise.all([
        warmPosCatalog(tenantId, locationId),
        warmPosCatalog(tenantId, null),
      ]);

      await listLocations(tenantId);

      const [productsSale, productsComponents, cashSessions, salesHistory] = await Promise.all([
        listProducts({
          tenantId,
          search: '',
          limit: defaultPageSize,
          offset: 0,
          isComponent: false,
        }),
        listProducts({
          tenantId,
          search: '',
          limit: defaultPageSize,
          offset: 0,
          isComponent: true,
        }),
        listCashSessions({
          tenantId,
          status: null,
          limit: defaultPageSize,
          offset: 0,
        }),
        getSales(tenantId, 1, defaultPageSize, {
          status: null,
          location_id: null,
          from_date: null,
          to_date: null,
        }),
        listStockBalances({ tenantId, locationId: null, isComponent: false, limit: defaultPageSize, offset: 0 }),
        listStockBalances({ tenantId, locationId: null, isComponent: true, limit: defaultPageSize, offset: 0 }),
      ]);

      if (productsSale.success) {
        await savePageCache({
          namespace: 'catalog-products',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { search: '', isComponent: false },
          items: productsSale.data || [],
          total: Number(productsSale.total || 0),
        });
      }
      if (productsComponents.success) {
        await savePageCache({
          namespace: 'catalog-products',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { search: '', isComponent: true },
          items: productsComponents.data || [],
          total: Number(productsComponents.total || 0),
        });
      }
      if (cashSessions.success) {
        await savePageCache({
          namespace: 'cash-sessions',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { status: '' },
          items: cashSessions.data || [],
          total: Number(cashSessions.total || 0),
        });
      }
      if (salesHistory.success) {
        await savePageCache({
          namespace: 'sales-history',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { status: '', location_id: '', from_date: '', to_date: '' },
          items: salesHistory.data || [],
          total: Number(salesHistory.total || 0),
        });
      }
    } catch (_e) {
      // warming is best-effort; app flow must continue
    }
  };

  const handleLocalThemeChange = useCallback(async (nextTheme) => {
    const normalizedPreference = normalizeThemePreference(nextTheme);
    setThemePreference(normalizedPreference);
    setThemeMode(resolveThemeMode(normalizedPreference));
    setTenantSettings((prev) => ({ ...(prev || {}), theme: normalizedPreference }));
    if (tenant?.tenant_id) {
      if (userProfile?.user_id) {
        await setCachedUserThemePreference(tenant.tenant_id, userProfile.user_id, normalizedPreference);
      }
    }
  }, [tenant?.tenant_id, userProfile?.user_id]);

  const refreshDashboardForTenant = useCallback(
    async (tenantId, { offlineOverride } = {}) => {
      if (!tenantId) {
        resetDashboard();
        return { success: false, error: 'tenantId es requerido' };
      }

      const shouldUseOffline = typeof offlineOverride === 'boolean' ? offlineOverride : offlineMode;
      return loadDashboard(tenantId, { offlineMode: shouldUseOffline });
    },
    [loadDashboard, offlineMode, resetDashboard],
  );

  const refreshHomeDashboard = useCallback(
    async (options = {}) => refreshDashboardForTenant(tenant?.tenant_id, options),
    [refreshDashboardForTenant, tenant?.tenant_id],
  );

  const handlePointOfSaleSaleCompleted = useCallback(
    async (salePayload = {}, options = {}) => {
      const source = String(options?.source || 'server');

      if (source === 'offline-queue' || source === 'queued-after-network-error') {
        await applyPendingSaleToDashboard(tenant?.tenant_id, salePayload);
        return;
      }

      await refreshHomeDashboard({ offlineOverride: false });
    },
    [applyPendingSaleToDashboard, refreshHomeDashboard, tenant?.tenant_id],
  );

  useEffect(() => {
    if (currentScreen !== 'Home' || !tenant?.tenant_id) return undefined;

    let active = true;
    const refresh = async () => {
      if (!active) return;
      await refreshDashboardForTenant(tenant.tenant_id);
    };

    refresh();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
      }
    });

    return () => {
      active = false;
      appStateSub.remove();
    };
  }, [currentScreen, refreshDashboardForTenant, tenant?.tenant_id]);

  useEffect(() => {
    const sub = Appearance.addChangeListener(() => {
      if (themePreference === 'auto') {
        setThemeMode(resolveThemeMode('auto'));
      }
    });
    return () => sub.remove();
  }, [themePreference]);

  const toggleSection = (sectionCode) => {
    if (!sectionCode) return;
    setExpandedSections((prev) => ({
      ...prev,
      [sectionCode]: !prev[sectionCode],
    }));
  };

  const handleMenuAction = async (item) => {
    if (!item) return;
    setError('');

    if (item.route === '/' || item.targetScreen === 'Home') {
      resetToHome();
      setLastMenuAction('');
      setMenuOpen(false);
      return;
    }

    if (item.action === 'openManual') {
      setError(APP_TEXT.userManualWebOnly);
      return;
    }

    if (isMobileScreenSupported(item.targetScreen)) {
      if (item.targetScreen === 'Reports') {
        setReportsInitialTab(resolveReportsInitialTab(item.route));
      }
      const didNavigate = navigateToScreen(item.targetScreen, {
        routeHint: item.route,
        denyMessage: buildNoAccessLabelText(item.label || item.title),
      });
      if (!didNavigate) return;
      setLastMenuAction('');
      setMenuOpen(false);
      return;
    }

    setError(buildMobileUnavailableText(item.label || item.title));
  };

  const hydrateProfile = async (authUserId, { background = false } = {}) => {
    if (!background) {
      setLoadingProfile(true);
      setError('');
    }

    try {
      const { data: profiles, error: profileError } = await supabase
        .from('users')
        .select(
          `
            user_id,
            auth_user_id,
            tenant_id,
            email,
            full_name,
            is_active,
            tenants (
              tenant_id,
              name,
              currency_code
            )
          `,
        )
        .eq('auth_user_id', authUserId);

      if (profileError) throw profileError;

      const profile = profiles?.[0] ?? null;
      if (!profile) {
        throw new Error('No se encontró perfil del usuario en OfirOne.');
      }
      if (!profile.is_active) {
        throw new Error('Tu usuario esta inactivo.');
      }

      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select(
          `
            role:role_id (
              role_id,
              name,
              role_permissions (
                permission:permission_id (
                  permission_id,
                  code,
                  description
                )
              )
            )
          `,
        )
        .eq('user_id', profile.user_id);

      if (rolesError) throw rolesError;

      const permissionsMap = new Map();
      (userRoles || []).forEach((ur) => {
        (ur.role?.role_permissions || []).forEach((rp) => {
          if (rp.permission?.code) {
            permissionsMap.set(rp.permission.code, rp.permission);
          }
        });
      });

      const enriched = {
        ...profile,
        roles: (userRoles || []).map((ur) => ur.role).filter(Boolean),
        permissions: Array.from(permissionsMap.values()),
        permissionCodes: Array.from(permissionsMap.keys()),
      };

      const tenantData = profile.tenants
        ? {
            tenant_id: profile.tenants.tenant_id,
            tenant_name: profile.tenants.name,
            currency_code: profile.tenants.currency_code,
          }
        : null;

      setUserProfile(enriched);
      setTenant(tenantData);
      setUserExplicitlyLoggedOut(false);

      await saveAuthCache({
        authUserId,
        userProfile: enriched,
        tenant: tenantData,
      });
      const pendingCount = await getPendingOpsCount({
        tenantId: tenantData?.tenant_id || null,
        userId: enriched?.user_id || null,
      });
      setPendingOpsCount(pendingCount);
      setOfflineAvailable(true);
      setCachedAt(new Date().toISOString());
      setExpandedSections({});
      setLastMenuAction('');
      try {
        await loadMenusForUser(authUserId, { preferFreshCache: true });
      } catch (menuError) {
        if (!background) {
          setRawMenuTree([]);
          setMenuTree([]);
          setMenuCachedAt('');
        }
        setError(menuError?.message || APP_TEXT.loginMenuLoadFailed);
      }
      await loadTenantConfig(tenantData?.tenant_id, {
        forceOffline: false,
        userId: enriched?.user_id,
      });
      await loadDashboard(tenantData?.tenant_id);
      // Fire-and-forget: el calentamiento de cache es best-effort y no debe bloquear el arranque
      warmCriticalOfflineCaches(tenantData?.tenant_id, enriched?.user_id);
      return { success: true, data: { userProfile: enriched, tenant: tenantData } };
    } catch (e) {
      const message = e?.message ?? 'No fue posible cargar el perfil.';

      if (background) {
        if (isFatalProfileAccessError(e)) {
          forceSessionToLogin(message);
        } else if (!isTransientLoadError(e)) {
          setError(message);
        }
        return { success: false, error: message };
      }

      setUserProfile(null);
      setTenant(null);
      resetDashboard();
      setTenantSettings({});
      setRawMenuTree([]);
      setMenuTree([]);
      setMenuCachedAt('');
      setError(message);
      return { success: false, error: message };
    } finally {
      if (!background) {
        setLoadingProfile(false);
      }
    }
  };

  const handleLogin = async () => {
    setError('');
    setLoadingAuth(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      if (data?.user?.id) {
        await hydrateProfile(data.user.id);
      }
    } catch (e) {
      setError(e?.message ?? APP_TEXT.loginFailed);
    } finally {
      setLoadingAuth(false);
    }
  };

  useSync({
    session,
    offlineMode,
    networkReachable,
    tenant,
    userProfile,
    defaultPageSize,
    onPendingOpsChange: setPendingOpsCount,
    onSyncSuccess: async (tenantId, userId) => {
      await refreshDashboardForTenant(tenantId, { offlineOverride: false });
      await warmCriticalOfflineCaches(tenantId, userId);
    },
    onNetworkRecovery: async (tenantId, userId) => {
      await refreshDashboardForTenant(tenantId, { offlineOverride: false });
      await warmCriticalOfflineCaches(tenantId, userId);
    },
  });

  // Periodic cache warm every 5 minutes while online and logged in.
  // Ensures offline data stays fresh without relying solely on sync events.
  useEffect(() => {
    if (!session || !networkReachable || !tenant?.tenant_id || !userProfile?.user_id) return;

    const WARM_INTERVAL_MS = 5 * 60 * 1000;
    const timer = setInterval(() => {
      warmCriticalOfflineCaches(tenant.tenant_id, userProfile.user_id);
      if (currentScreen === 'Home') {
        refreshDashboardForTenant(tenant.tenant_id, { offlineOverride: false });
      }
    }, WARM_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [currentScreen, refreshDashboardForTenant, session, networkReachable, tenant?.tenant_id, userProfile?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (localLlmMode === 'endpoint') return;
    if (!session || offlineMode || !networkReachable || !tenant?.tenant_id || !userProfile?.user_id) return;

    warmEmbeddedModelInBackground().catch(() => {
      // best-effort: la descarga anticipada no debe afectar el login ni la navegacion
    });
  }, [
    localLlmMode,
    session,
    offlineMode,
    networkReachable,
    tenant?.tenant_id,
    userProfile?.user_id,
  ]);


  const handleLogout = async () => {
    setError('');

    // Sin red: cerrar sesión localmente y advertir que necesitará conexión para volver a entrar.
    if (!networkReachable) {
      await supabase.auth.signOut({ scope: 'local' });
      await clearAuthCache();
      await clearMenuCache();
      setSession(null);
      setUserProfile(null);
      setTenant(null);
      resetDashboard();
      setOfflineAvailable(false);
      setCachedAt('');
      setTenantSettings({});
      setRawMenuTree([]);
      setMenuTree([]);
      setMenuCachedAt('');
      setExpandedSections({});
      setMenuOpen(false);
      setLastMenuAction('');
      resetNotifications();
      resetToHome();
      setReportsInitialTab('sales');
      setPendingOpsCount(0);
      setUserExplicitlyLoggedOut(true);
      setError('Sesión cerrada sin conexión. Necesitarás internet para volver a iniciar sesión.');
      await applyThemeFromLocalCache();
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      return;
    }

    await clearAuthCache();
    await clearMenuCache();
    setSession(null);
    setUserProfile(null);
    setTenant(null);
    resetDashboard();
    setOfflineAvailable(false);
    setCachedAt('');
    setTenantSettings({});
    setRawMenuTree([]);
    resetToHome();
    setReportsInitialTab('sales');
    setMenuTree([]);
    setMenuCachedAt('');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
    resetNotifications();
    setPendingOpsCount(0);
    setUserExplicitlyLoggedOut(true);
    await applyThemeFromLocalCache();
  };

  const handleUseOfflineMode = async () => {
    setError('');
    const cached = await getAuthCache();
    const cachedMenu = await getMenuCache();
    if (!cached) {
      setError(APP_TEXT.noOfflineCache);
      return;
    }
    setUserProfile(cached.userProfile);
    setTenant(cached.tenant);
    await loadTenantConfig(cached?.tenant?.tenant_id, {
      forceOffline: true,
      userId: cached?.userProfile?.user_id,
    });
    resetDashboard();
    resetToHome();
    setCachedAt(cached.cachedAt);
    if (cachedMenu?.menuTree) {
      setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
      setMenuTree(annotateMenuTreeWithSupport(cachedMenu.menuTree));
      setMenuCachedAt(cachedMenu.cachedAt);
    } else {
      setRawMenuTree([]);
      setMenuTree([]);
      setMenuCachedAt('');
    }
    setExpandedSections({});
    setLastMenuAction('');
    // offlineMode es derivado — setUserExplicitlyLoggedOut(false) permite mostrar la app
    setUserExplicitlyLoggedOut(false);
    resetNotifications();
    const pendingCount = await getPendingOpsCount({
      tenantId: cached?.tenant?.tenant_id || null,
      userId: cached?.userProfile?.user_id || null,
    });
    setPendingOpsCount(pendingCount);
    await refreshDashboardForTenant(cached?.tenant?.tenant_id, { offlineOverride: true });
  };

  const handleClearOfflineCache = async () => {
    await clearAuthCache();
    await clearMenuCache();
    await clearOfflineOperationalData();
    setOfflineAvailable(false);
    setCachedAt('');
    setTenantSettings({});
    setRawMenuTree([]);
    setMenuTree([]);
    setMenuCachedAt('');
    resetToHome();
    setReportsInitialTab('sales');
    setThemePreference('dark');
    setThemeMode('dark');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
    resetNotifications();
    setPendingOpsCount(0);
  };

  if (loadingBoot || loadingProfile) {
    return (
      <ThemeModeProvider mode={themeMode}>
        <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.centered}>
          <ActivityIndicator size="large" color={SCREEN_ACCENT_COLORS.Sales} />
          <Text style={styles.loadingText}>Inicializando app offline-first...</Text>
          <Text style={[styles.loadingText, { fontSize: 11, marginTop: 4, opacity: 0.5 }]}>{bootStep}</Text>
          <StatusBar style="auto" />
        </SafeAreaView>
      </ThemeModeProvider>
    );
  }

  const isLightTheme = themeMode === 'light';
  const appContentBottomInset = safeAreaBottomInset;

  // Mostrar login si: no hay sesión activa Y (no hay caché offline O el usuario cerró sesión) Y no estamos cargando desde caché
  if (!session && (!offlineAvailable || userExplicitlyLoggedOut) && !bootingFromCache) {
    return (
      <ThemeModeProvider mode={themeMode}>
        <LoginScreen
          email={email}
          password={password}
          error={error}
          loadingAuth={loadingAuth}
          offlineAvailable={offlineAvailable}
          cachedAt={cachedAt}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onLogin={handleLogin}
          onUseOfflineMode={handleUseOfflineMode}
          onClearOfflineCache={handleClearOfflineCache}
        />
      </ThemeModeProvider>
    );
  }

  return (
    <ThemeModeProvider mode={themeMode}>
      <SafeAreaView edges={['left', 'right']} style={isLightTheme ? styles.root : styles.rootDark}>
      <View
        pointerEvents="none"
        style={[styles.brandGlowTop, isLightTheme ? styles.brandGlowTopLight : null]}
      />
      <View
        pointerEvents="none"
        style={[styles.brandGlowBottom, isLightTheme ? styles.brandGlowBottomLight : null]}
      />
      <AppBar
        isLightTheme={isLightTheme}
        currentScreen={currentScreen}
        safeAreaTopInset={safeAreaTopInset}
        onMenuOpen={() => setMenuOpen(true)}
        onOpenNotifications={handleOpenNotifications}
        unreadNotifications={unreadNotifications}
        offlineMode={offlineMode}
        pendingOpsCount={pendingOpsCount}
        onGoBack={goBack}
        onOpenSyncQueue={() => setSyncQueueOpen(true)}
      />

      <MenuDrawer
        visible={menuOpen}
        isLightTheme={isLightTheme}
        menuTree={menuTree}
        menuDisplayMode={menuDisplayMode}
        expandedSections={expandedSections}
        userProfile={userProfile}
        userEmail={userEmail}
        tenant={tenant}
        appContentBottomInset={appContentBottomInset}
        onClose={() => setMenuOpen(false)}
        onLogout={handleLogout}
        onThemeToggle={() => handleLocalThemeChange(isLightTheme ? 'dark' : 'light')}
        onMenuDisplayModeChange={handleMenuDisplayModeChange}
        onMenuAction={handleMenuAction}
        onToggleSection={toggleSection}
        canAccessScreenByMenu={canAccessScreenByMenu}
        resolveMenuAccent={resolveMenuAccent}
        resolveMenuIcon={resolveMenuIcon}
      />

      <NotificationsModal
        visible={notificationsOpen}
        isLightTheme={isLightTheme}
        notifications={notifications}
        loadingNotifications={loadingNotifications}
        onClose={() => setNotificationsOpen(false)}
        onMarkRead={handleMarkNotificationRead}
        onMarkAllRead={handleMarkAllNotificationsRead}
        formatDateTime={formatDateTime}
      />

      <SyncQueueModal
        visible={syncQueueOpen}
        isLightTheme={isLightTheme}
        tenantId={tenant?.tenant_id}
        userId={userProfile?.user_id}
        offlineMode={offlineMode}
        onClose={() => setSyncQueueOpen(false)}
        onQueueChange={() =>
          getPendingOpsCount({
            tenantId: tenant?.tenant_id,
            userId: userProfile?.user_id || null,
          }).then(setPendingOpsCount)}
      />

      <View
        style={[
          styles.moduleShell,
          appContentBottomInset > 0 ? { paddingBottom: appContentBottomInset } : null,
        ]}
      >
      {currentScreen === 'Home' ? (
        <HomeScreen
          isLightTheme={isLightTheme}
          kpis={kpis}
          loadingKpis={loadingKpis}
          homeLast7Series={homeLast7Series}
          homeMaxDaily={homeMaxDaily}
          homePrimaryActions={homePrimaryActions}
          homeBarColors={HOME_BAR_COLORS}
          appContentBottomInset={appContentBottomInset}
          lastMenuAction={lastMenuAction}
          error={error}
          formatMoney={formatMoney}
          navigateToScreen={navigateToScreen}
          onRefreshDashboard={refreshHomeDashboard}
          resolveMenuAccent={resolveMenuAccent}
          resolveMenuIcon={resolveMenuIcon}
        />
      ) : (
        <ActiveModuleScreen
          currentScreen={currentScreen}
          tenant={tenant}
          userProfile={userProfile}
          tenantSettings={tenantSettings}
          themeMode={themeMode}
          offlineMode={offlineMode}
          onPendingOpsChange={setPendingOpsCount}
          onPointOfSaleSaleCompleted={handlePointOfSaleSaleCompleted}
          formatMoney={formatMoney}
          pendingOpsCount={pendingOpsCount}
          pageSize={defaultPageSize}
          reportsInitialTab={reportsInitialTab}
          navigateToScreen={navigateToScreen}
          handleLocalThemeChange={handleLocalThemeChange}
        />
      )}
      </View>
      <StatusBar
        style={isLightTheme ? 'dark' : 'light'}
        backgroundColor={isLightTheme ? APP_THEME_COLORS.light.statusBarBackground : APP_THEME_COLORS.dark.statusBarBackground}
        translucent={false}
      />
      </SafeAreaView>
    </ThemeModeProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: APP_THEME_COLORS.light.rootBackground,
  },
  rootDark: {
    flex: 1,
    backgroundColor: APP_THEME_COLORS.dark.rootBackground,
  },
  brandGlowTop: {
    position: 'absolute',
    top: -90,
    right: -60,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: APP_THEME_COLORS.shared.brandGlowTopDark,
    opacity: 0.22,
  },
  brandGlowTopLight: {
    backgroundColor: APP_THEME_COLORS.shared.brandGlowTopLight,
    opacity: 0.18,
  },
  brandGlowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 999,
    backgroundColor: APP_THEME_COLORS.shared.brandGlowBottomDark,
    opacity: 0.16,
  },
  brandGlowBottomLight: {
    backgroundColor: APP_THEME_COLORS.shared.brandGlowBottomLight,
    opacity: 0.12,
  },
  moduleShell: {
    flex: 1,
  },
  centered: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#334155',
  },
});
