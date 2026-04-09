import { computed, ref } from 'vue'
import { helpArticles, helpContexts, helpFaqs, helpProcesses } from '@/content/helpCenter'

const CHECKS_STORAGE_KEY = 'ofirone:help-center:checks'
const RECENT_STORAGE_KEY = 'ofirone:help-center:recent'
const MAX_RECENT_ITEMS = 6

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (_) {
    return fallback
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (_) {}
}

export function useHelpCenter() {
  const checklistState = ref(readJsonStorage(CHECKS_STORAGE_KEY, {}))
  const recentArticles = ref(readJsonStorage(RECENT_STORAGE_KEY, []))

  const processes = computed(() => helpProcesses)
  const articles = computed(() => helpArticles)
  const faqs = computed(() => helpFaqs)

  const getArticle = (slug) => articles.value.find((article) => article.slug === slug) || null
  const getFaq = (faqId) => faqs.value.find((faq) => faq.id === faqId) || null
  const getProcess = (processId) => processes.value.find((process) => process.id === processId) || null
  const getHelpContext = (contextKey) => helpContexts[contextKey] || null

  const getArticlesByProcess = (processId) => {
    if (!processId || processId === 'all') return articles.value
    return articles.value.filter((article) => article.process === processId)
  }

  const searchArticles = (query = '', processId = 'all') => {
    const normalizedQuery = String(query || '').trim().toLowerCase()
    const filtered = getArticlesByProcess(processId)

    if (!normalizedQuery) return filtered

    return filtered.filter((article) => {
      const haystack = [
        article.title,
        article.summary,
        article.audience,
        ...(article.prerequisites || []),
        ...(article.steps || []).flatMap((step) => [step.title, step.description]),
        ...(article.commonErrors || []).flatMap((item) => [item.title, item.answer])
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }

  const getArticleProgress = (slug) => {
    const article = getArticle(slug)
    const total = article?.steps?.length || 0
    const doneIds = checklistState.value[slug] || []
    const completed = total > 0 ? article.steps.filter((step) => doneIds.includes(step.id)).length : 0
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

    return {
      total,
      completed,
      percentage,
      isDone: total > 0 && completed === total
    }
  }

  const isArticleStepChecked = (slug, stepId) => {
    return Boolean(checklistState.value[slug]?.includes(stepId))
  }

  const setArticleStepChecked = (slug, stepId, checked) => {
    const next = { ...checklistState.value }
    const current = new Set(next[slug] || [])

    if (checked) current.add(stepId)
    else current.delete(stepId)

    next[slug] = [...current]
    checklistState.value = next
    writeJsonStorage(CHECKS_STORAGE_KEY, next)
  }

  const markArticleViewed = (slug) => {
    if (!slug) return

    const next = [slug, ...recentArticles.value.filter((item) => item !== slug)].slice(0, MAX_RECENT_ITEMS)
    recentArticles.value = next
    writeJsonStorage(RECENT_STORAGE_KEY, next)
  }

  const recentViewedArticles = computed(() => {
    return recentArticles.value
      .map((slug) => getArticle(slug))
      .filter(Boolean)
  })

  return {
    processes,
    articles,
    faqs,
    getArticle,
    getFaq,
    getProcess,
    getHelpContext,
    getArticlesByProcess,
    searchArticles,
    getArticleProgress,
    isArticleStepChecked,
    setArticleStepChecked,
    markArticleViewed,
    recentViewedArticles
  }
}
