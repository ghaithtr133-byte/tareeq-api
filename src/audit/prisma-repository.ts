import { getPrisma } from '../database/client.js'
import type {
  AuditListQuery,
  AuditRecord,
  AuditRepository,
} from './types.js'

export class PrismaAuditRepository implements AuditRepository {
  async list(query: AuditListQuery) {
    const where = {
      ...(query.actorId ? { actorAdminId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    }
    const prisma = getPrisma()
    const [items, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { actor: { select: { id: true, name: true } } },
      }),
      prisma.adminAuditLog.count({ where }),
    ])
    return { items: items as AuditRecord[], total }
  }
}
