import type { PublicationStatus } from '../content/types.js'

export const faqScopes = ['GLOBAL', 'COUNTRY', 'UNIVERSITY', 'SERVICE', 'SCHOLARSHIP'] as const
export type FaqScope = (typeof faqScopes)[number]

export type FaqParent = { scope: FaqScope; parentId: string | null }

export type FaqRecord = FaqParent & {
  id: string
  questionAr: string
  answerAr: string
  questionEn: string | null
  answerEn: string | null
  status: PublicationStatus
  displayOrder: number
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type FaqListQuery = FaqParent & {
  page: number
  limit: number
  status?: PublicationStatus
}

export type FaqCreateInput = FaqParent & {
  questionAr: string
  answerAr: string
  questionEn?: string | null
  answerEn?: string | null
  status: PublicationStatus
}

export type FaqUpdateInput = Partial<Pick<
  FaqRecord,
  'questionAr' | 'answerAr' | 'questionEn' | 'answerEn' | 'status' | 'scope' | 'parentId'
>>

export type FaqMutationResult =
  | { outcome: 'UPDATED'; record: FaqRecord }
  | { outcome: 'NOT_FOUND' | 'PARENT_NOT_FOUND' | 'INVALID_TRANSLATION' }

export type FaqReorderResult =
  | { outcome: 'UPDATED'; records: FaqRecord[] }
  | { outcome: 'PARENT_NOT_FOUND' | 'ORDER_SET_MISMATCH' }

export type FaqDeleteResult = { outcome: 'DELETED' } | { outcome: 'NOT_FOUND' | 'PUBLISHED' }

export interface FaqRepository {
  resolvePublishedParent(scope: Exclude<FaqScope, 'GLOBAL'>, slug: string): Promise<string | null>
  parentExists(parent: FaqParent): Promise<boolean>
  list(query: FaqListQuery, publicOnly: boolean): Promise<{ items: FaqRecord[]; total: number }>
  create(input: FaqCreateInput, actorAdminId: string, now: Date): Promise<FaqMutationResult>
  update(id: string, input: FaqUpdateInput, actorAdminId: string, now: Date): Promise<FaqMutationResult>
  delete(id: string, actorAdminId: string): Promise<FaqDeleteResult>
  reorder(parent: FaqParent, orderedIds: string[], actorAdminId: string): Promise<FaqReorderResult>
}
