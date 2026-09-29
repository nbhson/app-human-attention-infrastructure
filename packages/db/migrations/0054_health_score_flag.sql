-- AI-computed multi-dimensional PR health score (architecture, codeQuality,
-- security, performance, testing, overallRisk). Nullable jsonb: NULL on legacy
-- rows and on reports the AI did not score.
ALTER TABLE "review_reports" ADD COLUMN "health_score" jsonb;
