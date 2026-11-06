import { ApiError } from '../shared/http.js'
import { studentJourneySlots, type StudentJourneyRepository, type StudentJourneySlot, type StudentJourneyUpdate } from './types.js'
const empty = (slot: StudentJourneySlot) => ({ id: '', slot, titleAr: null, titleEn: null, descriptionAr: null, descriptionEn: null, displayOrder: slot, iconKey: null, isActive: false, updatedAt: null })
export class StudentJourneyService {
  constructor(private readonly repository: StudentJourneyRepository) {}
  async listAdmin() { const records = await this.repository.list(); return studentJourneySlots.map((slot) => records.find((record) => record.slot === slot) ?? empty(slot)).sort((a, b) => a.displayOrder - b.displayOrder || a.slot - b.slot) }
  async listPublic() { return (await this.listAdmin()).filter((step) => step.isActive && Boolean(step.titleAr && step.descriptionAr && step.iconKey)) }
  async update(actorId: string, slot: StudentJourneySlot, input: StudentJourneyUpdate) {
    if (input.isActive) throw new ApiError(400, 'ICON_KEY_NOT_APPROVED', 'Journey steps cannot be activated until the Frontend icon-key allowlist is approved.', { fields: { iconKey: ['Provide an owner-approved Frontend icon key before activation.'] } })
    const record = await this.repository.update(actorId, slot, input); if (!record) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.'); return record
  }
  async reorder(actorId: string, slots: StudentJourneySlot[]) { const records = await this.repository.reorder(actorId, slots); if (!records) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.'); return records }
}
