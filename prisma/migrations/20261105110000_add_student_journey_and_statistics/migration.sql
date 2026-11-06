-- Additive configurable Homepage journey slots only.
ALTER TYPE "AuditResourceType" ADD VALUE 'STUDENT_JOURNEY_STEP';

CREATE TABLE "StudentJourneyStep" (
  "id" UUID NOT NULL,
  "slot" INTEGER NOT NULL,
  "titleAr" TEXT,
  "titleEn" TEXT,
  "descriptionAr" TEXT,
  "descriptionEn" TEXT,
  "displayOrder" INTEGER NOT NULL,
  "iconKey" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StudentJourneyStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentJourneyStep_slot_range" CHECK ("slot" BETWEEN 1 AND 4)
);
CREATE UNIQUE INDEX "StudentJourneyStep_slot_key" ON "StudentJourneyStep"("slot");
CREATE UNIQUE INDEX "StudentJourneyStep_displayOrder_key" ON "StudentJourneyStep"("displayOrder");

