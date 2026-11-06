export const studentJourneySlots = [1, 2, 3, 4] as const
export type StudentJourneySlot = (typeof studentJourneySlots)[number]
export const studentJourneyIds: Record<StudentJourneySlot, string> = { 1: '00000000-0000-4000-8000-000000000021', 2: '00000000-0000-4000-8000-000000000022', 3: '00000000-0000-4000-8000-000000000023', 4: '00000000-0000-4000-8000-000000000024' }
export type StudentJourneyStep = { id: string; slot: StudentJourneySlot; titleAr: string | null; titleEn: string | null; descriptionAr: string | null; descriptionEn: string | null; displayOrder: number; iconKey: string | null; isActive: boolean; updatedAt: Date | null }
export type StudentJourneyUpdate = Partial<Omit<StudentJourneyStep, 'id' | 'slot' | 'updatedAt'>>
export interface StudentJourneyRepository { list(): Promise<StudentJourneyStep[]>; update(actorId: string, slot: StudentJourneySlot, input: StudentJourneyUpdate): Promise<StudentJourneyStep | null>; reorder(actorId: string, slots: StudentJourneySlot[]): Promise<StudentJourneyStep[] | null> }
