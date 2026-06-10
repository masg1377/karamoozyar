-- KarAmoozYar - PostgreSQL Init Script
-- This runs only once when the container is first created

-- Enable UUID extension (used by CUID alternative if needed)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Set timezone
SET timezone = 'Asia/Tehran';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE karamooziyar TO karamooz_user;
