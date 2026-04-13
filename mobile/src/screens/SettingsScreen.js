import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MENU_DISPLAY_MODE_GRID,
  MENU_DISPLAY_MODE_LIST,
} from '../lib/menuDisplayMode';

const THEME_OPTIONS = [
  { key: 'light', label: 'Claro', icon: 'sunny-outline' },
  { key: 'dark', label: 'Oscuro', icon: 'moon-outline' },
  { key: 'auto', label: 'Auto', icon: 'contrast-outline' },
];

const MENU_OPTIONS = [
  { key: MENU_DISPLAY_MODE_LIST, label: 'Lista', icon: 'list-outline' },
  { key: MENU_DISPLAY_MODE_GRID, label: 'Cuadrícula', icon: 'grid-outline' },
];

function PreferenceOption({
  item,
  active,
  isLightTheme,
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.optionCard,
        isLightTheme && styles.optionCardLight,
        active && styles.optionCardActive,
        active && isLightTheme && styles.optionCardActiveLight,
      ]}
    >
      <Ionicons
        name={item.icon}
        size={18}
        color={active ? (isLightTheme ? '#1d4ed8' : '#f8fafc') : (isLightTheme ? '#607b9f' : '#9fb3d3')}
      />
      <Text
        style={[
          styles.optionLabel,
          isLightTheme && styles.optionLabelLight,
          active && styles.optionLabelActive,
          active && isLightTheme && styles.optionLabelActiveLight,
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

function InfoRow({ label, value, isLightTheme }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, isLightTheme && styles.infoLabelLight]}>{label}</Text>
      <Text style={[styles.infoValue, isLightTheme && styles.infoValueLight]}>{value}</Text>
    </View>
  );
}

export default function SettingsScreen({
  tenant,
  userProfile,
  themeMode = 'dark',
  themePreference = 'dark',
  menuDisplayMode = MENU_DISPLAY_MODE_LIST,
  tenantSettings = {},
  onThemeChange,
  onMenuDisplayModeChange,
  onOpenScreen,
}) {
  const isLightTheme = themeMode === 'light';

  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>Preferencias de la app</Text>
        <Text style={[styles.cardCopy, isLightTheme && styles.cardCopyLight]}>
          Ajustes personales de visualización y acceso rápido. La configuración empresarial sigue separada.
        </Text>

        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Tema</Text>
        <View style={styles.optionGrid}>
          {THEME_OPTIONS.map((item) => (
            <PreferenceOption
              key={item.key}
              item={item}
              active={themePreference === item.key}
              isLightTheme={isLightTheme}
              onPress={() => onThemeChange?.(item.key)}
            />
          ))}
        </View>

        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Vista del menú</Text>
        <View style={styles.optionGrid}>
          {MENU_OPTIONS.map((item) => (
            <PreferenceOption
              key={item.key}
              item={item}
              active={menuDisplayMode === item.key}
              isLightTheme={isLightTheme}
              onPress={() => onMenuDisplayModeChange?.(item.key)}
            />
          ))}
        </View>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>Perfil actual</Text>
        <InfoRow
          label="Usuario"
          value={userProfile?.full_name || userProfile?.email || 'Sin usuario'}
          isLightTheme={isLightTheme}
        />
        <InfoRow
          label="Correo"
          value={userProfile?.email || 'Sin correo'}
          isLightTheme={isLightTheme}
        />
        <InfoRow
          label="Tenant"
          value={tenant?.tenant_name || tenant?.name || 'Sin tenant'}
          isLightTheme={isLightTheme}
        />
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>Contexto operativo</Text>
        <InfoRow
          label="Página por defecto"
          value={String(tenantSettings?.default_page_size || 20)}
          isLightTheme={isLightTheme}
        />
        <InfoRow
          label="Idioma / locale"
          value={tenantSettings?.locale || 'es-CO'}
          isLightTheme={isLightTheme}
        />
        <InfoRow
          label="Formato fecha"
          value={tenantSettings?.date_format || 'DD/MM/YYYY'}
          isLightTheme={isLightTheme}
        />
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>Accesos rápidos</Text>
        <View style={styles.quickActions}>
          <Pressable
            onPress={() => onOpenScreen?.('TenantConfig')}
            style={[styles.quickAction, isLightTheme && styles.quickActionLight]}
          >
            <Ionicons name="business-outline" size={18} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
            <Text style={[styles.quickActionText, isLightTheme && styles.quickActionTextLight]}>Empresa</Text>
          </Pressable>
          <Pressable
            onPress={() => onOpenScreen?.('HelpCenter')}
            style={[styles.quickAction, isLightTheme && styles.quickActionLight]}
          >
            <Ionicons name="help-circle-outline" size={18} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
            <Text style={[styles.quickActionText, isLightTheme && styles.quickActionTextLight]}>Centro de Ayuda</Text>
          </Pressable>
          <Pressable
            onPress={() => onOpenScreen?.('Setup')}
            style={[styles.quickAction, isLightTheme && styles.quickActionLight]}
          >
            <Ionicons name="settings-outline" size={18} color={isLightTheme ? '#1d4ed8' : '#93c5fd'} />
            <Text style={[styles.quickActionText, isLightTheme && styles.quickActionTextLight]}>Configuración</Text>
          </Pressable>
        </View>
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
  card: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 16,
    backgroundColor: '#0f182b',
    padding: 14,
    marginBottom: 10,
  },
  cardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
  },
  cardTitleLight: {
    color: '#0f172a',
  },
  cardCopy: {
    color: '#9fb7dc',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  cardCopyLight: {
    color: '#47638b',
  },
  sectionTitle: {
    color: '#dbeafe',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitleLight: {
    color: '#334155',
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionCard: {
    width: '31%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#334d74',
    backgroundColor: '#11203a',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
  },
  optionCardLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#eff5ff',
  },
  optionCardActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#1d4ed8',
  },
  optionCardActiveLight: {
    borderColor: '#93c5fd',
    backgroundColor: '#dbeafe',
  },
  optionLabel: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  optionLabelLight: {
    color: '#334155',
  },
  optionLabelActive: {
    color: '#f8fafc',
  },
  optionLabelActiveLight: {
    color: '#1d4ed8',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#223a5e',
  },
  infoLabel: {
    color: '#9fb7dc',
    fontSize: 12,
  },
  infoLabelLight: {
    color: '#607b9f',
  },
  infoValue: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    flex: 1,
  },
  infoValueLight: {
    color: '#0f172a',
  },
  quickActions: {
    marginTop: 10,
    gap: 8,
  },
  quickAction: {
    borderWidth: 1,
    borderColor: '#29456d',
    backgroundColor: '#101d34',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickActionLight: {
    borderColor: '#d8e5f5',
    backgroundColor: '#f8fbff',
  },
  quickActionText: {
    color: '#dbeafe',
    fontSize: 13,
    fontWeight: '700',
  },
  quickActionTextLight: {
    color: '#1d4ed8',
  },
});
