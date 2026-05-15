package web

import (
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const clientSendDepth = 5 // clientSendDepth controls per-client buffering: 5 frames ~= 100 ms of audio.
const writeTimeout = 5 * time.Second // writeTimeout caps how long a single WebSocket write may block.

// Client represents one connected dashboard.
type Client struct {

	hub *Hub

	conn *websocket.Conn

	send chan []byte

}

// Hub is the central WebSocket send-out point. The audio pipeline pushes 20 ms mixed PCM frames into Broadcast.
type Hub struct {

	register chan *Client
	unregister chan *Client
	broadcast chan []byte

	mu sync.RWMutex

	clients map[*Client]struct{}

	stop chan struct{}

}

func NewHub() *Hub {

	return &Hub{

		register:   make(chan *Client, 4),
		unregister: make(chan *Client, 4),

		broadcast: make(chan []byte, 32), // 32 frame backlog (~640 ms) absorbs short stalls

		clients: make(map[*Client]struct{}),

		stop: make(chan struct{}),

	}

}

// Run is the Hub's event loop.
func (h *Hub) Run() {

	for {

		select {

		case <-h.stop:

			return

		case client := <-h.register:

			h.mu.Lock()
			h.clients[client] = struct{}{}
			h.mu.Unlock()

			log.Printf("web: client registered (%d total)", h.ListenerCount())

		case client := <-h.unregister:

			h.mu.Lock()

			if _, ok := h.clients[client]; ok {

				delete(h.clients, client)
				close(client.send)

			}

			h.mu.Unlock()

			log.Printf("web: client unregistered (%d total)", h.ListenerCount())

		case frame := <-h.broadcast:

			h.mu.RLock()

			for client := range h.clients {

				// Non-blocking send

				select {

					case client.send <- frame:

					default:

						// No-Op; the client's writeLoop will detect the stalled send and clean up the client.

				}

			}

			h.mu.RUnlock()

		}

	}

}

// Broadcast hands a freshly-mixed PCM frame to the Hub.
func (h *Hub) Broadcast(frame []byte) {

	select {

		case h.broadcast <- frame:

		default:

			// Hub's 32-frame backlog is full. Should not really happen.

	}

}

// ListenerCount reports the current number of connected dashboard clients.
func (h *Hub) ListenerCount() int {

	h.mu.RLock()
	defer h.mu.RUnlock()

	return len(h.clients)

}

// Stop tears down the hub. Existing clients will be cleaned up as their writeLoops fail.
func (h *Hub) Stop() {

	select {

		case <-h.stop:

			return

		default:

			close(h.stop)

		}

}

// writeLoop drains a client's send channel onto the WebSocket connection.
func (c *Client) writeLoop() {

	defer func() {

		_ = c.conn.Close()

	}()

	for frame := range c.send {

		_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))

		if err := c.conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {

			log.Printf("web: websocket write failed: %v", err)

			c.hub.unregister <- c

			return

		}

	}

}

// readLoop drains and discards anything the browser sends so the connection stays alive.
func (c *Client) readLoop() {

	defer func() {

		c.hub.unregister <- c
		_ = c.conn.Close()

	}()

	c.conn.SetReadLimit(512)

	for {

		if _, _, err := c.conn.NextReader(); err != nil {

			return

		}

	}

}
