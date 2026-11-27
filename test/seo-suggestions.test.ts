import { describe, expect, it } from 'vitest'

import { ApiError } from '../src/shared/http.js'
import { ArticleSeoSuggestionService, parseGeminiSeoResponse, type ArticleSeoSuggestionRepository, type GeminiSeoClient } from '../src/content/seo-suggestions.js'

const article = { titleAr: 'دليل الدراسة', summaryAr: 'ملخص الدراسة الجامعية', bodyAr: [{ type: 'paragraph', text: 'محتوى عربي صالح للاقتراح.' }] }

const repository = (allowed = true): ArticleSeoSuggestionRepository => ({
  findArticleSeoSource: async (id) => id === 'a0000000-0000-4000-8000-000000000001' ? article : null,
  consumeGeminiDailyQuota: async () => allowed,
})

const client = (response: unknown): GeminiSeoClient => ({ suggest: async () => response })

describe('ArticleSeoSuggestionService', () => {
  it('accepts structured output across Gemini text parts', () => {
    expect(parseGeminiSeoResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"seoTitleAr":"عنوان"' }, { text: ',"seoDescriptionAr":"وصف صالح"}' }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 } }, 'gemini-3.5-flash-lite')).toEqual({ seoTitleAr: 'عنوان', seoDescriptionAr: 'وصف صالح' })
  })

  it('reports truncated and schema-invalid Gemini output without raw content', () => {
    expect(() => parseGeminiSeoResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }, 'gemini-3.5-flash-lite')).toThrowError(ApiError)
    try { parseGeminiSeoResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"seoTitleAr":"عنوان","seoDescriptionAr":""}' }] } }] }, 'gemini-3.5-flash-lite') } catch (error) {
      expect(error).toMatchObject({ code: 'SEO_SUGGESTION_INVALID_RESPONSE', details: { failureCategory: 'SEO_FIELD_VALIDATION', model: 'gemini-3.5-flash-lite', validationFields: ['seoDescriptionAr'] } })
    }
  })

  it('returns validated suggestions without persisting Article changes', async () => {
    const service = new ArticleSeoSuggestionService(repository(), client({ seoTitleAr: 'دليل الدراسة الجامعية', seoDescriptionAr: 'ملخص عربي صالح لمحركات البحث عن الدراسة الجامعية.' }))
    await expect(service.suggest('a0000000-0000-4000-8000-000000000001')).resolves.toEqual({ seoTitleAr: 'دليل الدراسة الجامعية', seoDescriptionAr: 'ملخص عربي صالح لمحركات البحث عن الدراسة الجامعية.' })
  })

  it('returns the Arabic internal daily-limit contract before invoking Gemini', async () => {
    let calls = 0
    const service = new ArticleSeoSuggestionService(repository(false), { suggest: async () => { calls += 1; return {} } }, () => new Date('2026-11-27T12:00:00.000Z'))
    await expect(service.suggest('a0000000-0000-4000-8000-000000000001')).rejects.toMatchObject({ status: 429, code: 'GEMINI_DAILY_LIMIT_REACHED', details: { remainingRequests: 0, resetAt: '2026-11-28T00:00:00.000Z' } })
    expect(calls).toBe(0)
  })

  it('preserves the provider quota response contract without inventing a reset time', async () => {
    const service = new ArticleSeoSuggestionService(repository(), { suggest: async () => { throw new ApiError(429, 'GEMINI_PROVIDER_QUOTA_EXCEEDED', 'تم تجاوز حد مزود Gemini مؤقتاً. يرجى المحاولة لاحقاً.', { retryAfterSeconds: 30 }) } })
    await expect(service.suggest('a0000000-0000-4000-8000-000000000001')).rejects.toMatchObject({ status: 429, code: 'GEMINI_PROVIDER_QUOTA_EXCEEDED', details: { retryAfterSeconds: 30 } })
  })

  it('rejects invalid Gemini output against existing Article SEO limits', async () => {
    const service = new ArticleSeoSuggestionService(repository(), client({ seoTitleAr: 'عنوان', seoDescriptionAr: '' }))
    await expect(service.suggest('a0000000-0000-4000-8000-000000000001')).rejects.toMatchObject({ status: 502, code: 'SEO_SUGGESTION_INVALID_RESPONSE' })
  })

  it('does not call Gemini when the Article does not exist', async () => {
    let calls = 0
    const service = new ArticleSeoSuggestionService(repository(), { suggest: async () => { calls += 1; return {} } })
    await expect(service.suggest('b0000000-0000-4000-8000-000000000001')).rejects.toMatchObject({ status: 404, code: 'CONTENT_NOT_FOUND' })
    expect(calls).toBe(0)
  })
})
