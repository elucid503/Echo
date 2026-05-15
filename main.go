package main

import (

	"log"
	"os"

	"sprout/echo/utils"
	"sprout/echo/voice"
	"sprout/echo/web"

	"github.com/disgoorg/disgo"
	"github.com/disgoorg/disgo/bot"
	"github.com/disgoorg/disgo/gateway"
	dvoice "github.com/disgoorg/disgo/voice"
	"github.com/disgoorg/godave/golibdave"
	"github.com/disgoorg/snowflake/v2"
	"github.com/joho/godotenv"

)

func main() {

	if err := godotenv.Load(); err != nil {

		log.Printf("info: no .env file loaded: %v", err)

	}

	token := os.Getenv("TOKEN")

	if token == "" {

		log.Fatal("TOKEN environment variable is required")

	}

	// Note: IntentGuildVoiceStates is required for voice gateway events and for the cache to track which channel each user is in.

	client, err := disgo.New(token,

		bot.WithGatewayConfigOpts(gateway.WithIntents(gateway.IntentGuildVoiceStates)),

		bot.WithVoiceManagerConfigOpts(dvoice.WithDaveSessionCreateFunc(golibdave.NewSession)),

	)

	if err != nil {

		log.Fatal("Error creating client: ", err)

	}

	discord := utils.NewDiscord(*client)

	if err = discord.Connect(); err != nil {

		log.Fatal("Error connecting to Discord: ", err)

	}

	hubs := web.NewHubManager()

	server := web.NewServer(hubs, web.FrontendFS())

	join := func(guildID snowflake.ID, channelID snowflake.ID) (*voice.Connection, error) {

		if existing, ok := voice.GetConnection(guildID); ok {

			_ = existing.Disconnect()

		}

		connection := voice.NewConnection(guildID, channelID, server.HubFor(guildID))

		if _, err := connection.Connect(); err != nil {

			_ = connection.Disconnect()

			return nil, err

		}

		return connection, nil

	}

	leave := func(guildID snowflake.ID) error {

		connection, ok := voice.GetConnection(guildID)

		if !ok {

			return nil

		}

		return connection.Disconnect()

	}

	server.Join = join
	server.Leave = leave

	webURL := os.Getenv("WEB_URL")

	if webURL == "" {

		webURL = "http://localhost:8080"

	}

	if err := RegisterCommands(client, CommandConfig{

		WebURL: webURL,
		Join:   join,
		Leave:  leave,

	}); err != nil {

		log.Printf("warning: slash command registration failed: %v", err)

	}

	port := os.Getenv("WEB_PORT")

	if port == "" {

		port = "8080"

	}

	log.Println("Echo bot is now running. Press CTRL-C to exit.")

	if err := server.ListenAndServe(":" + port); err != nil {

		log.Fatal("web server exited: ", err)

	}

}
