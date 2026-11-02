-- AlterEnum
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'FAQ_ENTRY';

-- CreateEnum
CREATE TYPE "FaqScope" AS ENUM ('GLOBAL', 'COUNTRY', 'UNIVERSITY', 'SERVICE', 'SCHOLARSHIP');

-- CreateTable
CREATE TABLE "FaqEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" "FaqScope" NOT NULL,
    "questionAr" TEXT NOT NULL,
    "answerAr" TEXT NOT NULL,
    "questionEn" TEXT,
    "answerEn" TEXT,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "countryId" UUID,
    "universityId" UUID,
    "serviceId" UUID,
    "scholarshipId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FaqEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FaqEntry_display_order_check" CHECK ("displayOrder" >= 0),
    CONSTRAINT "FaqEntry_translation_pair_check" CHECK (("questionEn" IS NULL) = ("answerEn" IS NULL)),
    CONSTRAINT "FaqEntry_scope_parent_check" CHECK (
      ("scope" = 'GLOBAL' AND "countryId" IS NULL AND "universityId" IS NULL AND "serviceId" IS NULL AND "scholarshipId" IS NULL) OR
      ("scope" = 'COUNTRY' AND "countryId" IS NOT NULL AND "universityId" IS NULL AND "serviceId" IS NULL AND "scholarshipId" IS NULL) OR
      ("scope" = 'UNIVERSITY' AND "countryId" IS NULL AND "universityId" IS NOT NULL AND "serviceId" IS NULL AND "scholarshipId" IS NULL) OR
      ("scope" = 'SERVICE' AND "countryId" IS NULL AND "universityId" IS NULL AND "serviceId" IS NOT NULL AND "scholarshipId" IS NULL) OR
      ("scope" = 'SCHOLARSHIP' AND "countryId" IS NULL AND "universityId" IS NULL AND "serviceId" IS NULL AND "scholarshipId" IS NOT NULL)
    )
);

CREATE INDEX "FaqEntry_scope_status_displayOrder_id_idx" ON "FaqEntry"("scope", "status", "displayOrder", "id");
CREATE INDEX "FaqEntry_countryId_status_displayOrder_id_idx" ON "FaqEntry"("countryId", "status", "displayOrder", "id");
CREATE INDEX "FaqEntry_universityId_status_displayOrder_id_idx" ON "FaqEntry"("universityId", "status", "displayOrder", "id");
CREATE INDEX "FaqEntry_serviceId_status_displayOrder_id_idx" ON "FaqEntry"("serviceId", "status", "displayOrder", "id");
CREATE INDEX "FaqEntry_scholarshipId_status_displayOrder_id_idx" ON "FaqEntry"("scholarshipId", "status", "displayOrder", "id");

ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_scholarshipId_fkey" FOREIGN KEY ("scholarshipId") REFERENCES "Scholarship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
