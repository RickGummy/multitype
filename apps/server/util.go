package main

import (
	"crypto/rand"
	"encoding/hex"
	"math"
	"strings"
	"time"
	"unicode"
)

const maxNameLen = 20

// sanitizeName trims, strips control characters, and caps the length of a user-supplied name.
func sanitizeName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range s {
		if unicode.IsControl(r) || r == '\x00' {
			continue
		}
		b.WriteRune(r)
		if b.Len() >= maxNameLen*4 { // utf-8 max bytes per rune
			break
		}
	}
	out := b.String()
	if len([]rune(out)) > maxNameLen {
		runes := []rune(out)
		out = string(runes[:maxNameLen])
	}
	return out
}

func newID(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func nowMs() int64 {
	return time.Now().UnixNano() / int64(time.Millisecond)
}

func computeWPM(correctChars int, elapsedMs int64) float64 {
	if elapsedMs <= 0 {
		return 0
	}

	minutes := float64(elapsedMs) / 60000.0
	return (float64(correctChars) / 5.0) / minutes
}

func computeAcc(correctChars, mistakes int) float64 {
	den := float64(correctChars + mistakes)

	if den == 0 {
		return 1
	}
	return float64(correctChars) / den
}

func round2(x float64) float64 {
	return math.Round(x*100) / 100
}
