import type { ContentResource } from '../content/types.js'
import type {
  AuditResourceType,
  AuditWrite,
} from './types.js'

const contentResourceNames: Record<ContentResource, string> = {
  countries: 'country',
  universities: 'university',
  scholarships: 'scholarship',
  services: 'service',
  articles: 'article',
}

export const contentAuditResourceTypes: Record<
  ContentResource,
  AuditResourceType
> = {
  countries: 'COUNTRY',
  universities: 'UNIVERSITY',
  scholarships: 'SCHOLARSHIP',
  services: 'SERVICE',
  articles: 'ARTICLE',
}

export const contentAuditAction = (
  resource: ContentResource,
  operation: 'created' | 'updated' | 'status_changed',
) => `content.${contentResourceNames[resource]}.${operation}`

export const auditWrite = (
  value: AuditWrite,
): AuditWrite => value
