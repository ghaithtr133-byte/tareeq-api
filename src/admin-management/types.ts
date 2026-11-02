import type { AdminRole } from '../auth/types.js'

export type AdminAccount = {
  id: string
  name: string
  email: string
  role: AdminRole
  isActive: boolean
}

export type AdminAccountListQuery = {
  page: number
  limit: number
}

export type AdminAccountListResult = {
  items: AdminAccount[]
  total: number
}

export type AdminAccountChange =
  | { isActive: boolean; role?: never }
  | { role: AdminRole; isActive?: never }

export type AdminAccountUpdateResult =
  | { outcome: 'UPDATED'; account: AdminAccount }
  | {
      outcome:
        | 'NOT_FOUND'
        | 'ACTOR_FORBIDDEN'
        | 'SELF_DEACTIVATION_FORBIDDEN'
        | 'SELF_DEMOTION_FORBIDDEN'
        | 'LAST_ACTIVE_SUPER_ADMIN'
        | 'UNCHANGED'
    }

export interface AdminManagementRepository {
  list(query: AdminAccountListQuery): Promise<AdminAccountListResult>
  update(
    actorAdminId: string,
    targetAdminId: string,
    change: AdminAccountChange,
    now: Date,
  ): Promise<AdminAccountUpdateResult>
}
