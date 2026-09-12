-- Transparency flag (W7 fix): mark reports whose model output was truncated
-- and repaired by the parser, so the UI can warn "truncated & repaired —
-- verify before merge" instead of presenting fabricated findings as ground
-- truth. Nullable: legacy rows and clean parses stay NULL / false.
ALTER TABLE "review_reports" ADD COLUMN "was_repaired" boolean;