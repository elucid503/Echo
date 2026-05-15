package voice

import (
	"context"
	"sprout/echo/utils"
	"sync"
	"time"

	dvoice "github.com/disgoorg/disgo/voice"
	"github.com/disgoorg/snowflake/v2"
)

var (

	activeConnections = make(map[snowflake.ID]*Connection)
	activeConnectionsMu sync.RWMutex

)

// Connection owns one Discord voice session and all of the audio-pipeline pieces scoped to it.
type Connection struct {

	guildID   snowflake.ID
	channelID snowflake.ID

	voiceConnection dvoice.Conn

	Receiver *Receiver
	Mixer *Mixer
	Buffer *Buffer

}

// NewConnection allocates the pipeline pieces for a new guild and registers it in activeConnections. The pipeline does not start until Connect runs.
func NewConnection(guildID snowflake.ID, channelID snowflake.ID, broadcaster Broadcaster) *Connection {

	buffer := NewBuffer()
	receiver := NewReceiver()

	connection := &Connection{

		guildID: guildID,
		channelID: channelID,

		Receiver: receiver,
		Buffer: buffer,
		Mixer: NewMixer(receiver, buffer, broadcaster),

	}

	activeConnectionsMu.Lock()
	activeConnections[guildID] = connection
	activeConnectionsMu.Unlock()

	return connection

}

// GetConnection returns the active pipeline for a guild, if any.
func GetConnection(guildID snowflake.ID) (*Connection, bool) {

	activeConnectionsMu.RLock()
	defer activeConnectionsMu.RUnlock()

	connection, exists := activeConnections[guildID]

	return connection, exists

}

// RemoveConnection drops the pipeline from the registry. Disconnect must be called separately!
func RemoveConnection(guildID snowflake.ID) {

	activeConnectionsMu.Lock()
	defer activeConnectionsMu.Unlock()

	delete(activeConnections, guildID)

}

// Getters

func (c *Connection) GuildID() snowflake.ID { return c.guildID }
func (c *Connection) ChannelID() snowflake.ID { return c.channelID }

// Connect opens the underlying Discord voice connection, wires the Receiver into disgo's audio receive path, then starts the Mixer goroutines.
func (c *Connection) Connect() (dvoice.Conn, error) {

	voiceConn := utils.DiscordInstance.GetClient().VoiceManager.CreateConn(c.guildID)

	openContext, cancel := context.WithDeadline(context.Background(), time.Now().Add(10*time.Second))

	defer cancel()

	err := voiceConn.Open(openContext, c.channelID, true, false) // selfMute = true, selfDeaf = false

	if err != nil {

		return nil, err

	}

	c.voiceConnection = voiceConn

	voiceConn.SetOpusFrameReceiver(c.Receiver)

	c.Mixer.Start()

	return c.voiceConnection, nil

}

// Disconnect tears down the pipeline in the opposite order it was built.
func (c *Connection) Disconnect() error {

	if c.Mixer != nil {

		c.Mixer.Stop()

	}

	if c.voiceConnection != nil {

		closeContext, cancel := context.WithDeadline(context.Background(), time.Now().Add(10*time.Second))

		defer cancel()

		c.voiceConnection.Close(closeContext)

	}

	if c.Receiver != nil {

		c.Receiver.Close()

	}

	RemoveConnection(c.guildID)

	return nil

}
