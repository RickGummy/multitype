package main

import (
	"strconv"
	"testing"
)

func newTestClient(name string) *Client {
	return &Client{
		pid:     newID(8),
		session: newID(24),
		send:    make(chan ServerMsg, 64),
		name:    name,
		acc:     100,
	}
}

func newTestRoom() *Room {
	h := NewHub()
	rid := newID(4)
	r := NewRoom(rid, h)
	h.rooms[rid] = r
	return r
}

func TestAddClient_AcceptsUpToMaxThenRejects(t *testing.T) {
	r := newTestRoom()
	for i := 0; i < maxPlayers; i++ {
		if !r.AddClient(newTestClient("p" + strconv.Itoa(i))) {
			t.Fatalf("expected client %d to be accepted", i)
		}
	}
	if r.AddClient(newTestClient("overflow")) {
		t.Fatal("expected room to reject join when full")
	}
}

func TestAddClient_BlockedOutsideLobby(t *testing.T) {
	r := newTestRoom()
	r.mu.Lock()
	r.status = "RUNNING"
	r.mu.Unlock()
	if r.AddClient(newTestClient("a")) {
		t.Fatal("expected AddClient to reject during RUNNING")
	}
}

func TestSetReady_StartsCountdownWhenAllReady(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	b := newTestClient("b")
	r.AddClient(a)
	r.AddClient(b)

	r.SetReady(a.pid, true)
	if r.status != "LOBBY" {
		t.Fatalf("one ready should not start countdown, got %s", r.status)
	}
	r.SetReady(b.pid, true)
	if r.status != "COUNTDOWN" {
		t.Fatalf("both ready should start countdown, got %s", r.status)
	}
}

func TestSetReady_RequiresAtLeastTwoPlayers(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	r.AddClient(a)
	r.SetReady(a.pid, true)
	if r.status != "LOBBY" {
		t.Fatalf("solo ready should NOT start countdown, got %s", r.status)
	}
}

func TestFinish_RoomTransitionsWhenAllFinished(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	b := newTestClient("b")
	r.AddClient(a)
	r.AddClient(b)
	r.mu.Lock()
	r.status = "RUNNING"
	a.status = "RUNNING"
	b.status = "RUNNING"
	r.startAtMs = nowMs() - 1000
	r.mu.Unlock()

	r.Finish(a.pid)
	if r.status != "RUNNING" {
		t.Fatalf("only one finished, expected RUNNING, got %s", r.status)
	}
	r.Finish(b.pid)
	if r.status != "FINISHED" {
		t.Fatalf("all finished, expected FINISHED, got %s", r.status)
	}
}

func TestRemoveClient_MidRace_KeepsRoomRunning(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	b := newTestClient("b")
	r.AddClient(a)
	r.AddClient(b)
	r.mu.Lock()
	r.status = "RUNNING"
	a.status = "RUNNING"
	b.status = "RUNNING"
	a.cursor = 30
	r.mu.Unlock()

	r.RemoveClient(b.pid)
	if r.status != "RUNNING" {
		t.Fatalf("removing one mid-race should keep RUNNING, got %s", r.status)
	}
	if a.cursor != 30 {
		t.Fatalf("survivor's cursor should be preserved, got %d", a.cursor)
	}
}

func TestRemoveClient_TransitionsToFinishedIfRemainingAllDone(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	b := newTestClient("b")
	r.AddClient(a)
	r.AddClient(b)
	r.mu.Lock()
	r.status = "RUNNING"
	a.status = "FINISHED"
	b.status = "RUNNING"
	r.startAtMs = nowMs() - 1000
	r.mu.Unlock()

	r.RemoveClient(b.pid)
	if r.status != "FINISHED" {
		t.Fatalf("expected FINISHED when last unfinished player leaves, got %s", r.status)
	}
}

