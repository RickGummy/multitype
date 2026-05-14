// A simple in-memory rate limiter keyed by client IP. Used on login and register
// to slow down anyone trying to brute-force passwords.
//
// Implementation is a fixed-window counter: each IP gets `max` attempts per
// `window`. If they exceed that they get 429s back until the window resets.
//
// It's in-process only. If we ran the server on more than one machine we'd
// have to swap this out for a Redis-backed limiter so the count is shared.
package main

import (
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// bucket = one IP's current counter.
type bucket struct {
	count   int
	resetAt time.Time
}

type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	max     int           // attempts allowed per window
	window  time.Duration // length of the window
}

func NewRateLimiter(maxAttempts int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets: make(map[string]*bucket),
		max:     maxAttempts,
		window:  window,
	}
	go rl.gc()
	return rl
}

// gc evicts expired buckets so the map doesn't grow unbounded.
// Runs once per window in a background goroutine.
func (rl *RateLimiter) gc() {
	for {
		time.Sleep(rl.window)
		now := time.Now()
		rl.mu.Lock()
		for k, b := range rl.buckets {
			if now.After(b.resetAt) {
				delete(rl.buckets, k)
			}
		}
		rl.mu.Unlock()
	}
}

// Allow returns true if the key has remaining attempts within the window.
// retryAfter is the number of seconds the caller should wait when blocked.
func (rl *RateLimiter) Allow(key string) (allowed bool, retryAfter int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok || now.After(b.resetAt) {
		rl.buckets[key] = &bucket{count: 1, resetAt: now.Add(rl.window)}
		return true, 0
	}
	if b.count >= rl.max {
		return false, int(time.Until(b.resetAt).Seconds()) + 1
	}
	b.count++
	return true, 0
}

// clientIP returns the client's IP. Prefers X-Forwarded-For (when running
// behind a proxy/load balancer) then falls back to the direct RemoteAddr.
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		// Take the first IP in the list.
		for i := 0; i < len(fwd); i++ {
			if fwd[i] == ',' {
				return fwd[:i]
			}
		}
		return fwd
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// limit wraps an http.HandlerFunc with rate limiting keyed by client IP.
func (rl *RateLimiter) limit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		allowed, retryAfter := rl.Allow(clientIP(r))
		if !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			writeErr(w, http.StatusTooManyRequests, "too many attempts, slow down")
			return
		}
		next(w, r)
	}
}
