import { createHash } from 'node:crypto'

import type { ContentResource, PublicationStatus } from './types.js'

export const deletionEffects = ['DELETE', 'SET_NULL', 'UNLINK', 'PRESERVE', 'BLOCK', 'UNKNOWN'] as const
export type DeletionEffect = (typeof deletionEffects)[number]
export type DeletionResourceType =
  | 'COUNTRY' | 'UNIVERSITY' | 'SCHOLARSHIP' | 'SERVICE' | 'ARTICLE' | 'CITY'
  | 'UNIVERSITY_PROGRAM' | 'UNIVERSITY_PROGRAM_LANGUAGE' | 'UNIVERSITY_PROGRAM_TUITION'
  | 'UNIVERSITY_ADMISSION_REQUIREMENT' | 'UNIVERSITY_GALLERY_IMAGE'
  | 'COUNTRY_STUDY_GUIDE_SECTION' | 'SCHOLARSHIP_DETAIL_ITEM' | 'SERVICE_DETAIL_ITEM'
  | 'FAQ_ENTRY' | 'STUDENT_APPLICATION' | 'ARTICLE_SCHOLARSHIP' | 'ADMIN_AUDIT_LOG'
  | 'ANALYTICS_EVENT' | 'DEMO_FIXTURE' | 'UNKNOWN_REFERENCE'

export type DeletionImpactItem = {
  resourceType: DeletionResourceType
  effect: DeletionEffect
  count: number
  relationshipPath: string
  sampleIds: string[]
  code: string
  canConfirm: boolean
  blocked: boolean
}

export type DeletionImpact = {
  target: { resource: ContentResource; id: string; slug: string; status: PublicationStatus }
  outcome: 'SAFE' | 'REQUIRES_CONFIRMATION' | 'BLOCKED'
  items: DeletionImpactItem[]
}

export type DeletionImpactInput = {
  target: DeletionImpact['target']
  items: DeletionImpactItem[]
  analysisComplete: boolean
}

export const impactItem = (
  resourceType: DeletionResourceType,
  effect: DeletionEffect,
  count: number,
  relationshipPath: string,
  code: string,
  options: Partial<Pick<DeletionImpactItem, 'sampleIds' | 'canConfirm' | 'blocked'>> = {},
): DeletionImpactItem => ({
  resourceType,
  effect,
  count,
  relationshipPath,
  code,
  sampleIds: options.sampleIds ?? [],
  canConfirm: options.canConfirm ?? (effect !== 'BLOCK' && effect !== 'UNKNOWN'),
  blocked: options.blocked ?? (effect === 'BLOCK' || effect === 'UNKNOWN'),
})

export const analyzeDeletionImpact = ({ target, items, analysisComplete }: DeletionImpactInput): DeletionImpact => {
  const effectiveItems = analysisComplete
    ? items.filter((item) => item.count > 0)
    : [...items.filter((item) => item.count > 0), impactItem(
        'UNKNOWN_REFERENCE',
        'UNKNOWN',
        0,
        `${target.resource}.relationship-analysis`,
        'RELATIONSHIP_ANALYSIS_INCOMPLETE',
        { canConfirm: false, blocked: true },
      )]
  const hasBlocked = effectiveItems.some((item) => item.blocked)
  const hasDestructiveEffect = effectiveItems.some((item) =>
    item.effect === 'DELETE' || item.effect === 'SET_NULL' || item.effect === 'UNLINK',
  )
  return {
    target,
    items: effectiveItems,
    outcome: hasBlocked
      ? 'BLOCKED'
      : target.status === 'PUBLISHED' || hasDestructiveEffect
        ? 'REQUIRES_CONFIRMATION'
        : 'SAFE',
  }
}

export type DeletionExecution =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'DELETED'; id: string; impact: DeletionImpact }
  | { outcome: 'REQUIRES_CONFIRMATION'; impact: DeletionImpact }
  | { outcome: 'BLOCKED'; impact: DeletionImpact }

export type DeletionChallenge = {
  id: string
  expiresAt: Date
}

export type DeletionChallengeIssue =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'SAFE'; impact: DeletionImpact }
  | { outcome: 'BLOCKED'; impact: DeletionImpact }
  | { outcome: 'ISSUED'; impact: DeletionImpact; challenge: DeletionChallenge }

export type ConfirmedDeletionExecution =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'BLOCKED'; impact: DeletionImpact }
  | { outcome: 'STALE'; impact: DeletionImpact }
  | { outcome: 'DELETED'; id: string; impact: DeletionImpact }

export const deletionImpactDigest = (impact: DeletionImpact) =>
  createHash('sha256').update(JSON.stringify({
    target: impact.target,
    outcome: impact.outcome,
    items: impact.items.map((item) => ({
      resourceType: item.resourceType,
      effect: item.effect,
      count: item.count,
      relationshipPath: item.relationshipPath,
      sampleIds: item.sampleIds,
      code: item.code,
      canConfirm: item.canConfirm,
      blocked: item.blocked,
    })),
  })).digest('hex')
