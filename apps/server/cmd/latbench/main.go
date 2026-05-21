// latbench measures the real end-to-end latency of the multiplayer race engine.
//
// It opens 5 WebSocket connections to a running multitype server (same as 5
// browser tabs would), creates a room, starts a real race, and during RUNNING
// has client 0 send N "progress" messages with a unique cursor each. Every
// other client receives the matching "player_progress" broadcast and records
// the wall-clock delta from "moment of send" to "moment of receive".
//
// Because all 5 clients run inside this single process, they share a clock,
// so one-way latency = receiver_recv_time - sender_send_time. No clock-sync
// needed. (Cross-machine measurement would require an NTP-style offset
// handshake; that's a different tool.)
//
// What this measures:
//   client send (WriteJSON) -> WS frame -> server read -> Room.UpdateProgress
//   -> broadcastLocked -> per-client send chan -> writePump WriteJSON -> WS
//   frame -> client ReadJSON -> our onMsg.
//
// What it does NOT measure: the browser keyboard event, React state update,
// DOM paint, or the 120ms client-side progress throttle. Those add real time
// in production but aren't part of "server + WS sync" cost.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const nClients = 5

type wireOut struct {
	Type string         `json:"type"`
	Rid  string         `json:"rid,omitempty"`
	Data map[string]any `json:"data,omitempty"`
}

