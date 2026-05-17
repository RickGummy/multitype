# multitype

Real-time multiplayer typing game. Up to 5 players race each other on the same prompt, server picks the seed, everyone syncs over WebSockets.

**Play it:** [multitype.pages.dev](https://multitype.pages.dev/)

![multitype](docs/screenshot.png)

## Stack

- React + TypeScript + Vite (frontend)
- Go + gorilla/websocket (server)
- Postgres via pgx (auth + race history, not required)

## Run locally

```bash
# backend
cd apps/server && go run .

# frontend, in another terminal
cd apps/web && npm install && npm run dev
```

Open http://localhost:5173. Postgres is optional, if you don't have it, only auth and history break, the game still works.

## Deploy

The server has a `Dockerfile` and reads `PORT`, `JWT_SECRET`, `DATABASE_URL` from env. The frontend reads `VITE_API_BASE` and `VITE_WS_URL` at build time. Drop the server on Render / Koyeb / Fly, the frontend on Cloudflare Pages / Vercel, point them at a Postgres (Supabase).
