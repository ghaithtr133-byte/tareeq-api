-- Additive Admin Redesign fields. Existing content remains readable without backfill.
CREATE TYPE "StudyGuideSectionKind" AS ENUM ('ACADEMIC_SYSTEM', 'ADMISSION_DOCUMENTS', 'COSTS_STUDENT_LIFE');

ALTER TABLE "CountryStudyGuideSection" ADD COLUMN "section" "StudyGuideSectionKind";
CREATE UNIQUE INDEX "CountryStudyGuideSection_countryId_section_key"
  ON "CountryStudyGuideSection"("countryId", "section");

ALTER TABLE "Scholarship" ADD COLUMN "summaryAr" TEXT;
ALTER TABLE "University" ADD COLUMN "summaryAr" TEXT;
ALTER TABLE "ServiceDetailItem" ADD COLUMN "iconKey" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "whatsappPhone" TEXT;

-- Expression indexes make normalized bilingual catalog names race-safe without
-- changing immutable IDs or slugs. NULL/empty values are rejected by the API.
CREATE UNIQUE INDEX "AcademicMajor_nameAr_normalized_key"
  ON "AcademicMajor" (lower(btrim("nameAr")));
CREATE UNIQUE INDEX "AcademicMajor_nameEn_normalized_key"
  ON "AcademicMajor" (lower(btrim("nameEn")));
CREATE UNIQUE INDEX "City_countryId_nameAr_normalized_key"
  ON "City" ("countryId", lower(btrim("nameAr")));
CREATE UNIQUE INDEX "City_countryId_nameEn_normalized_key"
  ON "City" ("countryId", lower(btrim("nameEn")));
