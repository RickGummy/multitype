// auth.go handles user registration, login, token verification, and the profile
// endpoints. Passwords are stored as bcrypt hashes; tokens are HS256 JWTs signed
// with jwtSecret. The frontend keeps the token in localStorage and sends it back
// either as an Authorization: Bearer header on HTTP requests, or in an `auth`
// message over the WebSocket.
//
// A few hardening notes that are easy to miss:
// jwtSecret falls back to a fresh random value if JWT_SECRET isn't set, so we
// never ship with a guessable default. Login and register are rate-limited by
// main.go to slow down brute forcers. JWT parsing pins HS256, which blocks
// the classic "alg: none" attack where someone strips the signature.
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

// jwtSecret signs every JWT and is checked against every incoming one.
// Setup priority:
//   1. Read JWT_SECRET from env (set via .env or shell export). Use that.
//   2. If missing, generate a fresh random 32-byte secret at startup.
//      Safe but ephemeral: every restart invalidates all existing tokens.
//      We log a loud warning so it's obvious in dev.
//
// Critically: there is NO hardcoded string fallback. If there were, anyone reading
// the repo could forge tokens for any user.
var jwtSecret = func() []byte {
	if s := os.Getenv("JWT_SECRET"); s != "" {
		return []byte(s)
	}
	log.Println("warning: JWT_SECRET not set, generating a random secret for this run")
	log.Println("warning: existing tokens will be invalidated on every restart")
	log.Println("warning: set JWT_SECRET to a 32+ char string in production")
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

// makeToken builds an HS256 JWT for the given user with a 30-day expiry.
// The frontend treats this as opaque -- it never reads the payload.
func makeToken(userID, username string) (string, error) {
	claims := jwt.MapClaims{
		"sub":      userID,
		"username": username,
		"exp":      time.Now().Add(30 * 24 * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
}

// validateToken parses and verifies a JWT string and returns the user it identifies.
// Returns (nil, nil) for invalid or expired tokens -- callers treat that as
// "unauthenticated" rather than an error.
//
// WithValidMethods locks the parser to HS256. Without this, an attacker can send
// a token with "alg": "none" and no signature, and some JWT libraries will
// accept it as valid. This is a well-known JWT attack so it's worth being explicit.
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

// handleRegister: POST /api/auth/register
// Body: {"username", "password"}
// Returns: {"token", "id", "username"} on success.
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

// handleLogin: POST /api/auth/login
// Body: {"username", "password"}
// Returns: {"token", "id", "username"} on success, 401 on bad creds.
// Note: same error message for "user doesn't exist" and "wrong password" -- this
// stops attackers from enumerating valid usernames.
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
