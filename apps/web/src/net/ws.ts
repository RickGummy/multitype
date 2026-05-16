// ws.ts -- thin wrapper around the browser WebSocket API.
//
// Adds two things on top of the raw WebSocket:
//   1. JSON marshal/unmarshal on send/receive.
//   2. Auto-reconnect with exponential backoff when the connection drops
//      unexpectedly. Used by the multiplayer rejoin flow: when the WS dies,
//      this client reconnects on its own; the server emits a fresh `hello`
//      on connect, and the consumer reacts by sending a `rejoin` message
//      with the old session token (see Multiplayer.tsx).

// WSMsg is the wire envelope. Matches ClientMsg/ServerMsg in apps/server/protocol.go.
export type WSMsg = {
    type : string;
    rid ?: string;
    data ?: unknown;
    err ?: string;
};

type OnMsg = (m: WSMsg) => void;

// MAX_BACKOFF_MS caps the wait time between reconnect attempts.
// Starts at 500ms, doubles each failure, never exceeds this.
const MAX_BACKOFF_MS = 8000;

// Override via VITE_WS_URL in apps/web/.env.local (dev) or in the host's env
// (Cloudflare Pages / Vercel dashboard) for production -- e.g. wss://api.example.com/ws.
const DEFAULT_WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8080/ws";

export class WSClient {
    private ws: WebSocket | null = null;
    private onMsg: OnMsg;
    private url = DEFAULT_WS_URL;
    private closed = false;          // true once close() is called -> stop reconnecting
    private backoffMs = 500;         // current backoff delay; resets on a successful open
    private reconnectTimer: number | null = null;

    constructor(onMsg: OnMsg) {
        this.onMsg = onMsg;
    }

    // connect kicks off the first connection attempt. Subsequent reconnects
    // happen automatically via onclose -> scheduleReconnect.
    connect(url = DEFAULT_WS_URL) {
        this.url = url;
        this.closed = false;
        this.open();
    }

    private open() {
        if (this.reconnectTimer != null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
            console.log("[ws] open");
            this.backoffMs = 500; // reset on success
        };

        ws.onclose = () => {
            console.log("[ws] close");
            this.ws = null;
            if (this.closed) return; // intentional close, don't reconnect
            this.scheduleReconnect();
        };

        ws.onerror = (e) => console.log("[ws] error", e);

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data) as WSMsg;
                this.onMsg(msg);
            }
            catch {
                console.log("[ws] non-json message", e.data);
            }
        };
    }

    // scheduleReconnect waits `backoffMs` then tries again. Doubles backoffMs
    // for the next attempt up to MAX_BACKOFF_MS.
    private scheduleReconnect() {
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            if (this.closed) return;
            this.open();
        }, delay);
    }

    // send drops silently if the socket isn't open. Most messages are
    // recoverable (the server's state is authoritative), so dropping is
    // safer than throwing.
    send(msg: WSMsg) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.ws.send(JSON.stringify(msg));
    }

    // close marks the client as intentionally closed (no reconnect) and tears
    // down the underlying socket. Called from React cleanup on component unmount.
    close() {
        this.closed = true;
        if (this.reconnectTimer != null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
        this.ws = null;
    }
}
