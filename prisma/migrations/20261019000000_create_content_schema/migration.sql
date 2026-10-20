CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "ScholarshipApplicationStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "Country" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "slug" TEXT NOT NULL,
    "introductionAr" TEXT NOT NULL,
    "introductionEn" TEXT,
    "detailsAr" TEXT NOT NULL,
    "detailsEn" TEXT,
    "imageUrl" TEXT,
    "imageAltAr" TEXT,
    "imageAltEn" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "seoTitleAr" TEXT,
    "seoDescriptionAr" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "University" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "officialName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "countryId" UUID NOT NULL,
    "cityAr" TEXT NOT NULL,
    "cityEn" TEXT,
    "overviewAr" TEXT NOT NULL,
    "overviewEn" TEXT,
    "officialWebsite" TEXT,
    "imageUrl" TEXT,
    "imageAltAr" TEXT,
    "imageAltEn" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "seoTitleAr" TEXT,
    "seoDescriptionAr" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Scholarship" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT,
    "slug" TEXT NOT NULL,
    "countryId" UUID,
    "universityId" UUID,
    "studyLevel" TEXT NOT NULL,
    "fundingType" TEXT NOT NULL,
    "requirementsAr" TEXT NOT NULL,
    "requirementsEn" TEXT,
    "descriptionAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "verifiedDeadline" TIMESTAMPTZ(3),
    "officialSourceUrl" TEXT,
    "applicationStatus" "ScholarshipApplicationStatus" NOT NULL DEFAULT 'OPEN',
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(3),
    "seoTitleAr" TEXT,
    "seoDescriptionAr" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Scholarship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Service" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT,
    "slug" TEXT NOT NULL,
    "summaryAr" TEXT NOT NULL,
    "summaryEn" TEXT,
    "descriptionAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "imageUrl" TEXT,
    "imageAltAr" TEXT,
    "imageAltEn" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "seoTitleAr" TEXT,
    "seoDescriptionAr" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Article" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT,
    "slug" TEXT NOT NULL,
    "summaryAr" TEXT NOT NULL,
    "summaryEn" TEXT,
    "bodyAr" JSONB NOT NULL,
    "bodyEn" JSONB,
    "coverImageUrl" TEXT,
    "coverImageAltAr" TEXT,
    "coverImageAltEn" TEXT,
    "countryId" UUID,
    "universityId" UUID,
    "scholarshipId" UUID,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "seoTitleAr" TEXT,
    "seoDescriptionAr" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Country_slug_key" ON "Country"("slug");
CREATE INDEX "Country_status_featured_displayOrder_id_idx" ON "Country"("status", "featured", "displayOrder", "id");
CREATE INDEX "Country_createdAt_id_idx" ON "Country"("createdAt", "id");
CREATE UNIQUE INDEX "University_slug_key" ON "University"("slug");
CREATE INDEX "University_countryId_status_featured_createdAt_id_idx" ON "University"("countryId", "status", "featured", "createdAt", "id");
CREATE INDEX "University_status_createdAt_id_idx" ON "University"("status", "createdAt", "id");
CREATE UNIQUE INDEX "Scholarship_slug_key" ON "Scholarship"("slug");
CREATE INDEX "Scholarship_countryId_status_featured_createdAt_id_idx" ON "Scholarship"("countryId", "status", "featured", "createdAt", "id");
CREATE INDEX "Scholarship_universityId_status_createdAt_id_idx" ON "Scholarship"("universityId", "status", "createdAt", "id");
CREATE INDEX "Scholarship_status_applicationStatus_verifiedDeadline_id_idx" ON "Scholarship"("status", "applicationStatus", "verifiedDeadline", "id");
CREATE INDEX "Scholarship_studyLevel_fundingType_idx" ON "Scholarship"("studyLevel", "fundingType");
CREATE UNIQUE INDEX "Service_slug_key" ON "Service"("slug");
CREATE INDEX "Service_status_featured_displayOrder_id_idx" ON "Service"("status", "featured", "displayOrder", "id");
CREATE INDEX "Service_createdAt_id_idx" ON "Service"("createdAt", "id");
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_countryId_status_createdAt_id_idx" ON "Article"("countryId", "status", "createdAt", "id");
CREATE INDEX "Article_universityId_status_createdAt_id_idx" ON "Article"("universityId", "status", "createdAt", "id");
CREATE INDEX "Article_scholarshipId_status_createdAt_id_idx" ON "Article"("scholarshipId", "status", "createdAt", "id");
CREATE INDEX "Article_status_featured_createdAt_id_idx" ON "Article"("status", "featured", "createdAt", "id");

ALTER TABLE "University" ADD CONSTRAINT "University_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Scholarship" ADD CONSTRAINT "Scholarship_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Scholarship" ADD CONSTRAINT "Scholarship_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_scholarshipId_fkey" FOREIGN KEY ("scholarshipId") REFERENCES "Scholarship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
