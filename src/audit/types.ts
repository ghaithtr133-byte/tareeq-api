export const auditResourceTypes = [
  'COUNTRY',
  'UNIVERSITY',
  'SCHOLARSHIP',
  'SERVICE',
  'ARTICLE',
  'STUDENT_APPLICATION',
  'GENERAL_INQUIRY',
  'ADMIN_USER',
  'SITE_SETTINGS',
  'FAQ_ENTRY',
  'UNIVERSITY_PROGRAM',
  'ACADEMIC_MAJOR',
  'CITY',
  'UNIVERSITY_ADMISSION_REQUIREMENT',
  'UNIVERSITY_GALLERY_IMAGE',
] as const

export type AuditResourceType = (typeof auditResourceTypes)[number]

export type AuditMetadata = Record<
  string,
  string | number | boolean | null | string[]
>

export type AuditWrite = {
  actorAdminId: string
  action: string
  resourceType: AuditResourceType
  resourceId: string
  metadata: AuditMetadata
}

export type AuditIntent = Omit<AuditWrite, 'resourceId'>

export type AuditRecord = AuditWrite & {
  id: string
  createdAt: Date
  actor: {
    id: string
    name: string
  }
}

export type AuditListQuery = {
  page: number
  limit: number
  actorId?: string
  action?: string
  resourceType?: AuditResourceType
  from?: string
  to?: string
}

export type AuditListResult = {
  items: AuditRecord[]
  total: number
}

export interface AuditRepository {
  list(query: AuditListQuery): Promise<AuditListResult>
}
