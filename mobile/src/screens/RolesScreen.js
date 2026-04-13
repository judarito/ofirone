import { Pressable, StyleSheet, Text, View } from 'react-native';
import ListHeaderActionButton from '../components/ListHeaderActionButton';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useAndroidBottomInset } from '../lib/useAndroidBottomInset';
import { useThemeMode } from '../lib/themeMode';
import { listRoles } from '../services/rolesMenus.service';

function resolveIsSuperAdmin(userProfile) {
  const roleNames = new Set((userProfile?.roles || []).map((role) => String(role?.name || '').toUpperCase()));
  const permissionCodes = new Set((userProfile?.permissionCodes || []).map((code) => String(code || '').toUpperCase()));
  return roleNames.has('SUPERADMIN') || permissionCodes.has('SUPERADMIN.MANAGE');
}

export default function RolesScreen({
  tenant,
  userProfile,
  offlineMode,
  pageSize = 20,
  onOpenScreen,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const androidBottomInset = useAndroidBottomInset();
  const isSuperAdmin = resolveIsSuperAdmin(userProfile);

  const {
    items,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    refreshing,
    reload,
    changePage,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'roles-readonly',
    initialFilters: { search: '' },
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listRoles({
        tenantId,
        limit: nextPageSize,
        offset,
      });
    },
  });
  const safeTotalPages = Math.max(1, Number(totalPages || 1));

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.noticeCard, isLightTheme && styles.noticeCardLight]}>
        <Text style={[styles.noticeTitle, isLightTheme && styles.noticeTitleLight]}>
          Roles del tenant
        </Text>
        <Text style={[styles.noticeCopy, isLightTheme && styles.noticeCopyLight]}>
          Esta ruta muestra el catálogo de roles y sus permisos asignados. La edición avanzada vive aparte para no mezclar consulta con administración.
        </Text>
        {isSuperAdmin ? (
          <Pressable
            onPress={() => onOpenScreen?.('RolesMenus')}
            style={[styles.noticeAction, isLightTheme && styles.noticeActionLight]}
          >
            <Text style={[styles.noticeActionText, isLightTheme && styles.noticeActionTextLight]}>
              Abrir Roles y Menús
            </Text>
          </Pressable>
        ) : null}
      </View>

      <PaginatedList
        title="Roles"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay roles registrados."
        page={page}
        totalPages={safeTotalPages}
        onPrev={() => changePage(Math.max(1, page - 1))}
        onNext={() => changePage(Math.min(safeTotalPages, page + 1))}
        onRefresh={reload}
        refreshing={refreshing}
        themeMode={themeMode}
        bottomInset={androidBottomInset}
        headerRight={
          isSuperAdmin
            ? (
              <ListHeaderActionButton
                label="Gestionar"
                onPress={() => onOpenScreen?.('RolesMenus')}
                themeMode={themeMode}
              />
            )
            : null
        }
        footerMeta={
          cacheInfo?.cachedAt
            ? `Caché disponible · ${cacheInfo.cachedAt}`
            : 'Solo lectura en esta vista.'
        }
        renderItem={(item) => (
          <View
            key={item.role_id}
            style={[styles.roleCard, isLightTheme && styles.roleCardLight]}
          >
            <View style={styles.roleHeader}>
              <Text style={[styles.roleName, isLightTheme && styles.roleNameLight]}>{item.name}</Text>
              <View style={[styles.roleChip, isLightTheme && styles.roleChipLight]}>
                <Text style={[styles.roleChipText, isLightTheme && styles.roleChipTextLight]}>
                  {(item.role_permissions || []).length} permisos
                </Text>
              </View>
            </View>
            <Text style={[styles.roleSummary, isLightTheme && styles.roleSummaryLight]}>
              {isSuperAdmin
                ? 'Consulta aquí y usa Roles y Menús para cambios estructurales.'
                : 'Consulta de permisos asignados para este tenant.'}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12,
    backgroundColor: '#060b16',
  },
  containerLight: {
    backgroundColor: '#edf2fb',
  },
  noticeCard: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
    marginBottom: 10,
  },
  noticeCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  noticeTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 16,
  },
  noticeTitleLight: {
    color: '#0f172a',
  },
  noticeCopy: {
    color: '#9fb7dc',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  noticeCopyLight: {
    color: '#47638b',
  },
  noticeAction: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#335487',
    borderRadius: 10,
    backgroundColor: '#142745',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeActionLight: {
    borderColor: '#cfe0f6',
    backgroundColor: '#eef5ff',
  },
  noticeActionText: {
    color: '#bfdbfe',
    fontWeight: '700',
    fontSize: 12,
  },
  noticeActionTextLight: {
    color: '#1d4ed8',
  },
  roleCard: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
    marginBottom: 8,
  },
  roleCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  roleName: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  roleNameLight: {
    color: '#0f172a',
  },
  roleChip: {
    borderWidth: 1,
    borderColor: '#29456d',
    backgroundColor: '#11203a',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  roleChipLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#eff5ff',
  },
  roleChipText: {
    color: '#9fb7dc',
    fontSize: 11,
    fontWeight: '700',
  },
  roleChipTextLight: {
    color: '#47638b',
  },
  roleSummary: {
    color: '#9fb7dc',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  roleSummaryLight: {
    color: '#47638b',
  },
});