type wireIn struct {
	Type string          `json:"type"`
	Rid  string          `json:"rid,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
	Err  string          `json:"err,omitempty"`
}

type sentKey struct {
	senderPid string
	cursor    int
}

type bench struct {
	conns [nClients]*websocket.Conn
	pids  [nClients]string

	helloCh  [nClients]chan struct{}
	joinedCh [nClients]chan struct{}
	rid      string
	ridSet   chan struct{}
	statusCh chan string

	sentMu sync.Mutex
	sentAt map[sentKey]time.Time

	// samples[recvIdx][senderIdx] = one-way latency samples in ms
	sampMu  sync.Mutex
	samples [nClients][nClients][]float64
}

func newBench() *bench {
	b := &bench{
		sentAt:   make(map[sentKey]time.Time),
		ridSet:   make(chan struct{}),
		statusCh: make(chan string, 32),
	}
	for i := range b.helloCh {
		b.helloCh[i] = make(chan struct{})
		b.joinedCh[i] = make(chan struct{})
	}
	return b
}

func (b *bench) pidIdx(pid string) int {
	for i, p := range b.pids {
		if p == pid {
			return i
		}
	}
	return -1
}

func (b *bench) send(idx int, m wireOut) error {
	return b.conns[idx].WriteJSON(m)
}

func (b *bench) onMsg(idx int, m wireIn) {
	switch m.Type {
	case "hello":
		var d struct {
			Pid     string `json:"pid"`
			Session string `json:"session"`
		}
		_ = json.Unmarshal(m.Data, &d)
		b.pids[idx] = d.Pid
		close(b.helloCh[idx])

	case "room_joined":
		var d struct {
			Rid string `json:"rid"`
		}
		_ = json.Unmarshal(m.Data, &d)
		if idx == 0 && b.rid == "" {
			b.rid = d.Rid
			close(b.ridSet)
		}
		select {
		case <-b.joinedCh[idx]:
		default:
			close(b.joinedCh[idx])
		}

	case "room_state":
		var d struct {
			Status string `json:"status"`
		}
		_ = json.Unmarshal(m.Data, &d)
		if idx == 0 {
			select {
			case b.statusCh <- d.Status:
			default:
			}
		}

	case "player_progress":
		var d struct {
			Pid    string `json:"pid"`
			Cursor int    `json:"cursor"`
		}
		_ = json.Unmarshal(m.Data, &d)
		recvAt := time.Now()
		senderIdx := b.pidIdx(d.Pid)
		if senderIdx < 0 {
			return
		}
		b.sentMu.Lock()
		t0, ok := b.sentAt[sentKey{senderPid: d.Pid, cursor: d.Cursor}]
		b.sentMu.Unlock()
		if !ok {
			return
		}
		latMs := float64(recvAt.Sub(t0).Microseconds()) / 1000.0
		b.sampMu.Lock()
		b.samples[idx][senderIdx] = append(b.samples[idx][senderIdx], latMs)
		b.sampMu.Unlock()
	}
}

func (b *bench) readPump(idx int) {
	for {
		var m wireIn
		if err := b.conns[idx].ReadJSON(&m); err != nil {
			return
		}
		b.onMsg(idx, m)
	}
}

func (b *bench) connect(idx int, addr string) error {
	c, _, err := websocket.DefaultDialer.Dial(addr, nil)
	if err != nil {
		return err
	}
	b.conns[idx] = c
	go b.readPump(idx)
	return nil
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(float64(len(sorted)-1) * p)
	return sorted[idx]
}

func main() {
	addr := flag.String("addr", "ws://127.0.0.1:8080/ws", "WS address")
	samples := flag.Int("n", 200, "samples per sender")
	interval := flag.Duration("interval", 30*time.Millisecond, "per-sender send interval")
	concurrent := flag.Bool("concurrent", false, "all 5 clients send concurrently (realistic race load)")
	flag.Parse()

	b := newBench()

	log.Printf("connecting %d clients to %s", nClients, *addr)
	for i := 0; i < nClients; i++ {
		if err := b.connect(i, *addr); err != nil {
			log.Fatalf("connect client %d: %v", i, err)
		}
		<-b.helloCh[i]
	}
	log.Printf("all hello'd; pids=%v", b.pids)

	log.Printf("client 0 creating room")
	if err := b.send(0, wireOut{Type: "create_room", Data: map[string]any{"name": "P0"}}); err != nil {
		log.Fatal(err)
	}
	select {
	case <-b.ridSet:
	case <-time.After(3 * time.Second):
		log.Fatal("timed out waiting for room_joined")
	}
	log.Printf("room rid=%s", b.rid)

	for i := 1; i < nClients; i++ {
		name := fmt.Sprintf("P%d", i)
		if err := b.send(i, wireOut{Type: "join_room", Rid: b.rid, Data: map[string]any{"name": name}}); err != nil {
			log.Fatalf("join %d: %v", i, err)
		}
		<-b.joinedCh[i]
	}
	log.Printf("all 5 in room")

	log.Printf("readying up")
	for i := 0; i < nClients; i++ {
		if err := b.send(i, wireOut{Type: "ready", Data: map[string]any{"ready": true}}); err != nil {
			log.Fatalf("ready %d: %v", i, err)
		}
	}

	log.Printf("waiting for RUNNING (5s countdown)")
	deadline := time.After(15 * time.Second)
waitRun:
	for {
		select {
		case s := <-b.statusCh:
			if s == "RUNNING" {
				break waitRun
			}
		case <-deadline:
			log.Fatal("timed out waiting for RUNNING")
		}
	}
	startWall := time.Now()
	var wg sync.WaitGroup

	senderLoop := func(idx int) {
		defer wg.Done()
		for cur := 1; cur <= *samples; cur++ {
			key := sentKey{senderPid: b.pids[idx], cursor: cur}
			b.sentMu.Lock()
			b.sentAt[key] = time.Now()
			b.sentMu.Unlock()

			if err := b.send(idx, wireOut{Type: "progress", Data: map[string]any{"cursor": cur, "mistakes": 0}}); err != nil {
				log.Printf("send progress client%d: %v", idx, err)
				return
			}
			time.Sleep(*interval)
		}
	}

	if *concurrent {
		log.Printf("RUNNING; sending %d samples from ALL 5 clients concurrently at %v interval (=%d msg/s aggregate)",
			*samples, *interval, int(float64(nClients)*float64(time.Second)/float64(*interval)))
		for i := 0; i < nClients; i++ {
			wg.Add(1)
			go senderLoop(i)
		}
	} else {
		log.Printf("RUNNING; sending %d samples from client 0 only at %v interval", *samples, *interval)
		wg.Add(1)
		go senderLoop(0)
	}
	wg.Wait()
	log.Printf("done sending in %v; waiting 500ms for stragglers", time.Since(startWall))
	time.Sleep(500 * time.Millisecond)

	printSamples := func(label string, s []float64) {
		if len(s) == 0 {
			fmt.Printf("%-28s no samples\n", label)
			return
		}
		sort.Float64s(s)
		fmt.Printf("%-28s %6d %8.2f %8.2f %8.2f %8.2f %8.2f %8.2f\n",
			label, len(s),
			s[0],
			percentile(s, 0.50),
			percentile(s, 0.90),
			percentile(s, 0.95),
			percentile(s, 0.99),
			s[len(s)-1])
	}

	fmt.Println()
	fmt.Println("=== per (sender -> receiver) one-way latency (ms) ===")
	fmt.Printf("%-28s %6s %8s %8s %8s %8s %8s %8s\n",
		"pair", "n", "min", "p50", "p90", "p95", "p99", "max")

	var all []float64
	var others []float64 // exclude self-loop (RTT)
	for sender := 0; sender < nClients; sender++ {
		for recv := 0; recv < nClients; recv++ {
			b.sampMu.Lock()
			s := append([]float64{}, b.samples[recv][sender]...)
			b.sampMu.Unlock()
			if len(s) == 0 {
				continue
			}
			label := fmt.Sprintf("c%d -> c%d", sender, recv)
			if sender == recv {
				label += " (self/RTT)"
			}
			printSamples(label, s)
			all = append(all, s...)
			if sender != recv {
				others = append(others, s...)
			}
		}
	}

	fmt.Println()
	fmt.Println("=== aggregate ===")
	printSamples("all pairs", all)
	printSamples("excluding self (true 1-way)", others)

	for i := 0; i < nClients; i++ {
		_ = b.conns[i].Close()
	}
}
