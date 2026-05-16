// main.go is the server entry point. It loads .env (so we don't have to set
// JWT_SECRET / DATABASE_URL in the shell every time), connects to Postgres if
// it's reachable, then registers the HTTP routes and starts listening on :8080.
//
// The interesting route is /ws. Every WebSocket connection becomes a Client
// (see client.go) with its own read and write goroutines. Everything else
// (auth, profile, health) is just regular HTTP handlers.
//
// Postgres is optional. If the server can't reach it, login and race history
// silently no-op; the multiplayer game itself still works.
package main

import (
	"context"
	_ "embed"
	"log"
	"net/http"
	"os"
	"time"

	"multiplayer-server/db"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

// initSQL holds the schema. Embedded at compile time so the binary is self-contained.
//
//go:embed migrations/001_init.sql
var initSQL string

// upgrader turns plain HTTP requests into WebSocket connections.
// CheckOrigin returns true because we want any browser tab (any origin) to be
// able to connect during development. In production you'd lock this down.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// corsMiddleware adds the headers browsers need to call the API from a different origin
// (the Vite dev server runs on :5173 while the API is on :8080, so the browser treats
// them as cross-origin).
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	// Load .env if it exists. Ignored if missing -- env vars set by the shell still win.
	_ = godotenv.Load()

	ctx := context.Background()

	// Postgres is optional. If it's down, log it and continue: the game still works,
	// auth/history just silently no-op via `if db.Pool != nil` checks elsewhere.
	if err := db.Connect(ctx); err != nil {
		log.Printf("warning: DB unavailable (%v), auth/stats disabled", err)
	} else {
		if _, err := db.Pool.Exec(ctx, initSQL); err != nil {
			log.Printf("warning: migrations failed: %v", err)
		} else {
			log.Println("DB connected, migrations applied")
		}
	}

	hub := NewHub()

	mux := http.NewServeMux()

	// /ws is the only stateful endpoint. Upgrade to WebSocket, spawn read+write goroutines.
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("upgrade error:", err)
			return
		}
		client := NewClient(hub, conn)
		go client.writePump()
		go client.readPump()
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Rate-limit registration and login by IP. 10 attempts per minute, then 429.
	authLimiter := NewRateLimiter(10, time.Minute)
	mux.HandleFunc("/api/auth/register", authLimiter.limit(handleRegister))
	mux.HandleFunc("/api/auth/login", authLimiter.limit(handleLogin))
	mux.HandleFunc("/api/me", handleMe)
	mux.HandleFunc("/api/profile/", handleProfile)

	// Render, Koyeb, Fly etc. assign a port via the PORT env var. Fall back to 8080 for local dev.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Println("listening on", addr)
	log.Fatal(http.ListenAndServe(addr, corsMiddleware(mux)))
}
