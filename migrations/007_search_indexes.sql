-- Enable trigram extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_tickets_subject_fts
  ON tickets USING gin(to_tsvector('english', subject));

CREATE INDEX IF NOT EXISTS idx_ticket_messages_body_fts
  ON ticket_messages USING gin(to_tsvector('english', body));

-- Trigram index for fuzzy subject matching
CREATE INDEX IF NOT EXISTS idx_tickets_subject_trgm
  ON tickets USING gin(subject gin_trgm_ops);
