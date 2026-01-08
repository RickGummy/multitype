

export type WSMsg = {
    type : string;
    rid ?: string;
    data ?: any;
    err ?: string;
};

type OnMsg = (m: WSMsg) => void;

export class WSClient {
    private ws: WebSocket | null = null;
    private onMsg: OnMsg;

    constructor(onMsg: OnMsg) {
        this.onMsg = onMsg;
    }

    connect(url = "ws://127.0.0.1:8080/ws") {
        this.ws = new WebSocket(url);
        this.ws.onopen = () => console.log("[ws] open");
        this.ws.onclose = () => console.log("[ws] close");
        this.ws.onerror = (e) => console.log("[ws] error", e);

        this.ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data) as WSMsg;
                this.onMsg(msg);
            }
            catch {
                console.log("[ws] non-json message", e.data);
            }
        };
    }

    send(msg: WSMsg) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }
        
        this.ws.send(JSON.stringify(msg));
    }

    close() {
        this.ws?.close();
        this.ws = null;
    }
}