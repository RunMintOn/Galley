package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const nodeInstallHelp = "Install or update Node.js 22.19.0 or newer:\nhttps://nodejs.org/en/download\nWith Homebrew, run brew install node; if installed, run brew upgrade node."
const nodeLocationHelp = "Installed but not found: run command -v node in a terminal to get the executable path, then set REVIEW_CONSOLE_NODE.\nFor Finder launches, run the following in a terminal with the real path, then reopen the app:\nlaunchctl setenv REVIEW_CONSOLE_NODE \"/absolute/path/to/node\""

func findNode(args []string) (string, *startupFailure) {
	explicit := os.Getenv("REVIEW_CONSOLE_NODE")
	source := "REVIEW_CONSOLE_NODE"
	if explicit == "" {
		for _, arg := range args {
			if path, ok := strings.CutPrefix(arg, "--node="); ok {
				explicit = path
				source = "--node"
				break
			}
		}
	}
	var candidates []string
	if path, err := exec.LookPath("node"); err == nil {
		candidates = append(candidates, path)
	}
	candidates = append(candidates, "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node")
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(home, ".local/share/pi-node/current/bin/node"),
			filepath.Join(home, ".volta/bin/node"),
		)
		for _, pattern := range []string{
			".nvm/versions/node/*/bin/node",
			".local/share/fnm/node-versions/*/installation/bin/node",
			"Library/Application Support/fnm/node-versions/*/installation/bin/node",
			".fnm/node-versions/*/installation/bin/node",
		} {
			paths, _ := filepath.Glob(filepath.Join(home, pattern))
			candidates = append(candidates, paths...)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	path, failure := resolveNode(ctx, explicit, candidates, nodeFromShell)
	if failure != nil && explicit != "" {
		recovery := "Fix or remove the --node argument and reopen the app. When launched from pi, update the Node used by pi and restart pi."
		if source == "REVIEW_CONSOLE_NODE" {
			recovery = "Fix this path, or unset the pinned location so the app can search automatically.\nTerminal: unset REVIEW_CONSOLE_NODE\nFinder: launchctl unsetenv REVIEW_CONSOLE_NODE\nThen reopen the app."
		}
		failure.detail = "Configured by: " + source + "\n" + failure.detail + "\n\n" + recovery + "\n\n" + nodeInstallHelp
	}
	return path, failure
}

func resolveNode(ctx context.Context, explicit string, candidates []string, shell func(context.Context) (string, error)) (string, *startupFailure) {
	if explicit != "" {
		if err := checkNode(ctx, explicit); err != nil {
			reason := err.Error()
			if os.IsNotExist(err) {
				reason = "Path does not exist"
			}
			return "", &startupFailure{
				message: "The specified Node.js cannot be used",
				detail:  explicit + "\n" + reason,
			}
		}
		return explicit, nil
	}
	var failures []string
	for _, path := range candidates {
		err := checkNode(ctx, path)
		if err == nil {
			return path, nil
		}
		if !os.IsNotExist(err) {
			failures = append(failures, path+"："+err.Error())
		}
		if ctx.Err() != nil {
			break
		}
	}
	unusable := len(failures) > 0
	path, err := shell(ctx)
	if err == nil {
		if err = checkNode(ctx, path); err == nil {
			return path, nil
		}
		unusable = unusable || !os.IsNotExist(err)
	}
	failures = append(failures, "Login shell: "+err.Error())
	message := "Node.js 22.19.0 or newer was not found"
	detail := "Not installed:\n" + nodeInstallHelp + "\n\n" + nodeLocationHelp
	if unusable {
		message = "The Node.js found cannot be used"
		detail = failures[0] + "\n\n" + nodeInstallHelp
	}
	return "", &startupFailure{
		message:    message,
		detail:     detail,
		diagnostic: "Checked PATH, Homebrew, pi, Volta, nvm, fnm, and the login shell.\n" + strings.Join(failures, "\n"),
	}
}

func checkNode(ctx context.Context, path string) error {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	cmd.WaitDelay = 100 * time.Millisecond
	output, err := cmd.Output()
	if ctx.Err() != nil {
		return fmt.Errorf("Version probe timed out")
	}
	if err != nil {
		return err
	}
	version := strings.TrimSpace(string(output))
	parts := strings.Split(strings.TrimPrefix(version, "v"), ".")
	if len(parts) != 3 {
		return fmt.Errorf("Unrecognized version: %q; Node.js 22.19.0 or newer is required", version)
	}
	var numbers [3]int
	for i, part := range parts {
		numbers[i], err = strconv.Atoi(part)
		if err != nil {
			return fmt.Errorf("Unrecognized version: %q; Node.js 22.19.0 or newer is required", version)
		}
	}
	if numbers[0] < 22 || (numbers[0] == 22 && numbers[1] < 19) {
		return fmt.Errorf("Version %s is too old; Node.js 22.19.0 or newer is required", version)
	}
	return nil
}

func nodeFromShell(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/bin/zsh", "-lic", "command -v node")
	// Shell startup may leave children holding output pipes after a timeout.
	cmd.WaitDelay = 100 * time.Millisecond
	output, err := cmd.Output()
	if ctx.Err() != nil {
		return "", fmt.Errorf("Lookup timed out")
	}
	if err != nil {
		return "", err
	}
	// Shell startup messages can precede command -v's result.
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	return strings.TrimSpace(lines[len(lines)-1]), nil
}
