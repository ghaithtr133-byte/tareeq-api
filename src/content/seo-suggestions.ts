import { z } from '@hono/zod-openapi'

import { getGeminiConfig, type GeminiConfig } from '../config/env.js'
import { getPrisma } from '../database/client.js'
import { ApiError } from '../shared/http.js'
import { seoDescriptionArSchema, seoTitleArSchema } from './schemas.js'

const REQUEST_TIMEOUT_MS = 10_000

export const articleSeoSuggestionSchema = z.object({
  seoTitleAr: seoTitleArSchema,
  seoDescriptionAr: seoDescriptionArSchema,
}).openapi('ArticleSeoSuggestion')

type ArticleSeoSource = { titleAr: string; summaryAr: string; bodyAr: unknown }

export interface ArticleSeoSuggestionRepository {
  findArticleSeoSource(id: string): Promise<ArticleSeoSource | null>
  consumeGeminiDailyQuota(day: Date, limit: number): Promise<boolean>
}

export interface GeminiSeoClient {
  suggest(source: { titleAr: string; summaryAr: string; bodyAr: string }): Promise<unknown>
}

const arabicBodyText = (body: unknown) => Array.isArray(body)
  ? body.flatMap((block) => block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
    ? [(block as { text: string }).text.trim()]
    : []).filter(Boolean).join('\n').slice(0, 20_000)
  : ''

const utcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

export class PrismaArticleSeoSuggestionRepository implements ArticleSeoSuggestionRepository {
  async findArticleSeoSource(id: string) {
    return getPrisma().article.findUnique({ where: { id }, select: { titleAr: true, summaryAr: true, bodyAr: true } })
  }

  async consumeGeminiDailyQuota(day: Date, limit: number) {
    const rows = await getPrisma().$queryRaw<Array<{ count: number }>>`
      INSERT INTO "GeminiSeoDailyQuota" ("day", "count", "updatedAt")
      VALUES (${day}, 1, NOW())
      ON CONFLICT ("day") DO UPDATE
        SET "count" = "GeminiSeoDailyQuota"."count" + 1, "updatedAt" = NOW()
        WHERE "GeminiSeoDailyQuota"."count" < ${limit}
      RETURNING "count"
    `
    return rows.length === 1
  }
}

export class GeminiApiSeoClient implements GeminiSeoClient {
  constructor(private readonly config: GeminiConfig) {}

  async suggest(source: { titleAr: string; summaryAr: string; bodyAr: string }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: [
            'اكتب اقتراحين لتحسين محركات البحث بالعربية اعتماداً حصراً على محتوى المقال التالي.',
            'أعد كائن JSON فقط بالمفاتيح seoTitleAr وseoDescriptionAr. لا تستخدم Markdown أو حقولاً إضافية.',
            `العنوان: ${source.titleAr}`, `الملخص: ${source.summaryAr}`, `النص: ${source.bodyAr}`,
          ].join('\n') }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      })
      if (response.status === 404) throw new ApiError(503, 'SEO_SUGGESTION_MODEL_UNAVAILABLE', 'The configured SEO suggestion model is unavailable.')
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'))
        throw new ApiError(429, 'GEMINI_PROVIDER_QUOTA_EXCEEDED', 'تم تجاوز حد مزود Gemini مؤقتاً. يرجى المحاولة لاحقاً.', Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.ceil(seconds) } : {})
      }
      if (!response.ok) throw new ApiError(502, 'SEO_SUGGESTION_PROVIDER_UNAVAILABLE', 'The SEO suggestion provider is unavailable.')
      const body = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) throw new ApiError(502, 'SEO_SUGGESTION_INVALID_RESPONSE', 'The SEO suggestion provider returned an invalid response.')
      try { return JSON.parse(text) } catch { throw new ApiError(502, 'SEO_SUGGESTION_INVALID_RESPONSE', 'The SEO suggestion provider returned an invalid response.') }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') throw new ApiError(504, 'SEO_SUGGESTION_TIMEOUT', 'The SEO suggestion provider timed out.')
      throw new ApiError(502, 'SEO_SUGGESTION_PROVIDER_UNAVAILABLE', 'The SEO suggestion provider is unavailable.')
    } finally { clearTimeout(timer) }
  }
}

export class ArticleSeoSuggestionService {
  constructor(
    private readonly repository: ArticleSeoSuggestionRepository,
    private readonly client: GeminiSeoClient | undefined,
    private readonly now: () => Date = () => new Date(),
    private readonly dailyLimit = 100,
  ) {}

  async suggest(articleId: string) {
    if (!this.client) throw new ApiError(503, 'SEO_SUGGESTIONS_NOT_CONFIGURED', 'SEO suggestions are not configured.')
    const article = await this.repository.findArticleSeoSource(articleId)
    if (!article) throw new ApiError(404, 'CONTENT_NOT_FOUND', 'Article not found.')
    const bodyAr = arabicBodyText(article.bodyAr)
    if (!bodyAr) throw new ApiError(400, 'SEO_SUGGESTION_SOURCE_INVALID', 'The Article must contain Arabic body content.')
    const now = this.now()
    if (!await this.repository.consumeGeminiDailyQuota(utcDay(now), this.dailyLimit)) {
      throw new ApiError(429, 'GEMINI_DAILY_LIMIT_REACHED', 'تم الوصول إلى الحد اليومي لاقتراحات تحسين محركات البحث. حاول مجدداً غداً.', {
        remainingRequests: 0,
        resetAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(),
      })
    }
    const result = await this.client.suggest({ titleAr: article.titleAr, summaryAr: article.summaryAr, bodyAr })
    const parsed = articleSeoSuggestionSchema.safeParse(result)
    if (!parsed.success) throw new ApiError(502, 'SEO_SUGGESTION_INVALID_RESPONSE', 'The SEO suggestion provider returned an invalid response.')
    return parsed.data
  }
}

let productionService: ArticleSeoSuggestionService | undefined

export const getProductionArticleSeoSuggestionService = () => {
  if (productionService) return productionService
  const config = getGeminiConfig()
  productionService = new ArticleSeoSuggestionService(
    new PrismaArticleSeoSuggestionRepository(),
    config.status === 'CONFIGURED' ? new GeminiApiSeoClient(config) : undefined,
    undefined,
    config.dailyLimit,
  )
  return productionService
}
