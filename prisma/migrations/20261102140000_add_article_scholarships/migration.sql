-- Ordered, normalized Article-to-Scholarship associations.
-- The legacy Article.scholarshipId column and foreign key remain intact.
CREATE TABLE "ArticleScholarship" (
  "articleId" UUID NOT NULL,
  "scholarshipId" UUID NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArticleScholarship_pkey" PRIMARY KEY ("articleId", "scholarshipId"),
  CONSTRAINT "ArticleScholarship_display_order_check" CHECK ("displayOrder" >= 0)
);

CREATE UNIQUE INDEX "ArticleScholarship_articleId_displayOrder_key"
  ON "ArticleScholarship"("articleId", "displayOrder");
CREATE INDEX "ArticleScholarship_scholarshipId_articleId_idx"
  ON "ArticleScholarship"("scholarshipId", "articleId");

ALTER TABLE "ArticleScholarship" ADD CONSTRAINT "ArticleScholarship_articleId_fkey"
  FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleScholarship" ADD CONSTRAINT "ArticleScholarship_scholarshipId_fkey"
  FOREIGN KEY ("scholarshipId") REFERENCES "Scholarship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Idempotency-aware compatibility backfill. Re-running the INSERT cannot create
-- duplicates, and no legacy Article.scholarshipId value is removed or modified.
INSERT INTO "ArticleScholarship" ("articleId", "scholarshipId", "displayOrder")
SELECT "id", "scholarshipId", 0
FROM "Article"
WHERE "scholarshipId" IS NOT NULL
ON CONFLICT DO NOTHING;
