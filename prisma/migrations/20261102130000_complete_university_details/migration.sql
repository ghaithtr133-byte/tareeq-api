-- University details completion: localized program data, versioned tuition,
-- scoped admission requirements, and ordered gallery associations.
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'UNIVERSITY_ADMISSION_REQUIREMENT';
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'UNIVERSITY_GALLERY_IMAGE';

CREATE TYPE "ProgramDurationUnit" AS ENUM ('MONTHS', 'YEARS');
CREATE TYPE "TuitionBillingPeriod" AS ENUM ('YEAR', 'SEMESTER', 'FULL_PROGRAM');
CREATE TYPE "AdmissionRequirementScope" AS ENUM ('UNIVERSITY', 'STUDY_LEVEL', 'PROGRAM');

-- Existing program rows remain valid without fabricated localized titles or durations.
-- New and newly-published programs are validated by the application layer.
ALTER TABLE "UniversityProgram"
  ADD COLUMN "nameAr" TEXT,
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "facultyNameAr" TEXT,
  ADD COLUMN "facultyNameEn" TEXT,
  ADD COLUMN "durationValue" INTEGER,
  ADD COLUMN "durationUnit" "ProgramDurationUnit";

ALTER TABLE "UniversityProgram"
  ADD CONSTRAINT "UniversityProgram_duration_pair_check"
  CHECK (("durationValue" IS NULL AND "durationUnit" IS NULL) OR ("durationValue" > 0 AND "durationUnit" IS NOT NULL));

DROP INDEX "UniversityProgram_universityId_academicMajorId_studyLevel_key";
CREATE UNIQUE INDEX "UniversityProgram_universityId_academicMajorId_studyLevel_nameAr_key"
  ON "UniversityProgram"("universityId", "academicMajorId", "studyLevel", "nameAr");
CREATE INDEX "UniversityProgram_universityId_facultyNameAr_status_id_idx"
  ON "UniversityProgram"("universityId", "facultyNameAr", "status", "id");

CREATE TABLE "UniversityProgramTuition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "programId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "billingPeriod" "TuitionBillingPeriod" NOT NULL,
  "academicYear" VARCHAR(9) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "UniversityProgramTuition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UniversityProgramTuition_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "UniversityProgramTuition_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "UniversityProgramTuition_academic_year_check" CHECK ("academicYear" ~ '^[0-9]{4}/[0-9]{4}$')
);

CREATE UNIQUE INDEX "UniversityProgramTuition_programId_academicYear_key"
  ON "UniversityProgramTuition"("programId", "academicYear");
CREATE INDEX "UniversityProgramTuition_programId_academicYear_id_idx"
  ON "UniversityProgramTuition"("programId", "academicYear" DESC, "id");

CREATE TABLE "UniversityAdmissionRequirement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "universityId" UUID NOT NULL,
  "scope" "AdmissionRequirementScope" NOT NULL,
  "studyLevel" "ProgramStudyLevel",
  "programId" UUID,
  "contentAr" TEXT NOT NULL,
  "contentEn" TEXT,
  "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "officialSourceUrl" TEXT,
  "verifiedAt" TIMESTAMPTZ(3),
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "UniversityAdmissionRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UniversityAdmissionRequirement_scope_check" CHECK (
    ("scope" = 'UNIVERSITY' AND "studyLevel" IS NULL AND "programId" IS NULL) OR
    ("scope" = 'STUDY_LEVEL' AND "studyLevel" IS NOT NULL AND "programId" IS NULL) OR
    ("scope" = 'PROGRAM' AND "studyLevel" IS NULL AND "programId" IS NOT NULL)
  ),
  CONSTRAINT "UniversityAdmissionRequirement_source_https_check" CHECK ("officialSourceUrl" IS NULL OR "officialSourceUrl" ~* '^https://')
);

CREATE INDEX "UniversityAdmissionRequirement_universityId_status_scope_id_idx"
  ON "UniversityAdmissionRequirement"("universityId", "status", "scope", "id");
CREATE INDEX "UniversityAdmissionRequirement_universityId_studyLevel_status_id_idx"
  ON "UniversityAdmissionRequirement"("universityId", "studyLevel", "status", "id");
CREATE INDEX "UniversityAdmissionRequirement_programId_status_id_idx"
  ON "UniversityAdmissionRequirement"("programId", "status", "id");

CREATE TABLE "UniversityGalleryImage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "universityId" UUID NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "altAr" TEXT,
  "altEn" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "UniversityGalleryImage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UniversityGalleryImage_https_check" CHECK ("imageUrl" ~* '^https://'),
  CONSTRAINT "UniversityGalleryImage_display_order_check" CHECK ("displayOrder" >= 0)
);

CREATE INDEX "UniversityGalleryImage_universityId_status_displayOrder_id_idx"
  ON "UniversityGalleryImage"("universityId", "status", "displayOrder", "id");

ALTER TABLE "UniversityProgramTuition" ADD CONSTRAINT "UniversityProgramTuition_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "UniversityProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UniversityAdmissionRequirement" ADD CONSTRAINT "UniversityAdmissionRequirement_universityId_fkey"
  FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniversityAdmissionRequirement" ADD CONSTRAINT "UniversityAdmissionRequirement_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "UniversityProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniversityGalleryImage" ADD CONSTRAINT "UniversityGalleryImage_universityId_fkey"
  FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
