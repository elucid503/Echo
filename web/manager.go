package web

import (
	"sync"

	"github.com/disgoorg/snowflake/v2"
)

// HubManager creates and tracks one Hub per Discord guild.
type HubManager struct {

	mu sync.RWMutex
	hubs map[snowflake.ID]*Hub

}

func NewHubManager() *HubManager {

	return &HubManager{hubs: make(map[snowflake.ID]*Hub)}

}

// Get returns the Hub for a guild without creating one.
func (m *HubManager) Get(guildID snowflake.ID) (*Hub, bool) {

	m.mu.RLock()
	defer m.mu.RUnlock()

	h, ok := m.hubs[guildID]

	return h, ok

}

// GetOrCreate returns the existing Hub for a guild, or creates and starts a new one if none exists yet.
func (m *HubManager) GetOrCreate(guildID snowflake.ID) *Hub {

	m.mu.Lock()
	defer m.mu.Unlock()

	if h, ok := m.hubs[guildID]; ok {

		return h

	}

	h := NewHub()
	go h.Run()

	m.hubs[guildID] = h

	return h

}
