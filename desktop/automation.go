//go:build e2e

package main

import (
	_ "github.com/egoist/mygo/plugins/automation"
	"os"
)

func init() { testMode = os.Getenv("REVIEW_CONSOLE_DESKTOP_TEST") == "1" }
