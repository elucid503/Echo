# Echo

A Discord voice audio proxy that captures all channel members' audio from the bot's perspective, mixes them into a single combined stream, and delivers it in real-time to a web dashboard — with a 15-second circular buffer for instant clipping.

---

## Goal

When a Discord bot is present in a voice channel it receives a separate Opus stream per user (keyed by SSRC). Echo decodes those streams, mixes them into one combined PCM output (simulating what you'd hear sitting in the channel), and proxies that output live to any browser that connects to the web dashboard. A circular buffer always holds the last 15 seconds of mixed audio so a clip can be extracted at any moment without interrupting the live stream.

Primary use case: real-time monitoring and clipping of Discord voice calls for sync with pre-recorded footage, highlights, or moderation.

Optional: a listener who keeps the dashboard open in a supported browser can **stream the mixed PCM to a local file** on their own disk (full-session archive) using the **File System Access API**, without Echo retaining long-form audio on the server.

---

## End-to-end audio shape (single mixed PCM)

Discord delivers **Opus** per speaking user (SSRC). Echo **decodes to PCM on the server**, **mixes** those decoded frames into **one** stereo 48 kHz int16 stream, then uses **that same mixed byte stream** everywhere else:

1. **Circular buffer** — the mixer writes each 20 ms mixed frame into the 15 s ring buffer for `GET /clip`.
2. **WebSocket fan-out** — the mixer pushes the **identical** mixed frames to connected browsers for live playback, metering, and optional local recording.

Forwarding **Opus** to the client instead would not simplify the server: instant clips require **decoded mixed PCM** in memory (or on disk) on the server anyway, so the server must still decode and mix. Keeping **one** canonical mixed PCM stream avoids maintaining a parallel encode/decode path for the wire format.

Occasional **dropped WebSocket frames** for a slow client (see non-functional requirements) are acceptable for live listen and for long-form recording: the archive may contain brief gaps, but the session remains largely intact without stalling the real-time pipeline.

---

## Requirements

### Functional

- **Voice join/leave**: The bot joins a Discord voice channel on demand (via bot command or HTTP endpoint) and leaves on request or when the channel empties.
- **Per-user Opus decode**: Each speaking user in the channel is identified by a unique SSRC. The bot maintains a dedicated Opus decoder per SSRC for the lifetime of that user's speaking session.
- **PCM mixing**: All active decoded PCM streams are mixed into a single stereo 48 kHz int16 stream. Mixing is saturating (clamped to ±32767) to prevent integer overflow distortion.
- **Circular buffer**: 15 seconds of mixed PCM (2,880,000 bytes at 48 kHz × 2 channels × 2 bytes) is kept in a thread-safe circular buffer at all times, overwriting the oldest audio when full.
- **Live WebSocket stream**: The mixed stream is broadcast as raw binary PCM frames to all connected browser clients in real-time. Each push is one 20 ms frame (3,840 bytes: 960 samples × 2 channels × 2 bytes/sample). Frame layout matches what the mixer writes into the circular buffer (little-endian int16 stereo).
- **Clip endpoint**: `GET /clip?seconds=N` (1 ≤ N ≤ 15) returns the last N seconds of mixed audio as a valid WAV file for download.
- **Web dashboard**: A minimal browser UI shows connection status, a live VU meter, a playback toggle, and a clip button.
- **Optional full-session recording (client disk)**: When the user starts recording, the dashboard opens a user-chosen file via the File System Access API and appends each incoming mixed PCM frame as it arrives (same bytes as the WebSocket payload). The user is expected to keep the tab open for the duration they wish to capture; closing the tab stops the WebSocket and ends the recording session.
- **Multi-guild support**: The existing `activeConnections` registry is preserved; each guild gets its own pipeline. The web UI selects which guild to listen to.

### Client requirements

- **Chromium-based browser (required for full-session recording)**: Long-form save-to-disk uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (`showSaveFilePicker`, `FileSystemFileHandle.createWritable`). As of this document, that surface is **not consistently available** in all browsers; **Chromium** (Chrome, Edge, Brave, etc.) is the **supported** target for recording. Live listen + clips may work elsewhere; recording UX should detect missing APIs and show a clear message (“Use Chrome or Edge to record to disk”).
- **User gesture**: File picker / writable handle creation must be triggered from a **user activation** (e.g. click on “Start recording”); the implementation must not rely on automatic picker open on page load.

### Non-functional

- **No FFmpeg**: All codec work is native Go or CGo only. No subprocess calls.
- **Low latency**: End-to-end latency from Discord audio packet arrival to browser playback shall be under 500 ms.
- **Non-blocking broadcast**: Slow or lagging WebSocket clients must not stall the audio pipeline. Frames are dropped for clients whose write buffers are full. The same applies to a client that is recording to disk: missing frames yield brief gaps in the local file, which is acceptable for v1.
- **Safe concurrency**: The audio write path (receiver -> mixer -> buffer) and the read paths (WebSocket broadcast, clip endpoint) must not race. All shared state is guarded by mutexes or channels.
- **Graceful degradation**: If no clients are connected the pipeline runs silently (still feeds the buffer). If no users are speaking the buffer fills with silence frames.

---

## Libraries and External Dependencies

### Go modules

| Module | Purpose | CGo? |
|---|---|---|
| `github.com/hraban/opus` | libopus bindings — Opus to PCM decode per SSRC | Yes (libopus, libopusfile) |
| `github.com/disgoorg/godave/golibdave` | libdave-backed DAVE E2EE session for the voice gateway | Yes (libdave) |
| `github.com/go-audio/wav` | WAV file encoder for clip downloads | No |
| `github.com/gin-gonic/gin` | HTTP router and middleware for the dashboard server | No |
| `github.com/gorilla/websocket` | WebSocket upgrade + binary frame fan-out | No |
| `github.com/disgoorg/disgo` | Discord Gateway + voice UDP connection | No |
| `github.com/joho/godotenv` | `.env` loading | No |

### Frontend stack

The dashboard is a small React single-page app built with:

| Tool | Role |
|---|---|
| [Bun](https://bun.sh) | Package manager and JS runtime used by Vite |
| [Vite](https://vitejs.dev) | Dev server and production bundler (outputs static `dist/`) |
| [React 19](https://react.dev) (class components only) | UI framework |
| [Tailwind CSS 4](https://tailwindcss.com) | Utility-first styling |

The production build (`bun run build`) emits a static `dist/` folder which is embedded into the Go binary via `//go:embed` and served from the Gin router. There is no separate Node server in production.

### Browser APIs (runtime)

| API | Used for |
|---|---|
| `WebSocket` | Receive binary PCM frames from Go server |
| `AudioContext` + `AudioWorklet` | Schedule and play incoming PCM in real-time |
| `AnalyserNode` | VU meter rendering |
| File System Access API (`showSaveFilePicker`, `FileSystemFileHandle.createWritable`, `FileSystemWritableFileStream.write`) | Optional: append each mixed PCM frame to a file on the user’s machine (full-session recording); Chromium required |

---

## Architecture

The **mixer emits exactly one mixed PCM frame every 20 ms**. That frame is written **once** to the circular buffer and **once** (logically) handed to the hub for broadcast. There is no separate “clip pipeline” PCM copy beyond reading the same buffer the mixer already updated.

### Live stream path

```mermaid
flowchart TD
    Discord["Discord UDP\nOpus RTP packets per SSRC/user"]
    Receiver["voice/receiver.go\nper-SSRC Opus decoder pool\noutputs int16 PCM frames at 20ms"]
    Mixer["voice/mixer.go\nsaturating int16 mix across all SSRCs\nemits one combined frame every 20ms"]
    Buffer["voice/buffer.go\nthread-safe circular buffer\n15s of mixed PCM"]
    Hub["web/hub.go\nWebSocket fan-out hub"]
    WS["per-client WebSocket goroutine\ndrops frame if client send buffer is full"]
    Browser["Browser AudioWorklet\nFloat32 queue -> AudioContext -> speakers"]
    Disk["Optional: FileSystemWritableFileStream\nappend same PCM bytes to local file"]

    Discord --> Receiver --> Mixer
    Mixer --> Buffer
    Mixer --> Hub --> WS --> Browser
    WS -.->|same binary frames| Disk
```

### Clip path

```mermaid
flowchart LR
    Req["GET /clip?seconds=N"]
    Buffer["voice/buffer.go\nGetLastN(n)"]
    Server["web/server.go\nWAV encode"]
    Resp["HTTP response\nContent-Type: audio/wav"]

    Req --> Buffer --> Server --> Resp
```

### Client-side full-session recording (File System Access API)

Goal: persist **hours** of mixed audio on the **listener’s** machine without Echo storing more than the 15 s server buffer.

**Data written:** the same **raw** little-endian int16 stereo 48 kHz PCM chunks as each WebSocket binary message (no extra framing). That matches the PCM body the server would place inside a WAV for clips (minus the 44-byte RIFF header).

**Suggested flow (vanilla JS):**

1. User clicks **Start recording** (satisfies user-gesture / transient activation requirements).
2. `const handle = await showSaveFilePicker({ suggestedName: 'echo-session.raw', types: [...] });` then `const writable = await handle.createWritable();`  
   Alternatively keep a single long-lived `FileSystemWritableFileStream` reference for the session.
3. On each `WebSocket` `message` (binary): write the frame’s PCM bytes with `await writable.write({ type: 'write', data: uint8View });`. If the same buffer is **transferred** to an `AudioWorklet`, persist a **`slice()` copy** of the frame first (see `app.js` notes); otherwise you can write the incoming view directly when not using transfer.
4. On **Stop recording** or `WebSocket` `onclose`: `await writable.close();`.

**Making a playable `.wav`:** raw `.pcm` is not universally double-clickable. Options:

- **Post-close conversion** (simplest): on stop, run an in-page WAV builder: prepend the standard 44-byte header for `{ sampleRate: 48000, numChannels: 2, bitsPerSample: 16 }` and set RIFF/data chunk sizes from the final byte length, then offer a second download; or document that users can import the `.raw` in Audacity / FFmpeg with `-f s16le -ar 48000 -ac 2`.
- **Streaming WAV (advanced):** write a WAV header at session start with placeholder chunk sizes, stream PCM appends, then **seek** back and patch sizes in the header before `close()` (requires a seekable file; verify behavior for the chosen extension and OS).

**Operational expectations:** the recording tab should stay open (minimized is fine). Background throttling may reduce timer precision for UI, but WebSocket delivery and `write` calls should proceed while the connection stays alive. If the browser suspends the tab aggressively, recording quality may suffer; documenting “keep tab active” is reasonable.

**Relation to clips:** clips still come from the **server** ring buffer + `GET /clip` (WAV). The local file is independent; both ultimately reflect the **same** mixed PCM stream when frames are not dropped.

---

## Modules

### `voice/` — Audio pipeline

#### `voice/conn.go` *(existing, extend)*

Current: manages the `activeConnections` map and opens/closes the disgo `voice.Conn`.

Needed additions:
- After `voiceConn.Open(...)` succeeds, wire up the `Receiver` (see below) and `Mixer` to this connection.
- Change `Open` call from `selfMute: true` to `selfMute: false` if the bot should also be able to speak in the future; for pure listening `selfMute: true` and `selfDeaf: false` is already correct.
- `Connection` struct gains `Receiver *Receiver` and `Mixer *Mixer` fields so they are owned by and scoped to the connection.

#### `voice/buffer.go` *(existing, extend)*

Current: correct circular buffer logic for `[]byte` PCM.

Needed additions:
- Add `sync.RWMutex` — `WriteAudio` takes a write lock; `GetAudio`/`GetLastN` take a read lock. This is currently unsynchronised and will race.
- Add `GetLastN(seconds float64) []byte` — returns only the most recent N seconds' worth of data rather than the full 15 s, used by the clip endpoint.
- Keep the `[]byte` interface (int16 PCM serialised little-endian) to stay wire-compatible with the WAV encoder and WebSocket frames.

#### `voice/receiver.go` *(new)*

Responsibility: receive raw Opus packets from disgo's `voice.Conn`, maintain a per-SSRC `opus.Decoder` (from `hraban/opus`), decode each packet to `[]int16`, and forward the frame to the Mixer.

Key types:

```go
type Receiver struct {
    mu       sync.Mutex
    decoders map[uint32]*opus.Decoder  // SSRC -> decoder
    out      chan Frame                 // decoded frames to Mixer
}

type Frame struct {
    SSRC    uint32
    PCM     []int16  // 960 stereo samples = 1920 int16 values
    Missing bool     // true if this is a synthesised silence frame (no packet arrived)
}
```

Submodule responsibilities:
- `Start(conn voice.Conn)` — registers the packet receive handler on the disgo connection. disgo's `voice.Conn` delivers received UDP packets through an `OpusFrameReceiver` callback or equivalent interface (exact method name to be confirmed against disgo v0.19 source; look for `SetReceiveOpus` or a `voice.UserPacketHandler`).
- On each packet: look up or create an `opus.Decoder` for the packet's SSRC; call `decoder.DecodeInt16(opusBytes, pcmBuf, false)` (DTX-safe); send the resulting `Frame` to `out`.
- `Stop()` — closes `out`, tears down decoders.
- The `out` channel is unbuffered or has a depth of 3 frames per expected concurrent speaker. Drop frames (log a warning) rather than block if the Mixer is not consuming fast enough.

Opus decoder parameters: 48000 Hz, 2 channels. Frame size 960 samples (20 ms). These match Discord's fixed encoding parameters.

#### `voice/mixer.go` *(new)*

Responsibility: consume `Frame` values from `Receiver.out`, accumulate one 20 ms mixing window, produce a single mixed `[]int16` frame every 20 ms, then **write that frame to the `Buffer` and push the same serialised bytes to `Hub`** — one mixed stream drives both the clip ring buffer and all WebSocket clients.

Key design:
- A ticker fires every 20 ms. On each tick, all frames that have arrived since the previous tick are mixed together. Frames from the same SSRC that arrived after the tick deadline are held for the next window (they form a trivial 1-frame jitter buffer per SSRC).
- Mixing: for each sample index `i`, `mixed[i] = clamp(sum of active[ssrc][i] for all active SSRCs, -32768, 32767)`.
- Output `[]int16` is serialised to `[]byte` (little-endian) before being written to the Buffer and sent to Hub.
- If no frames arrive in a tick window the mixer emits a silence frame (all zeros) to keep the buffer and stream continuous.

```go
type Mixer struct {
    receiver *Receiver
    buffer   *Buffer
    hub      *web.Hub
    stop     chan struct{}
}
```

`Start()` launches the mixing goroutine. `Stop()` closes `stop` and drains the receiver channel.

---

### `web/` — HTTP and WebSocket server

#### `web/server.go` *(new)*

Responsibility: configure Gin, expose the audio/control endpoints, and serve the embedded React `dist/` bundle.

Routes (Gin):
- `GET /` (+ SPA fallback) — serves `frontend/dist/index.html` from the embedded FS.
- `GET /assets/*` — serves Vite's hashed asset bundle from the embedded FS.
- `GET /ws` — upgrades to WebSocket via `gorilla/websocket` and registers the client with the Hub.
- `GET /clip?seconds=N` (1 ≤ N ≤ 15) — calls `buffer.GetLastN(N)`, encodes as WAV using `go-audio/wav`, returns `Content-Type: audio/wav` with `Content-Disposition: attachment; filename="clip.wav"`.
- `GET /status` — returns JSON: `{ connected, guild, channel, listeners, bytesBuffered }`.
- `POST /join` (JSON body `{ guildID, channelID }`) — joins a voice channel on demand.
- `POST /leave` (JSON body `{ guildID }`) — leaves the current voice channel.

The server is started from `main.go` alongside the Discord gateway. Port is read from `WEB_PORT` env var (default `8080`).

WAV encoding (clip endpoint): `go-audio/wav` writes into a small in-memory `io.WriteSeeker` wrapper backed by `bytes.Buffer`; PCM samples are emitted as `audio.IntBuffer` with format `{SampleRate: 48000, NumChannels: 2, BitDepth: 16}`. This requires no FFmpeg and no system library beyond `libopus` (used elsewhere).

#### `web/hub.go` *(new)*

Responsibility: maintain the set of active WebSocket connections and broadcast PCM frames to all of them without blocking the audio pipeline.

```go
type Hub struct {
    clients    map[*Client]struct{}
    broadcast  chan []byte   // mixed PCM frames from Mixer
    register   chan *Client
    unregister chan *Client
}

type Client struct {
    conn *websocket.Conn
    send chan []byte  // buffered, depth 5 (100 ms of frames)
}
```

The Hub's `Run()` goroutine selects on register/unregister/broadcast. On broadcast, it iterates clients and does a non-blocking send on each `client.send` channel — if the channel is full the frame is silently dropped for that client (they may hear a brief glitch but the pipeline is not stalled). Playback and File System recording for that client both consume the same WebSocket-delivered frames, so a dropped hub frame affects both equally.

Each `Client` has its own write goroutine that drains `client.send` and calls `websocket.WriteMessage(websocket.BinaryMessage, frame)`.

#### `web/frontend/` *(new, embedded)*

A React 19 + TypeScript app, scaffolded with Bun + Vite, styled with Tailwind 4. Class components only (per project convention). Production output (`dist/`) is embedded into the Go binary via `//go:embed`.

```
web/
  frontend/
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    src/
      main.tsx              entry; mounts <Dashboard/>
      Dashboard.tsx         top-level class component (status, controls, layout)
      audio/
        AudioPipeline.ts    AudioContext + AudioWorkletNode + AnalyserNode wiring
        worklet.ts          AudioWorkletProcessor (ring buffer + drain logic)
      net/
        EchoSocket.ts       WebSocket lifecycle + binary frame fan-out
      record/
        Recorder.ts         File System Access API writer (chunked, fire-and-forget)
      components/
        StatusBar.tsx       connection / guild / listener counts
        VUMeter.tsx         canvas meter driven by AnalyserNode
        Controls.tsx        play/pause, clip, record, slider
    public/                 (worklet.js copy if Vite worker plugin is not used)
```

**Dashboard responsibilities**
- Status bar (connected/disconnected, guild name, channel name, listener count from `/status`).
- Play/Pause button (toggles `AudioContext.resume()` / `suspend()` without closing the WebSocket).
- VU meter canvas (driven by `AnalyserNode`).
- Clip button + duration slider (1–15 s): calls `GET /clip?seconds=N`, triggers a browser file download.
- **Record** / **Stop recording**: gated on `showSaveFilePicker` / `createWritable` availability; show unsupported-browser copy when missing.

**Audio pipeline**
- `AudioContext` at 48 kHz on first user gesture.
- Registers an `AudioWorkletModule` (`worklet.ts`, bundled via Vite).
- Graph: `AudioWorkletNode` → `AnalyserNode` → `destination`.
- On each binary WebSocket message: convert `ArrayBuffer` to `Int16Array`, post to worklet via `port.postMessage({pcm: int16Array}, [int16Array.buffer])` (zero-copy transfer). **If recording is active**, take a `slice()` of the frame bytes for the recorder **before** transferring the buffer to the worklet — transfer detaches the underlying `ArrayBuffer` on the main thread.
- The recorder appends raw little-endian stereo s16le frames to the `FileSystemWritableFileStream` via a small async queue, so disk I/O does not block audio scheduling.

**Worklet processor**
- Maintains a Float32 sample queue (ring buffer, pre-allocated for ~500 ms capacity).
- On `port.onmessage`: converts incoming `Int16Array` to Float32 (divide by 32768), enqueues samples.
- In `process(inputs, outputs)`: dequeues into the stereo output buffer. If the queue underruns (network hiccup), outputs silence — never throws or stalls.
- The queue target depth is ~200 ms (9,600 samples at 48 kHz). If the queue grows beyond 400 ms the processor trims the oldest samples to prevent drifting latency.

---

## Implementation Guidelines

### Audio pipeline concurrency model

The hot path must never block:

```mermaid
flowchart LR
    UDP["disgo UDP receive\ngoroutine"]
    Mixer["Mixer goroutine"]
    BufWrite["buffer.WriteAudio\nmutex write"]
    HubChan["hub.broadcast\nchannel send"]
    ClipHTTP["buffer.GetLastN\nclip HTTP endpoint\nmutex read on demand"]
    HubRun["Hub.Run goroutine"]
    ClientChan["client.send chan\nnon-blocking send per client"]

    UDP -->|"Receiver.out channel"| Mixer
    Mixer --> BufWrite
    Mixer --> HubChan
    BufWrite --> ClipHTTP
    HubChan --> HubRun --> ClientChan
```

Never hold the buffer mutex while writing to a WebSocket and never hold a WebSocket send lock while touching the buffer.

### Opus decoder lifecycle

Create a new `opus.Decoder` the first time a packet arrives from an SSRC. Never share decoders across SSRCs — the Opus codec is stateful and the decoder's internal state tracks continuity for that stream. On voice state update indicating a user left (`VoiceStateUpdate` with `ChannelID = nil`), the corresponding decoder should be removed from the map and closed.

Map the Discord user ID to SSRC via the `VoiceSpeakingUpdate` gateway event (`EventVoiceSpeakingUpdate` in disgo), which disgo fires when a user starts or stops speaking and which includes both `UserID` and `SSRC`. Store this mapping in `Receiver` for logging and status reporting.

### WAV encoding without FFmpeg

WAV is a trivial container: a 44-byte RIFF header followed by raw little-endian int16 PCM samples. The `go-audio/wav` encoder handles this entirely in Go. No system library, no subprocess. The clip endpoint is therefore a pure memory operation: `buffer.GetLastN(N)` -> WAV encode -> `http.ResponseWriter`.

### Handling disgo's voice receive API

In disgo v0.19, the `voice.Conn` receives audio through a packet handler that must be registered after `Open`. The exact method signature should be verified against the disgo v0.19 source (look for `SetReceiveHandler`, `AddReceiveHandler`, or a `ReceiverFunc` option on `VoiceManager.CreateConn`). The received packet type exposes at minimum: `SSRC uint32`, `Opus []byte`, `Sequence uint16`, `Timestamp uint32`. The sequence and timestamp fields can be used for basic packet reordering if needed, but a simple drop-on-late policy is sufficient for v1.

### Thread safety gaps in existing code

- `buffer.go`: no mutex — add `sync.RWMutex` before any concurrent use.
- `utils/discord.go`: `NewDiscord` assigns to a local `DiscordInstance` variable (shadowing the package-level global). The package-level `DiscordInstance` is never set and will be nil when `conn.go` dereferences it. Fix: `DiscordInstance = &Discord{...}` (no `:=`).
- `activeConnections` map in `conn.go`: not protected by a mutex; safe for now because only one goroutine writes it, but add a `sync.RWMutex` before introducing the HTTP status endpoint which reads concurrently.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `TOKEN` | (required) | Discord bot token |
| `WEB_PORT` | `8080` | HTTP/WebSocket server port |
| `GUILD_ID` | (optional) | Auto-join this guild's voice channel on start |
| `CHANNEL_ID` | (optional) | Auto-join this channel on start (requires `GUILD_ID`) |

### Build prerequisites

System packages (Ubuntu/Debian):

```sh
sudo apt install -y \
    libopus-dev libopusfile-dev libogg-dev \
    pkg-config build-essential cmake git curl unzip
# Bun (skip if already installed)
curl -fsSL https://bun.sh/install | bash
```

`hraban/opus` is a CGo wrapper around libopus/libopusfile; both `-dev` packages are required at build time (only `libopus0` / `libopusfile0` at runtime). `libogg-dev` is a transitive header dependency of libopusfile. `pkg-config` and `build-essential` provide the compiler toolchain CGo invokes.

#### libdave (Discord DAVE E2EE)

As of 2026-03-01 Discord enforces the DAVE end-to-end encryption protocol on every voice connection. Echo uses [`github.com/disgoorg/godave/golibdave`](https://pkg.go.dev/github.com/disgoorg/godave/golibdave), a CGo wrapper around Discord's `libdave`. The shared library must be installed locally before `./build.sh` can link.

The godave repo ships an installer script; the simplest path is to clone the repo, run it, and let it drop `libdave.so`, the `dave.h` header, and a pkg-config descriptor into `$HOME/.local`:

```sh
git clone https://github.com/disgoorg/godave
cd godave
chmod +x scripts/libdave_install.sh
./scripts/libdave_install.sh v1.1.0
```

`build.sh` already exports `CGO_CFLAGS`, `CGO_LDFLAGS`, and `PKG_CONFIG_PATH` pointing at `$HOME/.local`, and the linker adds an `rpath` to that same directory so the produced binary keeps working without any global LD_LIBRARY_PATH gymnastics.

#### Building Echo

```sh
./build.sh
```

That script:

1. Runs `bun install` (if `node_modules` is missing) and `bun run build` inside `web/frontend/`, producing `web/frontend/dist/`.
2. Builds the Go binary, embedding the `dist/` folder via `//go:embed` and linking against the system libopus plus the user-local libdave.

For local frontend iteration you can run `bun run dev` inside `web/frontend/` (Vite dev server on `:5173`); the dev server proxies `/ws`, `/clip`, `/status`, `/join`, and `/leave` to the Go backend running on `:8080`.

### Directory structure (target state)

```
Echo/
  main.go
  go.mod
  go.sum
  .env
  utils/
    discord.go
  voice/
    conn.go
    buffer.go
    receiver.go        (new)
    mixer.go           (new)
  web/
    server.go          (new)
    hub.go             (new)
    embed.go           (new — //go:embed of frontend/dist)
    frontend/          (new — Bun + Vite + React + Tailwind)
      package.json
      vite.config.ts
      tsconfig.json
      index.html
      src/
        main.tsx
        Dashboard.tsx
        audio/
        net/
        record/
        components/
      dist/            (build output, embedded)
```
