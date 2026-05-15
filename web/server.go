package web

import (

	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/disgoorg/snowflake/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-audio/audio"
	"github.com/go-audio/wav"
	"github.com/gorilla/websocket"

	"sprout/echo/voice"

)

// Server bundles the HTTP router, the per-guild WebSocket hubs, and lifecycle hooks for the voice pipeline.
type Server struct {

	router *gin.Engine

	hubs *HubManager

	upgrader websocket.Upgrader

	// Voice pipeline hooks

	Join func(guildID snowflake.ID, channelID snowflake.ID) (*voice.Connection, error)
	Leave func(guildID snowflake.ID) error

}

// HubFor returns the Hub for a guild, creating one if this is the first time it has been requested.
func (s *Server) HubFor(guildID snowflake.ID) *Hub {

	return s.hubs.GetOrCreate(guildID)

}

// NewServer constructs a Server with all the handlers wired up. The staticFS parameter should be the embedded React dist dir.
func NewServer(hubs *HubManager, staticFS fs.FS) *Server {

	gin.SetMode(gin.ReleaseMode)

	router := gin.New()

	router.Use(gin.Recovery())

	s := &Server{

		router: router,
		hubs:   hubs,

		upgrader: websocket.Upgrader{

			ReadBufferSize:  1024,
			WriteBufferSize: 4096,

			CheckOrigin: func(r *http.Request) bool { return true },

		},

	}

	s.routes(staticFS)

	return s

}

func (s *Server) routes(staticFS fs.FS) {

	s.router.GET("/ws", s.handleWebSocket)
	s.router.GET("/status", s.handleStatus)
	s.router.GET("/clip", s.handleClip)
	s.router.POST("/join", s.handleJoin)
	s.router.POST("/leave", s.handleLeave)

	s.mountFrontend(staticFS)

}

// mountFrontend wires up the embedded React dist directory. Asset files are served directly.
func (s *Server) mountFrontend(staticFS fs.FS) {

	if staticFS == nil {

		log.Printf("web: no embedded frontend bundle found — UI routes will 404")

		return

	}

	indexBytes, err := fs.ReadFile(staticFS, "index.html")

	if err != nil {

		log.Printf("web: embedded index.html missing: %v", err)

		return

	}

	serveFile := func(c *gin.Context, name string) {

		f, err := staticFS.Open(name)

		if err != nil {

			c.Status(http.StatusNotFound)

			return

		}

		defer f.Close()

		stat, err := f.Stat()

		if err != nil {

			c.Status(http.StatusInternalServerError)

			return

		}

		seeker, ok := f.(io.ReadSeeker)

		if !ok {

			data, err := io.ReadAll(f)

			if err != nil {

				c.Status(http.StatusInternalServerError)

				return

			}

			seeker = bytes.NewReader(data)

		}

		http.ServeContent(c.Writer, c.Request, name, stat.ModTime(), seeker)

	}

	s.router.GET("/", func(c *gin.Context) {

		c.Data(http.StatusOK, "text/html; charset=utf-8", indexBytes)

	})

	s.router.NoRoute(func(c *gin.Context) {

		if c.Request.Method != http.MethodGet {

			c.Status(http.StatusNotFound)

			return

		}

		requested := c.Request.URL.Path

		if len(requested) > 0 && requested[0] == '/' {

			requested = requested[1:]

		}

		if requested == "" {

			c.Data(http.StatusOK, "text/html; charset=utf-8", indexBytes)

			return

		}

		if _, err := fs.Stat(staticFS, requested); err == nil {

			serveFile(c, requested)

			return

		}

		c.Data(http.StatusOK, "text/html; charset=utf-8", indexBytes)

	})

}

// ListenAndServe starts the HTTP server on the given address.
func (s *Server) ListenAndServe(addr string) error {

	log.Printf("web: listening on %s", addr)

	return s.router.Run(addr)

}

