import { ApiError } from '../shared/http.js'
import type {
  AdminAccountChange,
  AdminAccountListQuery,
  AdminManagementRepository,
} from './types.js'

export class AdminManagementService {
  constructor(
    private readonly repository: AdminManagementRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(query: AdminAccountListQuery) {
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

  async update(
    actorAdminId: string,
    targetAdminId: string,
    change: AdminAccountChange,
  ) {
    const result = await this.repository.update(
      actorAdminId,
      targetAdminId,
      change,
      this.now(),
    )
    if (result.outcome === 'UPDATED') return result.account

    const errors = {
      NOT_FOUND: new ApiError(404, 'ADMIN_ACCOUNT_NOT_FOUND', 'Administrator account not found.'),
      ACTOR_FORBIDDEN: new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.'),
      SELF_DEACTIVATION_FORBIDDEN: new ApiError(
        409,
        'SELF_DEACTIVATION_FORBIDDEN',
        'You cannot deactivate your own administrator account.',
      ),
      SELF_DEMOTION_FORBIDDEN: new ApiError(
        409,
        'SELF_DEMOTION_FORBIDDEN',
        'You cannot remove your own SUPER_ADMIN role.',
      ),
      LAST_ACTIVE_SUPER_ADMIN: new ApiError(
        409,
        'LAST_ACTIVE_SUPER_ADMIN_REQUIRED',
        'At least one active SUPER_ADMIN account must remain.',
      ),
      UNCHANGED: new ApiError(
        409,
        'ADMIN_ACCOUNT_UNCHANGED',
        'The administrator account already has the requested value.',
      ),
    } as const
    throw errors[result.outcome]
  }
}
