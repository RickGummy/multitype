

export type WSMsg = {
    type : string;
    rid ?: string;
    data ?: unknown;
    err ?: string;
};

type OnMsg = (m: WSMsg) => void;

const MAX_BACKOFF_MS = 8000;

export class WSClient {
    private ws: WebSocket | null = null;
    private onMsg: OnMsg;
    private url = "ws://127.0.0.1:8080/ws";
    private closed = false;
    private backoffMs = 500;
    private reconnectTimer: number | null = null;

    constructor(onMsg: OnMsg) {
        this.onMsg = onMsg;
    }

    connect(url = "ws://127.0.0.1:8080/ws") {
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
            this.backoffMs = 500;
        };

        ws.onclose = () => {
            console.log("[ws] close");
            this.ws = null;
            if (this.closed) return;
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

    private scheduleReconnect() {
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            if (this.closed) return;
            this.open();
        }, delay);
    }

    send(msg: WSMsg) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.ws.send(JSON.stringify(msg));
    }

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
