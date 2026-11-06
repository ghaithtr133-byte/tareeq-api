// Read-only editorial inventory. It returns identifiers and safe editorial flags only.
import { getPrisma, disconnectPrisma } from '../src/database/client.js'

try {
  const p = getPrisma()
  const [countries, universities, services, articles, faqs, scholarships, galleries] = await Promise.all([
    p.country.findMany({ where: { OR: [{ imageUrl: null }, { imageAltAr: null }] }, select: { id: true, slug: true, imageUrl: true, imageAltAr: true } }),
    p.university.findMany({ where: { OR: [{ universityType: null }, { cityId: null }] }, select: { id: true, slug: true, universityType: true, cityId: true } }),
    p.service.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, slug: true, imageUrl: true } }),
    p.article.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, slug: true, coverImageUrl: true } }),
    p.faqEntry.count({ where: { scope: 'GLOBAL', status: 'PUBLISHED' } }),
    p.scholarship.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, slug: true, officialSourceUrl: true, verifiedDeadline: true, featured: true, titleAr: true } }),
    p.universityGalleryImage.findMany({ where: { OR: [{ imageUrl: { startsWith: 'http://' } }, { imageUrl: { contains: 'example.invalid' } }] }, select: { id: true, universityId: true, imageUrl: true } }),
  ])
  const optionalCheck = async <T>(name: string, operation: () => Promise<T>) => { try { return { status: 'PASS' as const, data: await operation() } } catch (error) { const value = error as { code?: unknown; meta?: { column?: unknown } }; if (value.code === 'P2022') return { status: 'BLOCKED_PENDING_MIGRATION' as const, missingColumn: typeof value.meta?.column === 'string' ? value.meta.column : name }; throw error } }
  const [countryCodes, universityLogos] = await Promise.all([
    optionalCheck('Country.countryCode', () => p.country.findMany({ where: { countryCode: null }, select: { id: true, slug: true } })),
    optionalCheck('University.logoUrl', () => p.university.findMany({ where: { logoUrl: null }, select: { id: true, slug: true } })),
  ])
  const scholarshipFlags = scholarships.map((row) => ({ id: row.id, slug: row.slug, missingOfficialSource: !row.officialSourceUrl, missingVerifiedDeadline: !row.verifiedDeadline, suspiciousTestText: /test|تجريب/i.test(row.titleAr), featuredClosed: row.featured && (row.verifiedDeadline ? row.verifiedDeadline < new Date() : false), adminCreationUrl: /admin|create/i.test(row.officialSourceUrl ?? '') })).filter((row) => Object.values(row).some((value) => value === true))
  console.log(JSON.stringify({ ok: true, status: countryCodes.status === 'BLOCKED_PENDING_MIGRATION' || universityLogos.status === 'BLOCKED_PENDING_MIGRATION' ? 'BLOCKED_PENDING_MIGRATION' : 'COMPLETE', countriesMissingImageOrArabicAlt: countries, universitiesMissingTypeOrCity: universities, countryCodeCheck: countryCodes, universityLogoCheck: universityLogos, publishedServices: services, publishedArticles: articles, publishedGlobalFaqCount: faqs, scholarshipFlags, unusableGalleryUrls: galleries, note: 'Cross-reference demo ownership only with the owner-held committed seed manifest; this command never modifies data.' }, null, 2))
} catch (error) { const value = error as { name?: unknown; code?: unknown; meta?: { column?: unknown } }; console.error(JSON.stringify({ ok: false, error: { name: value.name ?? 'Error', code: value.code ?? null, missingColumn: value.code === 'P2022' ? value.meta?.column ?? null : null, message: 'Read-only editorial audit could not complete.' } })); process.exitCode = 1 } finally { await disconnectPrisma() }
