import { ApiError } from '../shared/http.js'
import type {
  AuditListQuery,
  AuditRepository,
} from './types.js'

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async list(query: AuditListQuery) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'The request contains invalid fields.',
        { fields: { from: ['The start date must not be after the end date.'] } },
      )
    }

    const result = await this.repository.list(query)
    return {
      items: result.items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: result.total === 0
          ? 0
          : Math.ceil(result.total / query.limit),
      },
    }
  }
}
