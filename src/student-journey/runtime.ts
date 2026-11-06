import { PrismaStudentJourneyRepository } from './prisma-repository.js'
import { StudentJourneyService } from './service.js'
export interface StudentJourneyRuntime { getService(): StudentJourneyService }
let service: StudentJourneyService | undefined
export const productionStudentJourneyRuntime: StudentJourneyRuntime = { getService: () => (service ??= new StudentJourneyService(new PrismaStudentJourneyRepository())) }