// handleWebSocket upgrades the connection and routes it to the hub for the guild specified by the ?guildID query parameter.
func (s *Server) handleWebSocket(c *gin.Context) {

	rawID := c.Query("guildID")

	if rawID == "" {

		c.JSON(http.StatusBadRequest, gin.H{"error": "guildID query parameter required"})

		return

	}

	guildID, err := snowflake.Parse(rawID)

	if err != nil {

		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid guildID"})

		return

	}

	conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)

	if err != nil {

		log.Printf("web: websocket upgrade failed: %v", err)

		return

	}

	hub := s.hubs.GetOrCreate(guildID)

	client := &Client{

		hub:  hub,
		conn: conn,
		send: make(chan []byte, clientSendDepth),

	}

	hub.register <- client

	go client.writeLoop()
	go client.readLoop()

}

type statusResponse struct {

	Connected     bool   `json:"connected"`
	GuildID       string `json:"guildID,omitempty"`
	ChannelID     string `json:"channelID,omitempty"`
	Listeners     int    `json:"listeners"`
	Speakers      int    `json:"speakers"`
	BufferSeconds int    `json:"bufferSeconds"`
	SampleRate    int    `json:"sampleRate"`
	Channels      int    `json:"channels"`
	ServerTime    int64  `json:"serverTime"`

}

// Controller for the /status endpoint.
func (s *Server) handleStatus(c *gin.Context) {

	resp := statusResponse{

		Connected:     false,
		BufferSeconds: voice.BufferSeconds,
		SampleRate:    voice.SampleRate,
		Channels:      voice.Channels,
		ServerTime:    time.Now().UnixMilli(),

	}

	rawID := c.Query("guildID")

	if rawID != "" {

		guildID, err := snowflake.Parse(rawID)

		if err == nil {

			// Count listeners from the hub (may exist even without a voice connection).

			if hub, ok := s.hubs.Get(guildID); ok {

				resp.Listeners = hub.ListenerCount()

			}

			if connection, ok := voice.GetConnection(guildID); ok {

				resp.Connected = true
				resp.GuildID = connection.GuildID().String()
				resp.ChannelID = connection.ChannelID().String()
				resp.Speakers = connection.Receiver.SpeakerCount()

			}

		}

	}

	c.JSON(http.StatusOK, resp)

}

// Controller for the /clip endpoint.
func (s *Server) handleClip(c *gin.Context) {

	seconds := 15.0

	if raw := c.Query("seconds"); raw != "" {

		parsed, err := strconv.ParseFloat(raw, 64)

		if err != nil || parsed <= 0 || parsed > voice.BufferSeconds {

			c.JSON(http.StatusBadRequest, gin.H{

				"error": fmt.Sprintf("seconds must be a number between 0 and %d", voice.BufferSeconds),

			})

			return

		}

		seconds = parsed

	}

	rawID := c.Query("guildID")

	if rawID == "" {

		c.JSON(http.StatusBadRequest, gin.H{"error": "guildID query parameter required"})

		return

	}

	guildID, err := snowflake.Parse(rawID)

	if err != nil {

		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid guildID"})

		return

	}

	connection, ok := voice.GetConnection(guildID)

	if !ok {

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no active voice connection for this guild"})

		return

	}

	pcm := connection.Buffer.GetLastN(seconds)

	if len(pcm) == 0 {

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "buffer is empty"})

		return

	}

	wavBytes, err := EncodeWAV(pcm)

	if err != nil {

		log.Printf("web: wav encode failed: %v", err)

		c.JSON(http.StatusInternalServerError, gin.H{"error": "wav encoding failed"})

		return

	}

	filename := fmt.Sprintf("echo-clip-%dms.wav", int(seconds*1000))

	c.Writer.Header().Set("Content-Type", "audio/wav")
	c.Writer.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.Writer.Header().Set("Cache-Control", "no-store")

	c.Data(http.StatusOK, "audio/wav", wavBytes)

}

