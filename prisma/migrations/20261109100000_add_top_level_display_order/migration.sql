-- Additive deterministic editorial ordering; no publication or relationship changes.
ALTER TABLE "University" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Scholarship" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Article" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
WITH "ordered" AS (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) - 1 AS "displayOrder" FROM "University") UPDATE "University" SET "displayOrder" = "ordered"."displayOrder" FROM "ordered" WHERE "University"."id" = "ordered"."id";
WITH "ordered" AS (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) - 1 AS "displayOrder" FROM "Scholarship") UPDATE "Scholarship" SET "displayOrder" = "ordered"."displayOrder" FROM "ordered" WHERE "Scholarship"."id" = "ordered"."id";
WITH "ordered" AS (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) - 1 AS "displayOrder" FROM "Article") UPDATE "Article" SET "displayOrder" = "ordered"."displayOrder" FROM "ordered" WHERE "Article"."id" = "ordered"."id";
CREATE INDEX "University_status_displayOrder_id_idx" ON "University"("status", "displayOrder", "id");
CREATE INDEX "Scholarship_status_featured_displayOrder_id_idx" ON "Scholarship"("status", "featured", "displayOrder", "id");
CREATE INDEX "Article_status_displayOrder_id_idx" ON "Article"("status", "displayOrder", "id");
