import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { ACCESS_COOKIE_NAME } from '../src/auth/constants.js'
import { signAccessToken } from '../src/auth/crypto.js'
import { AuthService } from '../src/auth/service.js'
import type { AuthRuntime } from '../src/auth/runtime.js'
import type { AuthConfig } from '../src/config/env.js'
import { MarketingPageImageService } from '../src/marketing/service.js'
import type { MarketingPageImageRuntime } from '../src/marketing/runtime.js'
import { InMemoryAuthRepository } from './helpers/in-memory-auth-repository.js'
import { InMemoryMarketingPageImageRepository } from './helpers/in-memory-marketing-page-image-repository.js'

const origin = 'https://admin.example.invalid'; const secret = 'marketing-api-test-secret-more-than-thirty-two-characters'; const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const config: AuthConfig = { databaseUrl: 'postgresql://unused:unused@localhost:5432/unused', jwtSecret: secret, allowedOrigins: [origin], publicAllowedOrigins: ['https://public.example.invalid'], isProduction: false }
describe('marketing page images', () => {
  let app: ReturnType<typeof createApp>; let token: string
  beforeAll(async () => { token = await signAccessToken({ id: adminId, role: 'ADMIN' }, secret) })
  beforeEach(() => { const auth = new InMemoryAuthRepository(); auth.addUser({ id: adminId, name: 'Admin', email: 'admin@example.invalid', passwordHash: '$argon2id$test', role: 'ADMIN', isActive: true }); const authRuntime: AuthRuntime = { getConfig: () => config, getService: () => new AuthService(auth, secret) }; const service = new MarketingPageImageService(new InMemoryMarketingPageImageRepository()); const runtime: MarketingPageImageRuntime = { getService: () => service }; app = createApp({ authRuntime, marketingPageImageRuntime: runtime }) })
  const admin = (method: string, body?: unknown) => app.request('/api/v1/admin/marketing/pages/HOME/images', { method, headers: { Origin: origin, Cookie: `${ACCESS_COOKIE_NAME}=${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  it('preserves public static-image fallback until an Admin configures optional fields', async () => {
    await expect((await app.request('/api/v1/marketing/pages/HOME/images')).json()).resolves.toMatchObject({ data: { pageKey: 'HOME', heroImageUrl: null, ctaImageUrl: null, updatedAt: null } })
    expect((await admin('PATCH', { heroImageUrl: 'https://example.invalid/hero.webp', heroImageAltAr: 'صورة الغلاف' })).status).toBe(200)
    await expect((await app.request('/api/v1/marketing/pages/HOME/images')).json()).resolves.toMatchObject({ data: { heroImageUrl: 'https://example.invalid/hero.webp', heroImageAltAr: 'صورة الغلاف' } })
    expect((await admin('PATCH', { heroImageUrl: null, heroImageAltAr: null })).status).toBe(200)
  })
  it('requires Admin authentication, trusted origin, recognized page key, and HTTPS URLs', async () => {
    expect((await app.request('/api/v1/admin/marketing/pages/HOME/images')).status).toBe(401)
    expect((await app.request('/api/v1/marketing/pages/OTHER/images')).status).toBe(400)
    expect((await admin('PATCH', { ctaImageUrl: 'http://example.invalid/a.webp' })).status).toBe(400)
  })
})