type joinRequest struct {

	GuildID   string `json:"guildID"`
	ChannelID string `json:"channelID"`

}

// Controller for the /join endpoint.
func (s *Server) handleJoin(c *gin.Context) {

	if s.Join == nil {

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "join not wired"})

		return

	}

	var req joinRequest

	if err := c.BindJSON(&req); err != nil {

		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})

		return

	}

	guildID, err := snowflake.Parse(req.GuildID)

	if err != nil {

		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid guildID"})

		return

	}

	channelID, err := snowflake.Parse(req.ChannelID)

	if err != nil {

		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid channelID"})

		return

	}

	if _, err := s.Join(guildID, channelID); err != nil {

		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})

		return

	}

	c.JSON(http.StatusOK, gin.H{"ok": true})

}

type leaveRequest struct {

	GuildID string `json:"guildID"`

}

// Controller for the /leave endpoint.
func (s *Server) handleLeave(c *gin.Context) {

	if s.Leave == nil {

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "leave not wired"})

		return

	}

	var req leaveRequest

	if err := c.BindJSON(&req); err != nil {

		if !errors.Is(err, io.EOF) {

			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})

			return

		}

	}

	if req.GuildID == "" {

		c.JSON(http.StatusBadRequest, gin.H{"error": "guildID required"})

		return

	}

	guildID, err := snowflake.Parse(req.GuildID)

	if err != nil {

		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid guildID"})

		return

	}

	if err := s.Leave(guildID); err != nil {

		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})

		return

	}

	c.JSON(http.StatusOK, gin.H{"ok": true})

}

// EncodeWAV wraps raw int16 little-endian stereo PCM bytes in a WAV container.
func EncodeWAV(pcm []byte) ([]byte, error) {

	sampleCount := len(pcm) / voice.BytesPerSample

	intBuffer := &audio.IntBuffer{

		Format: &audio.Format{

			NumChannels: voice.Channels,
			SampleRate:  voice.SampleRate,

		},

		Data:           make([]int, sampleCount),
		SourceBitDepth: 16,

	}

	for i := 0; i < sampleCount; i++ {

		lo := int16(uint16(pcm[i*2]) | uint16(pcm[i*2+1])<<8)
		intBuffer.Data[i] = int(lo)

	}

	seekable := newSeekableBuffer()

	encoder := wav.NewEncoder(seekable, voice.SampleRate, 16, voice.Channels, 1)

	if err := encoder.Write(intBuffer); err != nil {

		return nil, fmt.Errorf("wav write: %w", err)

	}

	if err := encoder.Close(); err != nil {

		return nil, fmt.Errorf("wav close: %w", err)

	}

	return seekable.Bytes(), nil

}

// seekableBuffer is a tiny io.WriteSeeker over a growable byte slice.
type seekableBuffer struct {

	buf []byte
	pos int64

}

func newSeekableBuffer() *seekableBuffer { return &seekableBuffer{} }

func (s *seekableBuffer) Write(p []byte) (int, error) {

	end := int(s.pos) + len(p)

	if end > len(s.buf) {

		extra := make([]byte, end-len(s.buf))
		s.buf = append(s.buf, extra...)

	}

	n := copy(s.buf[s.pos:], p)

	s.pos += int64(n)

	return n, nil

}

func (s *seekableBuffer) Seek(offset int64, whence int) (int64, error) {

	var abs int64

	switch whence {

		case io.SeekStart:

			abs = offset

		case io.SeekCurrent:

			abs = s.pos + offset

		case io.SeekEnd:

			abs = int64(len(s.buf)) + offset

		default:

			return 0, fmt.Errorf("seekableBuffer: invalid whence %d", whence)

	}

	if abs < 0 {

		return 0, fmt.Errorf("seekableBuffer: negative position")

	}

	s.pos = abs

	return abs, nil

}

func (s *seekableBuffer) Bytes() []byte { return s.buf }
