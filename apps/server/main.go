package main

import (
	"context"
	_ "embed"
	"log"
	"net/http"

	"multiplayer-server/db"

	"github.com/gorilla/websocket"
)

//go:embed migrations/001_init.sql
var initSQL string

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

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
	ctx := context.Background()

	if err := db.Connect(ctx); err != nil {
		log.Printf("warning: DB unavailable (%v) — auth/stats disabled", err)
	} else {
		if _, err := db.Pool.Exec(ctx, initSQL); err != nil {
			log.Printf("warning: migrations failed: %v", err)
		} else {
			log.Println("DB connected, migrations applied")
		}
	}

	hub := NewHub()

	mux := http.NewServeMux()

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

	mux.HandleFunc("/api/auth/register", handleRegister)
	mux.HandleFunc("/api/auth/login", handleLogin)
	mux.HandleFunc("/api/me", handleMe)
	mux.HandleFunc("/api/profile/", handleProfile)

	log.Println("listening on: 8080")
	log.Fatal(http.ListenAndServe(":8080", corsMiddleware(mux)))
}
