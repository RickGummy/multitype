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
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// trustProxyHeaders controls whether X-Forwarded-For is honored when identifying
// the client IP. Off by default: when off, we use the direct RemoteAddr, which a
// remote attacker cannot spoof. Turn it on (TRUST_PROXY_HEADERS=1) only when the
// server runs behind a proxy/load balancer that strips or sanitizes client-supplied
// XFF headers. Without that, anyone can send `X-Forwarded-For: 1.2.3.4` to get a
// fresh rate-limit bucket per request and bypass the limit entirely.
var trustProxyHeaders = func() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("TRUST_PROXY_HEADERS")))
	return v == "1" || v == "true" || v == "yes"
}()

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

// clientIP returns the client's IP. When TRUST_PROXY_HEADERS is set, we read the
// leftmost entry from X-Forwarded-For (the original client IP as seen by the
// outermost trusted proxy). Otherwise we use RemoteAddr directly so an attacker
// can't forge their identity by sending an XFF header themselves.
func clientIP(r *http.Request) string {
	if trustProxyHeaders {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			if comma := strings.IndexByte(fwd, ','); comma >= 0 {
				return strings.TrimSpace(fwd[:comma])
			}
			return strings.TrimSpace(fwd)
		}
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
