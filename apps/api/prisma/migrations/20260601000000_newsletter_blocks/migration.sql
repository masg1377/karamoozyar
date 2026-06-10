-- AlterTable newsletter_posts: add title, contentBlocks, hashtags
ALTER TABLE "newsletter_posts" ADD COLUMN "title" TEXT;
ALTER TABLE "newsletter_posts" ADD COLUMN "contentBlocks" JSONB;
ALTER TABLE "newsletter_posts" ADD COLUMN "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable newsletter_attachments: make postId nullable (for pre-upload)
ALTER TABLE "newsletter_attachments" DROP CONSTRAINT "newsletter_attachments_postId_fkey";
ALTER TABLE "newsletter_attachments" ALTER COLUMN "postId" DROP NOT NULL;
ALTER TABLE "newsletter_attachments" ADD CONSTRAINT "newsletter_attachments_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "newsletter_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "newsletter_attachments_postId_idx" ON "newsletter_attachments"("postId");
