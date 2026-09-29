-- Health score (W8): multi-dimensional PR health assessment from AI reviewer.
-- Stores architecture, codeQuality, security, performance, testing ratings + overallRisk.
ALTER TABLE "review_reports" ADD COLUMN "health_score" jsonb;