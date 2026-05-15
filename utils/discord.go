package utils

import (
	"context"
	"time"

	"github.com/disgoorg/disgo/bot"
	"github.com/disgoorg/disgo/discord"
	"github.com/disgoorg/snowflake/v2"
)

var DiscordInstance *Discord

type Discord struct {

	discordClient *bot.Client

}

func NewDiscord(client bot.Client) *Discord {

	DiscordInstance = &Discord{

		discordClient: &client,

	}

	return DiscordInstance

}

func (d *Discord) GetClient() *bot.Client {

	return d.discordClient

}

func (d *Discord) Connect() error {

	context, cancel := context.WithDeadline(context.Background(), time.Now().Add(10 * time.Second))

	d.discordClient.OpenGateway(context)

	defer cancel()

	return nil

}

func (d *Discord) GetVoiceState(guildID snowflake.ID, userID snowflake.ID) (*discord.VoiceState, bool) {

	voiceState, ok := d.discordClient.Caches.VoiceState(guildID, userID)

	if !ok || voiceState.ChannelID == nil {

		restVoiceState, err := d.discordClient.Rest.GetUserVoiceState(guildID, userID)

		if err != nil || restVoiceState == nil || restVoiceState.ChannelID == nil {

			return nil, false

		}

		return restVoiceState, true

	}

	return &voiceState, true

}

func (d *Discord) Disconnect() error {

	context, cancel := context.WithDeadline(context.Background(), time.Now().Add(10 * time.Second))

	d.discordClient.Close(context)

	defer cancel()

	return nil

}
