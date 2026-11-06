-- Additive, nullable presentation fields and independently managed ordered detail sections.
ALTER TYPE "AuditResourceType" ADD VALUE 'COUNTRY_STUDY_GUIDE_SECTION';
ALTER TYPE "AuditResourceType" ADD VALUE 'SERVICE_DETAIL_ITEM';
ALTER TYPE "AuditResourceType" ADD VALUE 'SCHOLARSHIP_DETAIL_ITEM';

CREATE TYPE "ServiceDetailItemKind" AS ENUM ('STEP', 'BENEFIT');
CREATE TYPE "ScholarshipDetailItemKind" AS ENUM ('BENEFIT', 'REQUIREMENT', 'APPLICATION_STEP');

ALTER TABLE "Country"
  ADD COLUMN "overviewImageUrl" TEXT,
  ADD COLUMN "overviewImageAltAr" TEXT,
  ADD COLUMN "studyLanguageAr" TEXT,
  ADD COLUMN "tuitionSummaryAr" TEXT,
  ADD COLUMN "admissionSummaryAr" TEXT,
  ADD COLUMN "applicationDatesSummaryAr" TEXT;

CREATE TABLE "CountryStudyGuideSection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "countryId" UUID NOT NULL,
  "titleAr" TEXT NOT NULL,
  "bodyAr" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CountryStudyGuideSection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CountryStudyGuideSection_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CountryStudyGuideSection_countryId_displayOrder_id_idx" ON "CountryStudyGuideSection"("countryId", "displayOrder", "id");

CREATE TABLE "ServiceDetailItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "serviceId" UUID NOT NULL,
  "kind" "ServiceDetailItemKind" NOT NULL,
  "titleAr" TEXT NOT NULL,
  "descriptionAr" TEXT,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ServiceDetailItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceDetailItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ServiceDetailItem_serviceId_kind_displayOrder_id_idx" ON "ServiceDetailItem"("serviceId", "kind", "displayOrder", "id");

CREATE TABLE "ScholarshipDetailItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scholarshipId" UUID NOT NULL,
  "kind" "ScholarshipDetailItemKind" NOT NULL,
  "titleAr" TEXT NOT NULL,
  "descriptionAr" TEXT,
  "displayOrder" INTEGER NOT NULL,
  "category" TEXT,
  "amount" DECIMAL(12,2),
  "currency" VARCHAR(3),
  "coveragePeriod" TEXT,
  "officialSourceUrl" TEXT,
  "verifiedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ScholarshipDetailItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScholarshipDetailItem_scholarshipId_fkey" FOREIGN KEY ("scholarshipId") REFERENCES "Scholarship"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScholarshipDetailItem_scholarshipId_kind_displayOrder_id_idx" ON "ScholarshipDetailItem"("scholarshipId", "kind", "displayOrder", "id");
