-- Task #7: allow Scholarship records to retain the secure Cloudinary URL and
-- localized alternative text using the same nullable pattern as other content.
ALTER TABLE "Scholarship"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "imageAltAr" TEXT,
ADD COLUMN "imageAltEn" TEXT;
