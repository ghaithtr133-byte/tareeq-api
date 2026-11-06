-- Additive singleton content table for the managed About Us page. Do not insert data here.
ALTER TYPE "AuditResourceType" ADD VALUE 'ABOUT_US';

CREATE TABLE "AboutUs" (
  "id" UUID NOT NULL,
  "heroTitleAr" TEXT,
  "heroTitleEn" TEXT,
  "heroSubtitleAr" TEXT,
  "heroSubtitleEn" TEXT,
  "heroImageUrl" TEXT,
  "heroImageAltAr" TEXT,
  "heroImageAltEn" TEXT,
  "introTitleAr" TEXT,
  "introTitleEn" TEXT,
  "introBodyAr" TEXT,
  "introBodyEn" TEXT,
  "introImageUrl" TEXT,
  "introImageAltAr" TEXT,
  "introImageAltEn" TEXT,
  "missionTitleAr" TEXT,
  "missionTitleEn" TEXT,
  "missionBodyAr" TEXT,
  "missionBodyEn" TEXT,
  "visionTitleAr" TEXT,
  "visionTitleEn" TEXT,
  "visionBodyAr" TEXT,
  "visionBodyEn" TEXT,
  "ctaTitleAr" TEXT,
  "ctaTitleEn" TEXT,
  "ctaDescriptionAr" TEXT,
  "ctaDescriptionEn" TEXT,
  "ctaButtonLabelAr" TEXT,
  "ctaButtonLabelEn" TEXT,
  "seoTitleAr" TEXT,
  "seoDescriptionAr" TEXT,
  "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AboutUs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AboutUs_singleton" CHECK ("id" = '00000000-0000-4000-8000-000000000010'::uuid),
  CONSTRAINT "AboutUs_published_required_arabic" CHECK (
    "status" <> 'PUBLISHED' OR (
      NULLIF(BTRIM("heroTitleAr"), '') IS NOT NULL AND
      NULLIF(BTRIM("heroSubtitleAr"), '') IS NOT NULL AND
      NULLIF(BTRIM("introTitleAr"), '') IS NOT NULL AND
      NULLIF(BTRIM("introBodyAr"), '') IS NOT NULL
    )
  )
);
