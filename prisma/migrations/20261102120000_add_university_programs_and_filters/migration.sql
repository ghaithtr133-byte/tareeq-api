-- Extend audit resource classification for the normalized university directory.
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'UNIVERSITY_PROGRAM';
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'ACADEMIC_MAJOR';
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'CITY';

-- Controlled vocabularies. Additive enum values can be introduced in later reviewed migrations.
CREATE TYPE "ProgramStudyLevel" AS ENUM ('FOUNDATION', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'PHD');
CREATE TYPE "TeachingLanguage" AS ENUM ('ARABIC', 'ENGLISH', 'FRENCH', 'GERMAN', 'TURKISH', 'ROMANIAN', 'RUSSIAN', 'SPANISH', 'ITALIAN');
CREATE TYPE "UniversityType" AS ENUM ('PUBLIC', 'PRIVATE');

-- P2 university attributes are nullable; existing records are deliberately not inferred or backfilled.
ALTER TABLE "University" ADD COLUMN "cityId" UUID;
ALTER TABLE "University" ADD COLUMN "universityType" "UniversityType";

CREATE TABLE "City" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "countryId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademicMajor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AcademicMajor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UniversityProgram" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "universityId" UUID NOT NULL,
    "academicMajorId" UUID NOT NULL,
    "studyLevel" "ProgramStudyLevel" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "officialSourceUrl" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "UniversityProgram_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UniversityProgram_source_https_check" CHECK ("officialSourceUrl" ~* '^https://')
);

CREATE TABLE "UniversityProgramLanguage" (
    "programId" UUID NOT NULL,
    "language" "TeachingLanguage" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UniversityProgramLanguage_pkey" PRIMARY KEY ("programId", "language")
);

CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");
CREATE INDEX "City_countryId_nameAr_id_idx" ON "City"("countryId", "nameAr", "id");
CREATE UNIQUE INDEX "AcademicMajor_slug_key" ON "AcademicMajor"("slug");
CREATE INDEX "AcademicMajor_nameAr_id_idx" ON "AcademicMajor"("nameAr", "id");
CREATE INDEX "AcademicMajor_category_nameAr_id_idx" ON "AcademicMajor"("category", "nameAr", "id");
CREATE UNIQUE INDEX "UniversityProgram_universityId_academicMajorId_studyLevel_key" ON "UniversityProgram"("universityId", "academicMajorId", "studyLevel");
CREATE INDEX "UniversityProgram_universityId_status_studyLevel_id_idx" ON "UniversityProgram"("universityId", "status", "studyLevel", "id");
CREATE INDEX "UniversityProgram_academicMajorId_status_studyLevel_universityId_idx" ON "UniversityProgram"("academicMajorId", "status", "studyLevel", "universityId");
CREATE INDEX "UniversityProgram_status_studyLevel_universityId_idx" ON "UniversityProgram"("status", "studyLevel", "universityId");
CREATE INDEX "UniversityProgramLanguage_language_programId_idx" ON "UniversityProgramLanguage"("language", "programId");
CREATE INDEX "University_cityId_status_createdAt_id_idx" ON "University"("cityId", "status", "createdAt", "id");
CREATE INDEX "University_universityType_status_createdAt_id_idx" ON "University"("universityType", "status", "createdAt", "id");

ALTER TABLE "City" ADD CONSTRAINT "City_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "University" ADD CONSTRAINT "University_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniversityProgram" ADD CONSTRAINT "UniversityProgram_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniversityProgram" ADD CONSTRAINT "UniversityProgram_academicMajorId_fkey" FOREIGN KEY ("academicMajorId") REFERENCES "AcademicMajor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniversityProgramLanguage" ADD CONSTRAINT "UniversityProgramLanguage_programId_fkey" FOREIGN KEY ("programId") REFERENCES "UniversityProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
