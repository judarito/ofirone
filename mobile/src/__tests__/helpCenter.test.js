import { filterHelpArticles, getHelpArticle, getHelpProcess } from '../lib/helpCenter';

describe('helpCenter helpers', () => {
  it('resuelve procesos y articulos base', () => {
    expect(getHelpProcess('sales')?.label).toBe('Ventas');
    expect(getHelpArticle('primeros-pasos')?.title).toContain('Primeros pasos');
  });

  it('filtra por proceso y texto', () => {
    const purchaseArticles = filterHelpArticles('', 'purchases');
    expect(purchaseArticles).toHaveLength(1);
    expect(purchaseArticles[0].slug).toBe('compras-operacion');

    const inventorySearch = filterHelpArticles('stock', 'all');
    expect(inventorySearch.some((item) => item.slug === 'inventario-operacion')).toBe(true);
  });

  it('mantiene articulo administrativo con paso web-only', () => {
    const article = getHelpArticle('administracion-mobile');
    expect(article.steps.some((step) => step.webOnly === true)).toBe(true);
  });
});
