package main

import (

	"bytes"
	"fmt"
	"log"
	"time"

	"sprout/echo/utils"
	"sprout/echo/voice"
	"sprout/echo/web"

	"github.com/disgoorg/disgo/bot"
	"github.com/disgoorg/disgo/discord"
	"github.com/disgoorg/disgo/events"
	"github.com/disgoorg/snowflake/v2"

)

// CommandConfig carries the two callbacks the command handlers need to drive the voice pipeline, and the base URL used to build dashboard links.
type CommandConfig struct {

	WebURL string

	Join func(guildID snowflake.ID, channelID snowflake.ID) (*voice.Connection, error)
	Leave func(guildID snowflake.ID) error

}

// RegisterCommands pushes the the global slash commands to Discord and wires an event listener that dispatches them.
func RegisterCommands(client *bot.Client, cfg CommandConfig) error {

	minSecs := 1
	maxSecs := 15

	_, err := client.Rest.SetGlobalCommands(client.ApplicationID, []discord.ApplicationCommandCreate{

		discord.SlashCommandCreate{

			Name: "connect",
			Description: "Join your voice channel and start listening",

		},

		discord.SlashCommandCreate{

			Name: "disconnect",
			Description: "Leave the current voice channel",

		},

		discord.SlashCommandCreate{

			Name: "clip",
			Description: "Upload a WAV clip of recent audio",

			Options: []discord.ApplicationCommandOption{

				discord.ApplicationCommandOptionInt{

					Name: "seconds",
					Description: "Duration in seconds (1–15)",
					Required: false,
					MinValue: &minSecs,
					MaxValue: &maxSecs,

				},

			},

		},

	})

	if err != nil {

		return fmt.Errorf("register commands: %w", err)

	}

	client.AddEventListeners(bot.NewListenerFunc(func(event *events.ApplicationCommandInteractionCreate) {

		guildID := event.GuildID()

		if guildID == nil {

			return // Commands should only work in guilds, so ignore DMs.

		}

		data := event.SlashCommandInteractionData()

		switch data.CommandName() {

		case "connect":

			handleConnect(event, *guildID, cfg)

		case "disconnect":

			handleDisconnect(event, *guildID, cfg)

		case "clip":

			handleClip(event, *guildID, cfg)

		}

	}))

	return nil

}

func handleConnect(event *events.ApplicationCommandInteractionCreate, guildID snowflake.ID, cfg CommandConfig) {

	userID := event.User().ID

	voiceState, ok := utils.DiscordInstance.GetVoiceState(guildID, userID)

	if !ok {

		_ = event.CreateMessage(discord.MessageCreate{

			Content: "You need to be in a voice channel first.",
			Flags: discord.MessageFlagEphemeral,

		})

		return

	}

	channelID := *voiceState.ChannelID

	if err := event.DeferCreateMessage(false); err != nil {

		log.Printf("commands: defer failed: %v", err)

		return

	}

	go func() {

		if _, err := cfg.Join(guildID, channelID); err != nil {

			log.Printf("commands: join failed guild=%s channel=%s: %v", guildID, channelID, err)

			_, _ = event.Client().Rest.UpdateInteractionResponse(

				event.Client().ApplicationID,
				event.Token(),

				discord.MessageUpdate{

					Content: ptr(fmt.Sprintf("Couldn't join: %v", err)),

				},

			)

			return

		}

		dashURL := fmt.Sprintf("%s/?guildID=%s", cfg.WebURL, guildID)

		_, _ = event.Client().Rest.UpdateInteractionResponse(

			event.Client().ApplicationID,
			event.Token(),

			discord.MessageUpdate{

				Content: ptr(fmt.Sprintf("Joined <#%s> — [Open Dashboard](%s)", channelID, dashURL)),

			},

		)

	}()

}

func handleDisconnect(event *events.ApplicationCommandInteractionCreate, guildID snowflake.ID, cfg CommandConfig) {

	if err := event.DeferCreateMessage(true); err != nil {

		log.Printf("commands: defer failed: %v", err)

		return

	}

	go func() {

		if err := cfg.Leave(guildID); err != nil {

			log.Printf("commands: leave failed guild=%s: %v", guildID, err)

			_, _ = event.Client().Rest.UpdateInteractionResponse(

				event.Client().ApplicationID,
				event.Token(),

				discord.MessageUpdate{

					Content: ptr(fmt.Sprintf("Couldn't disconnect: %v", err)),

				},

			)

			return

		}

		_, _ = event.Client().Rest.UpdateInteractionResponse(

			event.Client().ApplicationID,
			event.Token(),

			discord.MessageUpdate{

				Content: ptr("Disconnected."),

			},

		)

	}()

}

func handleClip(event *events.ApplicationCommandInteractionCreate, guildID snowflake.ID, cfg CommandConfig) {

	seconds := 15.0 // default

	data := event.SlashCommandInteractionData()

	if s, ok := data.OptInt("seconds"); ok {

		seconds = float64(s)

	}

	conn, ok := voice.GetConnection(guildID)

	if !ok {

		_ = event.CreateMessage(discord.MessageCreate{

			Content: "Not currently in a voice channel.",
			Flags: discord.MessageFlagEphemeral,

		})

		return

	}

	pcm := conn.Buffer.GetLastN(seconds)

	if len(pcm) == 0 {

		_ = event.CreateMessage(discord.MessageCreate{

			Content: "Buffer is empty — no audio to clip yet.",
			Flags: discord.MessageFlagEphemeral,

		})

		return

	}

	// Defers the response so Discord doesn't time out while we encode and upload the WAV.

	if err := event.DeferCreateMessage(false); err != nil {

		log.Printf("commands: defer failed: %v", err)

		return

	}

	go func() {

		wavBytes, err := web.EncodeWAV(pcm)

		if err != nil {

			log.Printf("commands: wav encode failed: %v", err)

			_, _ = event.Client().Rest.UpdateInteractionResponse(

				event.Client().ApplicationID,
				event.Token(),

				discord.MessageUpdate{

					Content: ptr(fmt.Sprintf("WAV encoding failed: %v", err)),

				},

			)

			return

		}

		filename := fmt.Sprintf("clip-%ds-%s.wav", int(seconds), time.Now().Format("15-04-05"))

		_, err = event.Client().Rest.UpdateInteractionResponse(

			event.Client().ApplicationID,
			event.Token(),

			discord.MessageUpdate{

				Files: []*discord.File{

					discord.NewFile(filename, "Echo voice clip", bytes.NewReader(wavBytes)),

				},

			},

		)

		if err != nil {

			log.Printf("commands: clip upload failed: %v", err)

		}

	}()

}

// ptr returns a pointer to v. Small utility used to satisfy discord.MessageUpdate fields that require *string.
func ptr[T any](v T) *T {

	return &v

}
