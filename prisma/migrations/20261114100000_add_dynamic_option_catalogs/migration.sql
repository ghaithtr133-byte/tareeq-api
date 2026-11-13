-- Persisted, extensible display catalogs. Existing program and scholarship values remain strings.
CREATE TYPE "OptionCatalogType" AS ENUM ('STUDY_LANGUAGE', 'STUDY_LEVEL', 'FUNDING_TYPE');

ALTER TABLE "UniversityProgramLanguage"
  ALTER COLUMN "language" TYPE VARCHAR(64) USING "language"::text;
DROP TYPE "TeachingLanguage";

CREATE TABLE "OptionCatalog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "OptionCatalogType" NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "nameAr" VARCHAR(200) NOT NULL,
  "normalizedName" VARCHAR(200) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptionCatalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OptionCatalog_type_code_key" ON "OptionCatalog"("type", "code");
CREATE UNIQUE INDEX "OptionCatalog_type_normalizedName_key" ON "OptionCatalog"("type", "normalizedName");
CREATE INDEX "OptionCatalog_type_isActive_sortOrder_code_idx" ON "OptionCatalog"("type", "isActive", "sortOrder", "code");

-- Known legacy codes are additive catalog defaults only; no Scholarship or Program row is rewritten.
INSERT INTO "OptionCatalog" ("type", "code", "nameAr", "normalizedName", "sortOrder") VALUES
  ('STUDY_LANGUAGE', 'ARABIC', 'العربية', 'العربية', 10),
  ('STUDY_LANGUAGE', 'ENGLISH', 'الإنجليزية', 'الإنجليزية', 20),
  ('STUDY_LANGUAGE', 'FRENCH', 'الفرنسية', 'الفرنسية', 30),
  ('STUDY_LANGUAGE', 'GERMAN', 'الألمانية', 'الألمانية', 40),
  ('STUDY_LANGUAGE', 'TURKISH', 'التركية', 'التركية', 50),
  ('STUDY_LANGUAGE', 'ROMANIAN', 'الرومانية', 'الرومانية', 60),
  ('STUDY_LANGUAGE', 'RUSSIAN', 'الروسية', 'الروسية', 70),
  ('STUDY_LANGUAGE', 'SPANISH', 'الإسبانية', 'الإسبانية', 80),
  ('STUDY_LANGUAGE', 'ITALIAN', 'الإيطالية', 'الإيطالية', 90),
  ('STUDY_LEVEL', 'FOUNDATION', 'السنة التحضيرية', 'السنة التحضيرية', 10),
  ('STUDY_LEVEL', 'DIPLOMA', 'دبلوم', 'دبلوم', 20),
  ('STUDY_LEVEL', 'BACHELORS', 'بكالوريوس', 'بكالوريوس', 30),
  ('STUDY_LEVEL', 'MASTERS', 'ماجستير', 'ماجستير', 40),
  ('STUDY_LEVEL', 'PHD', 'دكتوراه', 'دكتوراه', 50),
  -- These two legacy composite labels are already established by the existing public filter contract.
  ('STUDY_LEVEL', 'ASSOCIATE_BACHELOR_MASTER_PHD', 'دبلوم مشارك، بكالوريوس، ماجستير ودكتوراه', 'دبلوم مشارك، بكالوريوس، ماجستير ودكتوراه', 60),
  ('STUDY_LEVEL', 'BACHELOR_MASTER_PHD', 'بكالوريوس، ماجستير ودكتوراه', 'بكالوريوس، ماجستير ودكتوراه', 70),
  ('FUNDING_TYPE', 'FULL', 'تمويل كامل', 'تمويل كامل', 10),
  ('FUNDING_TYPE', 'PARTIAL', 'تمويل جزئي', 'تمويل جزئي', 20),
  ('FUNDING_TYPE', 'GOVERNMENT_FUNDED', 'ممولة حكومياً', 'ممولة حكومياً', 30),
  ('FUNDING_TYPE', 'GOVERNMENT_FUNDED_FULL', 'تمويل حكومي كامل', 'تمويل حكومي كامل', 40),
  ('FUNDING_TYPE', 'TUITION_AND_STIPEND', 'رسوم دراسية ومخصصات', 'رسوم دراسية ومخصصات', 50)
ON CONFLICT ("type", "code") DO NOTHING;
