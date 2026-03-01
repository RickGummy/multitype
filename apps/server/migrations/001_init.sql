-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(32)  UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One row per completed multiplayer race (room session)
CREATE TABLE IF NOT EXISTS races (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     VARCHAR(16)  NOT NULL,
    prompt_text TEXT         NOT NULL,
    prompt_mode VARCHAR(16)  NOT NULL,
    seed        BIGINT       NOT NULL,
    started_at  TIMESTAMPTZ  NOT NULL,
    finished_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One row per player per race
CREATE TABLE IF NOT EXISTS race_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    race_id     UUID         NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
    player_name VARCHAR(64)  NOT NULL,
    wpm         NUMERIC(7,2) NOT NULL,
    accuracy    NUMERIC(5,2) NOT NULL,
    mistakes    INT          NOT NULL,
    duration_ms BIGINT       NOT NULL,
    placement   INT          NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Per-second WPM samples for chart replay
CREATE TABLE IF NOT EXISTS wpm_samples (
    id             BIGSERIAL    PRIMARY KEY,
    race_result_id UUID         NOT NULL REFERENCES race_results(id) ON DELETE CASCADE,
    second_num     INT          NOT NULL,
    wpm            NUMERIC(7,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_race_results_user_id ON race_results(user_id);
CREATE INDEX IF NOT EXISTS idx_race_results_race_id ON race_results(race_id);
CREATE INDEX IF NOT EXISTS idx_wpm_samples_result_id ON wpm_samples(race_result_id);