func TestSuspendClient_DuringRunning_PreservesSnapshot(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	b := newTestClient("b")
	r.AddClient(a)
	r.AddClient(b)
	r.mu.Lock()
	r.status = "RUNNING"
	a.status = "RUNNING"
	b.status = "RUNNING"
	a.cursor = 42
	a.mistakes = 3
	r.mu.Unlock()

	if !r.SuspendClient(a.pid, a.session) {
		t.Fatal("expected suspend to succeed during RUNNING")
	}
	r.mu.Lock()
	_, stillInClients := r.clients[a.pid]
	snap, inSuspended := r.suspended[a.session]
	r.mu.Unlock()

	if stillInClients {
		t.Fatal("expected suspended client to be removed from clients map")
	}
	if !inSuspended {
		t.Fatal("expected suspended entry to exist")
	}
	if snap.cursor != 42 || snap.mistakes != 3 {
		t.Fatalf("snapshot lost game state: cursor=%d mistakes=%d", snap.cursor, snap.mistakes)
	}
}

func TestSuspendClient_NoopInLobby(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	r.AddClient(a)
	if r.SuspendClient(a.pid, a.session) {
		t.Fatal("suspend should not run during LOBBY")
	}
}

func TestRejoinClient_RestoresStateDuringRunning(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	b := newTestClient("b")
	r.AddClient(a)
	r.AddClient(b)
	r.mu.Lock()
	r.status = "RUNNING"
	a.status = "RUNNING"
	b.status = "RUNNING"
	a.cursor = 42
	r.mu.Unlock()

	oldSession := a.session
	oldPid := a.pid

	if !r.SuspendClient(a.pid, a.session) {
		t.Fatal("suspend failed")
	}

	newClient := newTestClient("a-rejoined")
	if !r.RejoinClient(newClient, oldSession) {
		t.Fatal("rejoin failed during RUNNING")
	}
	if newClient.pid != oldPid {
		t.Fatalf("expected pid preserved across rejoin, got %s want %s", newClient.pid, oldPid)
	}
	if newClient.cursor != 42 {
		t.Fatalf("expected cursor restored to 42, got %d", newClient.cursor)
	}
	r.mu.Lock()
	_, stillSuspended := r.suspended[oldSession]
	_, backInClients := r.clients[oldPid]
	r.mu.Unlock()
	if stillSuspended {
		t.Fatal("suspended entry should be cleared after successful rejoin")
	}
	if !backInClients {
		t.Fatal("rejoined client should be in clients map")
	}
}

func TestRejoinClient_FailsAfterRaceFinished(t *testing.T) {
	r := newTestRoom()
	a := newTestClient("a")
	b := newTestClient("b")
	r.AddClient(a)
	r.AddClient(b)
	r.mu.Lock()
	r.status = "RUNNING"
	a.status = "RUNNING"
	b.status = "RUNNING"
	r.startAtMs = nowMs() - 1000
	r.mu.Unlock()

	if !r.SuspendClient(a.pid, a.session) {
		t.Fatal("suspend failed")
	}
	r.Finish(b.pid)
	if r.status != "FINISHED" {
		t.Fatalf("expected FINISHED after only remaining player finishes, got %s", r.status)
	}

	newClient := newTestClient("a-rejoined")
	if r.RejoinClient(newClient, a.session) {
		t.Fatal("rejoin should fail when race already ended")
	}
}

func TestRejoinClient_FailsWithUnknownSession(t *testing.T) {
	r := newTestRoom()
	newClient := newTestClient("ghost")
	if r.RejoinClient(newClient, "never-existed") {
		t.Fatal("rejoin should fail for unknown session")
	}
}

func TestIsEmpty_TrueOnlyWhenNoClientsAndNoSuspended(t *testing.T) {
	r := newTestRoom()
	if !r.IsEmpty() {
		t.Fatal("fresh room should be empty")
	}
	a := newTestClient("a")
	r.AddClient(a)
	if r.IsEmpty() {
		t.Fatal("room with a client should not be empty")
	}
	r.mu.Lock()
	r.status = "RUNNING"
	a.status = "RUNNING"
	r.mu.Unlock()
	r.SuspendClient(a.pid, a.session)
	if r.IsEmpty() {
		t.Fatal("room with a suspended session should not be empty")
	}
}
