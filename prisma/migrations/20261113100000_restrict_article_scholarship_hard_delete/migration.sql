-- Article hard deletion explicitly removes owned relation rows; never rely on a hidden cascade.
ALTER TABLE "ArticleScholarship" DROP CONSTRAINT "ArticleScholarship_articleId_fkey";
ALTER TABLE "ArticleScholarship"
  ADD CONSTRAINT "ArticleScholarship_articleId_fkey"
  FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
