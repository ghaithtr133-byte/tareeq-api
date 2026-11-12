-- Durable, one-time confirmation challenges for SUPER_ADMIN hard-delete confirmation.
CREATE TABLE "HardDeleteChallenge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actorAdminId" UUID NOT NULL,
  "resourceType" "AuditResourceType" NOT NULL,
  "resourceId" UUID NOT NULL,
  "impactHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HardDeleteChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HardDeleteChallenge_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "HardDeleteChallenge_actorAdminId_resourceType_resourceId_expiresAt_idx"
  ON "HardDeleteChallenge"("actorAdminId", "resourceType", "resourceId", "expiresAt");
CREATE INDEX "HardDeleteChallenge_expiresAt_idx" ON "HardDeleteChallenge"("expiresAt");

-- Phase B explicitly removes only approved editorial children. These FK changes prevent
-- the database from silently cascading a child deletion if future code regresses.
ALTER TABLE "CountryStudyGuideSection" DROP CONSTRAINT "CountryStudyGuideSection_countryId_fkey";
ALTER TABLE "CountryStudyGuideSection"
  ADD CONSTRAINT "CountryStudyGuideSection_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceDetailItem" DROP CONSTRAINT "ServiceDetailItem_serviceId_fkey";
ALTER TABLE "ServiceDetailItem"
  ADD CONSTRAINT "ServiceDetailItem_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScholarshipDetailItem" DROP CONSTRAINT "ScholarshipDetailItem_scholarshipId_fkey";
ALTER TABLE "ScholarshipDetailItem"
  ADD CONSTRAINT "ScholarshipDetailItem_scholarshipId_fkey"
  FOREIGN KEY ("scholarshipId") REFERENCES "Scholarship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UniversityProgramLanguage" DROP CONSTRAINT "UniversityProgramLanguage_programId_fkey";
ALTER TABLE "UniversityProgramLanguage"
  ADD CONSTRAINT "UniversityProgramLanguage_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "UniversityProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UniversityProgramTuition" DROP CONSTRAINT "UniversityProgramTuition_programId_fkey";
ALTER TABLE "UniversityProgramTuition"
  ADD CONSTRAINT "UniversityProgramTuition_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "UniversityProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
