package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"multiplayer-server/db"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var jwtSecret = func() []byte {
	if s := os.Getenv("JWT_SECRET"); s != "" {
		return []byte(s)
	}
	log.Println("⚠️  JWT_SECRET not set — generating an ephemeral random secret.")
	log.Println("⚠️  Existing tokens will be invalidated on every server restart.")
	log.Println("⚠️  Set JWT_SECRET to a 32+ char secret in production.")
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("failed to generate jwt secret: %v", err)
	}
	return b
}()

// --- helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func makeToken(userID, username string) (string, error) {
	claims := jwt.MapClaims{
		"sub":      userID,
		"username": username,
		"exp":      time.Now().Add(30 * 24 * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
}

// validateToken parses and validates a JWT string and returns the associated user.
func validateToken(ctx context.Context, tokenStr string) (*db.User, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !token.Valid {
		return nil, nil
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, nil
	}
	userID, _ := claims["sub"].(string)
	if userID == "" {
		return nil, nil
	}

	return db.GetUserByID(ctx, userID)
}

// UserFromRequest extracts the authenticated user from the Authorization header.
// Returns nil (no error) if the request is unauthenticated.
func UserFromRequest(r *http.Request) (*db.User, error) {
	hdr := r.Header.Get("Authorization")
	if !strings.HasPrefix(hdr, "Bearer ") {
		return nil, nil
	}
	return validateToken(r.Context(), strings.TrimPrefix(hdr, "Bearer "))
}

// --- handlers ---

func handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	body.Username = strings.TrimSpace(body.Username)
	if len(body.Username) < 2 || len(body.Username) > 32 {
		writeErr(w, http.StatusBadRequest, "username must be 2–32 characters")
		return
	}
	if len(body.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	existing, err := db.GetUserByUsername(r.Context(), body.Username)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	if existing != nil {
		writeErr(w, http.StatusConflict, "username already taken")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}

	user, err := db.CreateUser(r.Context(), body.Username, string(hash))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}

	token, err := makeToken(user.ID, user.Username)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"token":    token,
		"id":       user.ID,
		"username": user.Username,
	})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	user, err := db.GetUserByUsername(r.Context(), strings.TrimSpace(body.Username))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	if user == nil {
		writeErr(w, http.StatusUnauthorized, "invalid username or password")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(body.Password)); err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid username or password")
		return
	}

	token, err := makeToken(user.ID, user.Username)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token":    token,
		"id":       user.ID,
		"username": user.Username,
	})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	user, err := UserFromRequest(r)
	if err != nil || user == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":       user.ID,
		"username": user.Username,
	})
}

func handleProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Resolve user: from path /api/profile/:username or from token
	username := strings.TrimPrefix(r.URL.Path, "/api/profile/")
	ctx := context.Background()

	var user *db.User
	var err error
	if username != "" && username != "/api/profile/" {
		user, err = db.GetUserByUsername(ctx, username)
	} else {
		user, err = UserFromRequest(r)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	if user == nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}

	overall, err := db.GetOverallStats(ctx, user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}

	modes, err := db.GetModeStats(ctx, user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}

	recent, err := db.GetRecentRaces(ctx, user.ID, 10)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"username": user.Username,
		"overall":  overall,
		"modes":    modes,
		"recent":   recent,
	})
}
