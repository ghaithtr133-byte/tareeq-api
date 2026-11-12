import { ApiError } from '../shared/http.js'
import type {
  FaqCreateInput,
  FaqListQuery,
  FaqParent,
  FaqRepository,
  FaqScope,
  FaqUpdateInput,
} from './types.js'

const mutationError = (outcome: 'NOT_FOUND' | 'PARENT_NOT_FOUND' | 'INVALID_TRANSLATION') => ({
  NOT_FOUND: new ApiError(404, 'FAQ_NOT_FOUND', 'FAQ entry not found.'),
  PARENT_NOT_FOUND: new ApiError(400, 'FAQ_PARENT_NOT_FOUND', 'The selected FAQ parent does not exist.', {
    fields: { parentId: ['Select an existing content resource matching the requested scope.'] },
  }),
  INVALID_TRANSLATION: new ApiError(400, 'FAQ_TRANSLATION_INCOMPLETE', 'English question and answer must be provided or cleared together.', {
    fields: { questionEn: ['Provide both English fields or set both to null.'], answerEn: ['Provide both English fields or set both to null.'] },
  }),
})[outcome]

export class FaqService {
  constructor(
    private readonly repository: FaqRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listGlobal(page: number, limit: number) {
    return this.publicPaginated(await this.repository.list({ scope: 'GLOBAL', parentId: null, page, limit }, true), page, limit)
  }

  async listPublic(scope: Exclude<FaqScope, 'GLOBAL'>, slug: string, page: number, limit: number) {
    const parentId = await this.repository.resolvePublishedParent(scope, slug)
    if (!parentId) throw new ApiError(404, 'FAQ_PARENT_NOT_FOUND', 'Content resource not found.')
    return this.publicPaginated(await this.repository.list({ scope, parentId, page, limit }, true), page, limit)
  }

  async listAdmin(query: FaqListQuery) {
    this.validateParentShape(query)
    if (!await this.repository.parentExists(query)) throw mutationError('PARENT_NOT_FOUND')
    return this.paginated(await this.repository.list(query, false), query.page, query.limit)
  }

  async create(input: FaqCreateInput, actorAdminId: string) {
    this.validateParentShape(input)
    if (!await this.repository.parentExists(input)) throw mutationError('PARENT_NOT_FOUND')
    const result = await this.repository.create(input, actorAdminId, this.now())
    if (result.outcome !== 'UPDATED') throw mutationError(result.outcome)
    return result.record
  }

  async update(id: string, input: FaqUpdateInput, actorAdminId: string) {
    if (input.scope !== undefined) this.validateParentShape({ scope: input.scope, parentId: input.parentId ?? null })
    const result = await this.repository.update(id, input, actorAdminId, this.now())
    if (result.outcome !== 'UPDATED') throw mutationError(result.outcome)
    return result.record
  }

  async delete(id: string, actorAdminId: string) {
    const result = await this.repository.delete(id, actorAdminId)
    if (result.outcome === 'NOT_FOUND') throw mutationError('NOT_FOUND')
    if (result.outcome === 'PUBLISHED') throw new ApiError(409, 'FAQ_PUBLISHED_DELETE_FORBIDDEN', 'Published FAQs must be archived instead of deleted.')
    return { id }
  }

  async reorder(parent: FaqParent, orderedIds: string[], actorAdminId: string) {
    this.validateParentShape(parent)
    const result = await this.repository.reorder(parent, orderedIds, actorAdminId)
    if (result.outcome === 'PARENT_NOT_FOUND') throw mutationError(result.outcome)
    if (result.outcome === 'ORDER_SET_MISMATCH') {
      throw new ApiError(409, 'FAQ_ORDER_SET_MISMATCH', 'The ordered IDs must contain every non-archived FAQ for exactly one parent.', {
        fields: { orderedIds: ['Refresh the FAQ list and submit every non-archived ID exactly once.'] },
      })
    }
    if (result.outcome !== 'UPDATED') throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.')
    return { items: result.records }
  }

  private validateParentShape(parent: FaqParent) {
    if (parent.scope === 'GLOBAL' ? parent.parentId !== null : parent.parentId === null) {
      throw new ApiError(400, 'FAQ_PARENT_INVALID', 'FAQ scope and parent do not match.', {
        fields: { parentId: [parent.scope === 'GLOBAL' ? 'GLOBAL FAQs cannot have a parent.' : 'A parentId is required for this scope.'] },
      })
    }
  }

  private paginated<T>(result: { items: T[]; total: number }, page: number, limit: number) {
    return {
      items: result.items,
      pagination: { page, limit, total: result.total, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / limit) },
    }
  }

  private publicPaginated(result: Awaited<ReturnType<FaqRepository['list']>>, page: number, limit: number) {
    return this.paginated({
      total: result.total,
      items: result.items.map(({ id, scope, questionAr, answerAr, questionEn, answerEn, displayOrder, publishedAt }) => ({
        id, scope, questionAr, answerAr, questionEn, answerEn, displayOrder, publishedAt,
      })),
    }, page, limit)
  }
}
