import { ApiError } from '../shared/http.js'
import {
  aboutUsFields,
  type AboutUsRecord,
  type AboutUsRepository,
  type AboutUsUpdate,
} from './types.js'

const notFound = () => new ApiError(404, 'CONTENT_NOT_FOUND', 'About Us content not found.')

const publicationError = (fields: Record<string, string[]>) => new ApiError(
  400,
  'PUBLICATION_REQUIREMENTS_NOT_MET',
  'The About Us page cannot be published until required Arabic content is complete.',
  { fields },
)

const hasText = (value: string | null | undefined) => Boolean(value?.trim())

const publicView = (record: AboutUsRecord) => {
  const publicRecord = { ...record }
  delete (publicRecord as Partial<AboutUsRecord>).status
  delete (publicRecord as Partial<AboutUsRecord>).createdAt
  return publicRecord
}

export class AboutUsService {
  constructor(private readonly repository: AboutUsRepository) {}

  async getPublic() {
    const record = await this.repository.find()
    if (!record || record.status !== 'PUBLISHED') throw notFound()
    return publicView(record)
  }

  async getAdmin() {
    const record = await this.repository.find()
    if (!record) throw notFound()
    return record
  }

  async update(actorAdminId: string, input: AboutUsUpdate) {
    const current = await this.repository.find()
    const next = {
      ...Object.fromEntries(aboutUsFields.map((field) => [field, null])),
      ...current,
      ...input,
      status: input.status ?? current?.status ?? 'DRAFT',
    } as Pick<AboutUsRecord, typeof aboutUsFields[number]> & { status: AboutUsRecord['status'] }
    this.validate(next)
    const record = await this.repository.update(actorAdminId, input)
    if (!record) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.')
    return record
  }

  private validate(next: Pick<AboutUsRecord, typeof aboutUsFields[number]> & { status: AboutUsRecord['status'] }) {
    const fields: Record<string, string[]> = {}
    if (next.status === 'PUBLISHED') {
      for (const field of ['heroTitleAr', 'heroSubtitleAr', 'introTitleAr', 'introBodyAr'] as const) {
        if (!hasText(next[field])) fields[field] = ['Required before publication.']
      }
    }
    for (const [imageField, altFields] of [
      ['heroImageUrl', ['heroImageAltAr', 'heroImageAltEn']],
      ['introImageUrl', ['introImageAltAr', 'introImageAltEn']],
    ] as const) {
      if (!next[imageField]) {
        for (const field of altFields) {
          if (next[field]) fields[field] = ['Provide its corresponding image URL or clear this alternative text.']
        }
      }
    }
    if (Object.keys(fields).length > 0) throw publicationError(fields)
  }
}
