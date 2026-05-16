# --- build stage ---
# Pin to a specific Go version. Alpine for a small builder image.
FROM golang:1.25-alpine AS build

WORKDIR /src

# Copy go.mod/go.sum first so `go mod download` is cached across code changes.
COPY go.mod go.sum ./
RUN go mod download

# Now bring in the rest of the source and build a static binary.
# CGO_OFF + -ldflags strip debug info -> small, self-contained binary.
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/multiplayer-server .

# --- runtime stage ---
# distroless/static is ~2MB, no shell, just the binary and root CA certs (for TLS to Postgres etc).
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=build /out/multiplayer-server /app/multiplayer-server

# Document the default port. Render/Koyeb override this via the PORT env var
# and main.go reads it at runtime.
EXPOSE 8080

USER nonroot:nonroot
ENTRYPOINT ["/app/multiplayer-server"]
