package main

import (
	"log"
	"strings"

	"github.com/egoist/mygo"
)

type startupFailure struct {
	message    string
	detail     string
	diagnostic string
}

func (failure *startupFailure) Error() string {
	return strings.TrimSpace(failure.message + "\n\n" + failure.detail + "\n\n" + failure.diagnostic)
}

func startupError(failure *startupFailure) {
	log.Print(failure.Error())
	mygo.App.WhenReady(func() {
		go func() {
			result, _ := mygo.Dialog.Message(mygo.MessageOptions{
				Type: mygo.MessageError, Title: "Galley",
				Message: failure.message, Detail: failure.detail,
				Buttons: []string{"Quit", "Copy Details and Quit"},
			})
			if result.Button == 1 {
				mygo.Clipboard.WriteText(failure.Error())
			}
			mygo.App.Exit(1)
		}()
	})
	if err := mygo.App.Run(); err != nil {
		log.Print(err)
	}
}
