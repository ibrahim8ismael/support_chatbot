-- Dev convenience: pgvector is available in the image; make sure the extension
-- exists before migrations run (migrations also create it defensively).
CREATE EXTENSION IF NOT EXISTS vector;
