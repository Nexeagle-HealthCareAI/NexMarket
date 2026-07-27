-- Seemanchal Field Outreach — PostgreSQL Init Script
-- Schema: marketing (isolated from existing 1RAD / EasyHMS schemas)

CREATE SCHEMA IF NOT EXISTS marketing;
SET search_path TO marketing;

CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;

-- ─── Agents ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL UNIQUE,
    role            TEXT NOT NULL DEFAULT 'field_rep'
                    CHECK (role IN ('field_rep', 'admin', 'supervisor')),
    active          BOOLEAN NOT NULL DEFAULT true,
    password_hash   TEXT,
    otp_secret      TEXT,
    refresh_token   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Panchayats (LGD Bihar — seeded from migration) ──────────────────────────

CREATE TABLE IF NOT EXISTS panchayats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lgd_code        TEXT UNIQUE,
    name            TEXT NOT NULL,
    block           TEXT NOT NULL,
    district        TEXT NOT NULL
                    CHECK (district IN ('Katihar', 'Purnia', 'Araria', 'Supaul')),
    state           TEXT NOT NULL DEFAULT 'Bihar',
    boundary        public.GEOMETRY(POLYGON, 4326),
    centroid        public.GEOMETRY(POINT, 4326),
    centroid_lat    REAL,
    centroid_lng    REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_panchayats_boundary  ON panchayats USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_panchayats_centroid  ON panchayats USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_panchayats_district  ON panchayats (district, block);

-- ─── Shifts ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shifts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL,
    device_id       UUID NOT NULL,
    agent_id        UUID NOT NULL REFERENCES agents(id),
    start_at        TIMESTAMPTZ NOT NULL,
    end_at          TIMESTAMPTZ,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_shifts_agent ON shifts (agent_id, start_at);

-- ─── Contacts ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               UUID NOT NULL,
    device_id               UUID NOT NULL,
    panchayat_id            UUID NOT NULL REFERENCES panchayats(id),
    created_by              UUID NOT NULL REFERENCES agents(id),
    name                    TEXT NOT NULL,
    role                    TEXT NOT NULL
                            CHECK (role IN ('asha_worker', 'rmp_doctor', 'ward_member', 'medicine_shop')),
    phone                   TEXT,
    whatsapp_added          BOOLEAN NOT NULL DEFAULT false,
    card_given              BOOLEAN NOT NULL DEFAULT false,
    notes                   TEXT,
    potential_duplicate_of  UUID[],
    created_at              TIMESTAMPTZ NOT NULL,
    synced_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_panchayat   ON contacts (panchayat_id);
CREATE INDEX IF NOT EXISTS idx_contacts_created_by  ON contacts (created_by);
CREATE INDEX IF NOT EXISTS idx_contacts_phone       ON contacts (phone) WHERE phone IS NOT NULL;

-- ─── Visits ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visits (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL,
    device_id           UUID NOT NULL,
    agent_id            UUID NOT NULL REFERENCES agents(id),
    panchayat_id        UUID NOT NULL REFERENCES panchayats(id),
    contact_id          UUID REFERENCES contacts(id),
    shift_id            UUID REFERENCES shifts(id),
    check_in_at         TIMESTAMPTZ NOT NULL,
    check_in_location   public.GEOMETRY(POINT, 4326) NOT NULL,
    check_out_at        TIMESTAMPTZ,
    check_out_location  public.GEOMETRY(POINT, 4326),
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_visits_agent_time ON visits (agent_id, check_in_at);
CREATE INDEX IF NOT EXISTS idx_visits_location   ON visits USING GIST (check_in_location);

-- ─── Trajectory Points (partitioned by month) ────────────────────────────────

CREATE TABLE IF NOT EXISTS trajectory_points (
    id              BIGSERIAL,
    client_id       UUID NOT NULL,
    device_id       UUID NOT NULL,
    agent_id        UUID NOT NULL REFERENCES agents(id),
    shift_id        UUID REFERENCES shifts(id),
    visit_id        UUID REFERENCES visits(id),
    location        public.GEOMETRY(POINT, 4326) NOT NULL,
    accuracy_m      REAL,
    recorded_at     TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, device_id),
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Create partitions for current and next two months
CREATE TABLE IF NOT EXISTS trajectory_points_2026_07
    PARTITION OF trajectory_points
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS trajectory_points_2026_08
    PARTITION OF trajectory_points
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS trajectory_points_2026_09
    PARTITION OF trajectory_points
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE INDEX IF NOT EXISTS idx_trajectory_agent_time
    ON trajectory_points (agent_id, recorded_at);

-- ─── Referrals ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referrals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL,
    device_id       UUID NOT NULL,
    contact_id      UUID NOT NULL REFERENCES contacts(id),
    visit_id        UUID REFERENCES visits(id),
    referral_date   DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'converted', 'lost')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_contact ON referrals (contact_id);

-- ─── Seed LGD panchayat data ─────────────────────────────────────────────────
-- Full seed done via .NET migration using /public/data/panchayats.json
-- This is a sample for local dev:

INSERT INTO panchayats (id, lgd_code, name, block, district, centroid_lat, centroid_lng) VALUES
('00000001-0000-0000-0000-000000000010', '251565', 'Katihar',         'Katihar',     'Katihar', 25.53, 87.57),
('00000002-0000-0000-0000-000000000010', '252610', 'Purnia East',     'Purnia East', 'Purnia',  25.78, 87.48),
('00000003-0000-0000-0000-000000000001', '253101', 'Araria',          'Araria',      'Araria',  26.15, 87.52),
('00000004-0000-0000-0000-000000000009', '254209', 'Supaul',          'Supaul',      'Supaul',  26.12, 86.61)
ON CONFLICT (id) DO NOTHING;
