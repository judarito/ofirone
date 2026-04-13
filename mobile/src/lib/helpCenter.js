import { HELP_CENTER_ARTICLES, HELP_CENTER_PROCESSES } from '../constants/helpCenterContent';

export function getHelpProcess(processKey) {
  return HELP_CENTER_PROCESSES.find((process) => process.key === processKey) || null;
}

export function getHelpArticle(slug) {
  return HELP_CENTER_ARTICLES.find((article) => article.slug === slug) || null;
}

export function filterHelpArticles(query = '', processKey = 'all') {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  return HELP_CENTER_ARTICLES.filter((article) => {
    if (processKey && processKey !== 'all' && article.process !== processKey) return false;
    if (!normalizedQuery) return true;

    const haystack = [
      article.title,
      article.summary,
      article.audience,
      ...(article.steps || []).flatMap((step) => [step.title, step.description]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}
