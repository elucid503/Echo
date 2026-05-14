package main

import (
	"log"
	"os"

	"sprout/echo/utils"

	"github.com/disgoorg/disgo"
	"github.com/joho/godotenv"
)

func main() {

	err := godotenv.Load()

	if err != nil {

		log.Fatal("Error loading .env file")

	}

	client, err := disgo.New(os.Getenv("TOKEN"))

	if err != nil {

		log.Fatal("Error creating client: ", err)

	}

	discord := utils.NewDiscord(*client)

	err = discord.Connect()

	if err != nil {

		log.Fatal("Error connecting to Discord: ", err)

	}

	log.Println("Bot is now running. Press CTRL-C to exit.")

	select {} // keeps the program running until it is terminated

}
