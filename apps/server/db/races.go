package db

import (
	"context"
	"time"
)

// SaveRace writes a completed race and all player results + WPM samples.
// userIDs maps player pid → user UUID (empty string for guests).
func SaveRace(ctx context.Context, r RaceRecord) error {
	tx, err := Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Insert race row
	var raceID string
	err = tx.QueryRow(ctx,
		`INSERT INTO races (room_id, prompt_text, prompt_mode, seed, started_at, finished_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		r.RoomID, r.PromptText, r.PromptMode, r.Seed, r.StartedAt, r.FinishedAt,
	).Scan(&raceID)
	if err != nil {
		return err
	}

	// Insert one result row per player
	for _, p := range r.Players {
		var resultID string
		var userID *string
		if p.UserID != "" {
			userID = &p.UserID
		}
		err = tx.QueryRow(ctx,
			`INSERT INTO race_results (race_id, user_id, player_name, wpm, accuracy, mistakes, duration_ms, placement)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING id`,
			raceID, userID, p.PlayerName, p.WPM, p.Accuracy, p.Mistakes, p.DurationMs, p.Placement,
		).Scan(&resultID)
		if err != nil {
			return err
		}

		// Insert per-second WPM samples
		for _, s := range p.WPMSamples {
			_, err = tx.Exec(ctx,
				`INSERT INTO wpm_samples (race_result_id, second_num, wpm) VALUES ($1, $2, $3)`,
				resultID, s.Second, s.WPM,
			)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit(ctx)
}

// --- Profile queries ---

type OverallStats struct {
	TotalRaces int     `json:"totalRaces"`
	AvgWPM     float64 `json:"avgWpm"`
	AvgAcc     float64 `json:"avgAcc"`
	Wins       int     `json:"wins"`
	Losses     int     `json:"losses"`
}

type ModeStats struct {
	Mode     string  `json:"mode"`
	Races    int     `json:"races"`
	AvgWPM   float64 `json:"avgWpm"`
	AvgAcc   float64 `json:"avgAcc"`
	BestWPM  float64 `json:"bestWpm"`
}

type RecentRace struct {
	FinishedAt time.Time `json:"finishedAt"`
	Mode       string    `json:"mode"`
	WPM        float64   `json:"wpm"`
	Accuracy   float64   `json:"accuracy"`
	Placement  int       `json:"placement"`
	TotalRacers int      `json:"totalRacers"`
}

func GetOverallStats(ctx context.Context, userID string) (*OverallStats, error) {
	var s OverallStats
	err := Pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COALESCE(ROUND(AVG(rr.wpm)::numeric, 2), 0)::float8,
			COALESCE(ROUND(AVG(rr.accuracy)::numeric, 2), 0)::float8,
			COUNT(*) FILTER (WHERE rr.placement = 1)::int,
			COUNT(*) FILTER (WHERE rr.placement > 1)::int
		FROM race_results rr
		WHERE rr.user_id = $1
	`, userID).Scan(&s.TotalRaces, &s.AvgWPM, &s.AvgAcc, &s.Wins, &s.Losses)
	return &s, err
}

func GetModeStats(ctx context.Context, userID string) ([]ModeStats, error) {
	rows, err := Pool.Query(ctx, `
		SELECT
			ra.prompt_mode,
			COUNT(rr.id)::int,
			COALESCE(ROUND(AVG(rr.wpm)::numeric, 2), 0)::float8,
			COALESCE(ROUND(AVG(rr.accuracy)::numeric, 2), 0)::float8,
			COALESCE(ROUND(MAX(rr.wpm)::numeric, 2), 0)::float8
		FROM race_results rr
		JOIN races ra ON ra.id = rr.race_id
		WHERE rr.user_id = $1
		GROUP BY ra.prompt_mode
		ORDER BY ra.prompt_mode
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ModeStats
	for rows.Next() {
		var s ModeStats
		if err := rows.Scan(&s.Mode, &s.Races, &s.AvgWPM, &s.AvgAcc, &s.BestWPM); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func GetRecentRaces(ctx context.Context, userID string, limit int) ([]RecentRace, error) {
	rows, err := Pool.Query(ctx, `
		SELECT
			ra.finished_at,
			ra.prompt_mode,
			rr.wpm,
			rr.accuracy,
			rr.placement,
			(SELECT COUNT(*) FROM race_results WHERE race_id = rr.race_id)::int
		FROM race_results rr
		JOIN races ra ON ra.id = rr.race_id
		WHERE rr.user_id = $1
		ORDER BY ra.finished_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RecentRace
	for rows.Next() {
		var r RecentRace
		if err := rows.Scan(&r.FinishedAt, &r.Mode, &r.WPM, &r.Accuracy, &r.Placement, &r.TotalRacers); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// --- Input types ---

type WPMSample struct {
	Second int
	WPM    float64
}

type PlayerResult struct {
	UserID     string
	PlayerName string
	WPM        float64
	Accuracy   float64
	Mistakes   int
	DurationMs int64
	Placement  int
	WPMSamples []WPMSample
}

type RaceRecord struct {
	RoomID     string
	PromptText string
	PromptMode string
	Seed       int64
	StartedAt  time.Time
	FinishedAt time.Time
	Players    []PlayerResult
}
