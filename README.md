# Echo

A Discord voice channel recording bot with a real-time dashboard.

## Overview

Echo is a Discord bot that joins voice channels and records audio in real-time. It captures all voices in the channel, mixes them together, and stores the audio in a circular buffer for on-demand playback and clipping. The bot includes a web dashboard that displays live audio visualization and allows users to download audio clips directly from Discord.

## Features

- **Real-time Voice Recording**: Automatically records all audio from Discord voice channels
- **Multi-Speaker Mixing**: Combines audio from multiple speakers into a unified stereo stream
- **Circular Audio Buffer**: Maintains the most recent 15 seconds of audio for quick clip extraction
- **Audio Clipping**: Download custom-length WAV files (1-15 seconds) of recent audio
- **Web Dashboard**: Real-time visualization of voice activity with WebSocket-powered updates
- **Discord Integration**: Simple slash commands (`/connect`, `/disconnect`, `/clip`) for bot control
- **Per-Guild Isolation**: Each Discord server has its own independent audio session

## Audio Pipeline

The Echo audio pipeline follows this flow:

1. **Opus Frame Reception**: Incoming Opus-encoded packets from Discord users are received with their source identifier (SSRC)
2. **Opus Decoding**: Frames are decoded from Opus format to PCM (Pulse Code Modulation)
3. **Frame Mixing**: PCM frames from multiple speakers are combined:
   - Frames are queued per speaker (SSRC)
   - Every 20ms, frames from all active speakers are mixed together
   - Audio is accumulated using 32-bit integer arithmetic to prevent clipping
   - Mixed samples are converted back to 16-bit stereo PCM
4. **Buffer Storage**: Mixed PCM is written to a circular buffer (15-second capacity at 48 kHz stereo)
5. **Real-time Broadcasting**: Mixed frames are broadcast to connected WebSocket clients for live dashboard visualization
6. **Clip Export**: On demand, segments of the circular buffer are extracted and encoded as WAV files

**Audio Specifications:**
- Sample Rate: 48 kHz
- Channels: 2 (Stereo)
- Bit Depth: 16-bit signed integer (int16)
- Frame Duration: 20 ms
- Buffer Capacity: 15 seconds

## Environment Configuration

Echo is configured via environment variables, which can be provided through a `.env` file or set directly in your shell.

**Required Variables:**
- `TOKEN`: Discord bot token (required). Obtain this from the [Discord Developer Portal](https://discord.com/developers/applications)

**Optional Variables:**
- `WEB_PORT`: HTTP port for the web server (default: `8080`)
- `WEB_URL`: Base URL for the dashboard (default: `http://localhost:8080`). Set this when running behind a proxy or on a non-localhost domain

**Example `.env` file:**
```env
TOKEN=your_discord_bot_token_here
WEB_PORT=8080
WEB_URL=http://localhost:8080
```

## Building the Project

### System Dependencies

Before building Echo, install the following system dependencies:

**Debian/Ubuntu:**
```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  pkg-config \
  libopus-dev
curl -fsSL https://bun.sh/install | bash
```

**macOS (Homebrew):**
```bash
brew install opus pkg-config
curl -fsSL https://bun.sh/install | bash
```

**Fedora/RHEL:**
```bash
sudo dnf install -y \
  gcc \
  pkg-config \
  opus-devel
curl -fsSL https://bun.sh/install | bash
```

### Build Steps

The project builds a React dashboard frontend and a Go binary backend. A build script is provided:

```bash
./build.sh
```

This script will:
1. Install frontend dependencies (if needed) using Bun
2. Build the React dashboard
3. Build the Go binary as `./echo`

**Troubleshooting:**
- If the build fails with libopus not found, ensure libopus-dev is installed and update `PKG_CONFIG_PATH` if libopus is installed in a non-standard location
- The build script uses `~/.local/lib` and `~/.local/include` by default; adjust `CGO_CFLAGS` and `CGO_LDFLAGS` in `build.sh` if your libopus is elsewhere

## Running

1. **Prepare environment variables:**
   ```bash
   export TOKEN="your_discord_bot_token"
   ```
   Or create a `.env` file in the project root.

2. **Start the bot:**
   ```bash
   ./echo
   ```

   The bot will:
   - Load the `.env` file (if present)
   - Connect to Discord
   - Start the web server (default: `http://localhost:8080`)
   - Listen for slash commands

3. **Access the dashboard:**
   - Open `http://localhost:8080` in your browser
   - The dashboard will prompt you to select a guild (Discord server)

## Commands

Echo provides three Discord slash commands:

### `/connect`
Joins your current voice channel and starts recording.
- **Usage:** Use this command while in a voice channel
- **Response:** Provides a link to the dashboard for the current guild
- **Error:** Returns an error if you're not in a voice channel

### `/disconnect`
Leaves the current voice channel and stops recording.
- **Usage:** Can be used from anywhere in the guild (no voice channel required)
- **Response:** Confirms disconnection
- **Error:** Returns an error if the bot isn't currently in a voice channel

### `/clip [seconds]`
Exports a WAV clip of recent audio to Discord.
- **Parameters:**
  - `seconds` (optional, 1-15): Duration of the clip in seconds (default: 15)
- **Usage:** Can be used from anywhere in the guild
- **Response:** Uploads a WAV file named `clip-{duration}s-{timestamp}.wav`
- **Error:** Returns an error if the buffer is empty or the bot isn't connected

---

## License

This project is released under the **Unlicense**. It is in the public domai. Feel free to use, modify, and distribute it for any purpose whatsoever.

For more information, see [The Unlicense](https://unlicense.org/).
