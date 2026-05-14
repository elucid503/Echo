package utils

import (
	"context"
	"time"

	"github.com/disgoorg/disgo/bot"
)

var DiscordInstance *Discord

type Discord struct {

	discordClient *bot.Client

}

func NewDiscord(client bot.Client) *Discord {

	DiscordInstance := &Discord{

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

func (d *Discord) Disconnect() error {

	context, cancel := context.WithDeadline(context.Background(), time.Now().Add(10 * time.Second))

	d.discordClient.Close(context)

	defer cancel()

	return nil

}
