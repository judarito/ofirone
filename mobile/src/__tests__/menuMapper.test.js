import {
  annotateMenuTreeWithSupport,
  mapMenuItemToScreen,
  resolveMobileAvailability,
} from '../navigation/menuMapper';

describe('menuMapper', () => {
  it('alinea rutas compartidas con screens equivalentes en mobile', () => {
    expect(mapMenuItemToScreen('/help')).toBe('HelpCenter');
    expect(mapMenuItemToScreen('/settings')).toBe('Settings');
    expect(mapMenuItemToScreen('/roles')).toBe('Roles');
  });

  it('marca accounting y billing como web-only', () => {
    expect(resolveMobileAvailability('/accounting')).toBe('web-only');
    expect(resolveMobileAvailability('/accounting/dashboard')).toBe('web-only');
    expect(resolveMobileAvailability('/superadmin/billing')).toBe('web-only');
  });

  it('anota el arbol de menu con availability explicita', () => {
    const tree = annotateMenuTreeWithSupport([
      {
        code: 'ADMIN',
        label: 'Administración',
        children: [
          { code: 'ADMIN.HELP', label: 'Ayuda', route: '/help' },
          { code: 'ADMIN.ACC', label: 'Contabilidad', route: '/accounting' },
        ],
      },
    ]);

    expect(tree[0].children[0].mobileAvailability).toBe('supported');
    expect(tree[0].children[1].mobileAvailability).toBe('web-only');
    expect(tree[0].children[1].supportedOnMobile).toBe(false);
  });
});
