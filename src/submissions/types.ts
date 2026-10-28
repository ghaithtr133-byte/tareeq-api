export const submissionResources = ['applications', 'inquiries'] as const

export type SubmissionResource = (typeof submissionResources)[number]
export type StudentApplicationType =
  | 'UNIVERSITY_ADMISSION'
  | 'SCHOLARSHIP_ASSISTANCE'
export type SubmissionStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED'
export type SubmissionSort = 'newest' | 'oldest' | 'updated'

export type StudentApplicationRecord = {
  id: string
  applicationType: StudentApplicationType
  scholarshipId: string | null
  countryId: string | null
  universityId: string | null
  studyLevel: string | null
  intendedMajor: string | null
  fullName: string
  email: string
  phone: string | null
  message: string
  status: SubmissionStatus
  internalNote: string | null
  privacyAcceptedAt: Date
  createdAt: Date
  updatedAt: Date
}

export type GeneralInquiryRecord = {
  id: string
  fullName: string
  email: string
  phone: string | null
  subject: string
  message: string
  status: SubmissionStatus
  internalNote: string | null
  privacyAcceptedAt: Date
  createdAt: Date
  updatedAt: Date
}

export type StudentApplicationInput = {
  applicationType: StudentApplicationType
  scholarshipId?: string | null
  countryId?: string | null
  universityId?: string | null
  studyLevel?: string | null
  intendedMajor?: string | null
  fullName: string
  email: string
  phone?: string | null
  message: string
  privacyAccepted: true
  website?: string
}

export type GeneralInquiryInput = {
  fullName: string
  email: string
  phone?: string | null
  subject: string
  message: string
  privacyAccepted: true
  website?: string
}

export type SubmissionListQuery = {
  page: number
  limit: number
  status?: SubmissionStatus
  applicationType?: StudentApplicationType
  sort: SubmissionSort
}

export type SubmissionListResult<T> = {
  items: T[]
  total: number
}

export type SubmissionUpdate = {
  status?: SubmissionStatus
  internalNote?: string | null
}

export type PublishedCountryReference = { id: string }
export type PublishedUniversityReference = { id: string; countryId: string }
export type AvailableScholarshipReference = {
  id: string
  countryId: string | null
  universityId: string | null
}

export interface SubmissionRepository {
  consumeRateLimit(
    scope: SubmissionResource,
    identifierHash: string,
    windowStartedAt: Date,
    expiresAt: Date,
    limit: number,
  ): Promise<boolean>
  findPublishedCountry(id: string): Promise<PublishedCountryReference | null>
  findPublishedUniversity(id: string): Promise<PublishedUniversityReference | null>
  findAvailableScholarship(
    id: string,
    now: Date,
  ): Promise<AvailableScholarshipReference | null>
  createApplication(
    data: Omit<StudentApplicationInput, 'privacyAccepted' | 'website'> & {
      privacyAcceptedAt: Date
    },
  ): Promise<StudentApplicationRecord>
  createInquiry(
    data: Omit<GeneralInquiryInput, 'privacyAccepted' | 'website'> & {
      privacyAcceptedAt: Date
    },
  ): Promise<GeneralInquiryRecord>
  listApplications(
    query: SubmissionListQuery,
  ): Promise<SubmissionListResult<StudentApplicationRecord>>
  listInquiries(
    query: SubmissionListQuery,
  ): Promise<SubmissionListResult<GeneralInquiryRecord>>
  findApplication(id: string): Promise<StudentApplicationRecord | null>
  findInquiry(id: string): Promise<GeneralInquiryRecord | null>
  updateApplication(
    id: string,
    data: SubmissionUpdate,
  ): Promise<StudentApplicationRecord>
  updateInquiry(id: string, data: SubmissionUpdate): Promise<GeneralInquiryRecord>
}
