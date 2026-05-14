package voice

import (
	"context"
	"sprout/echo/utils"
	"time"

	"github.com/disgoorg/disgo/voice"
	"github.com/disgoorg/snowflake/v2"
)

var activeConnections = make(map[snowflake.ID]*Connection) // map of guildIDs to connections

type Connection struct {

	guildID snowflake.ID
	channelID snowflake.ID

	voiceConnection *voice.Conn

}

func NewConnection(guildID snowflake.ID, channelID snowflake.ID) *Connection {

	connection := &Connection{

		guildID: guildID,
		channelID: channelID,

	}

	activeConnections[guildID] = connection

	return connection

}

func GetConnection(guildID snowflake.ID) (*Connection, bool) {

	connection, exists := activeConnections[guildID]

	return connection, exists

}

func RemoveConnection(guildID snowflake.ID) {

	delete(activeConnections, guildID)

}

func (c *Connection) Connect() (*voice.Conn, error) {

	voiceConn := utils.DiscordInstance.GetClient().VoiceManager.CreateConn(c.guildID)

	openContext, cancel := context.WithDeadline(context.Background(), time.Now().Add(10 * time.Second))

	defer cancel()

	err := voiceConn.Open(openContext, c.channelID, true, false)

	if err != nil {

		return nil, err

	}

	c.voiceConnection = &voiceConn

	return c.voiceConnection, nil

}

func (c *Connection) Disconnect() error {

	if c.voiceConnection == nil {

		return nil

	}

	closeContext, cancel := context.WithDeadline(context.Background(), time.Now().Add(10 * time.Second))

	defer cancel()

	(*c.voiceConnection).Close(closeContext)

	return nil

}
