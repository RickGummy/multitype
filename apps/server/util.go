package main

import (
	"crypto/rand"
	"encoding/hex"
	"math"
	"time"
)

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
