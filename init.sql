-- Seemanchal Field Outreach — PostgreSQL Init Script
-- Schema: marketing (isolated from existing 1RAD / EasyHMS schemas)
--
-- This only creates the schema and extensions. Table creation is owned
-- exclusively by EF Core migrations (backend/SeemanchalOutreach.Infrastructure/
-- Persistence/Migrations) — do NOT add CREATE TABLE statements here, they
-- will collide with the migration's own CREATE TABLE (no IF NOT EXISTS) and
-- make the API crash on startup.

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
