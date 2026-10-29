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

const nodeInstallHelp = "安装或更新 Node.js 22.19.0 或更高版本：\nhttps://nodejs.org/zh-cn/download\n已有 Homebrew 可运行 brew install node；已安装时用 brew upgrade node。"
const nodeLocationHelp = "已经安装但未找到：在终端运行 command -v node 获取可执行文件的路径，再设置 REVIEW_CONSOLE_NODE。\nFinder 启动可在终端运行以下命令，将示例路径替换为实际路径后重新打开应用：\nlaunchctl setenv REVIEW_CONSOLE_NODE \"/absolute/path/to/node\""

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
		recovery := "请修正或移除 --node 参数后重新打开应用；从 pi 启动时，请更新 pi 使用的 Node 并重启 pi。"
		if source == "REVIEW_CONSOLE_NODE" {
			recovery = "可修正此路径，或取消固定位置，让应用自动查找。\n终端启动：unset REVIEW_CONSOLE_NODE\nFinder 启动：launchctl unsetenv REVIEW_CONSOLE_NODE\n然后重新打开应用。"
		}
		failure.detail = "配置来源：" + source + "\n" + failure.detail + "\n\n" + recovery + "\n\n" + nodeInstallHelp
	}
	return path, failure
}

func resolveNode(ctx context.Context, explicit string, candidates []string, shell func(context.Context) (string, error)) (string, *startupFailure) {
	if explicit != "" {
		if err := checkNode(ctx, explicit); err != nil {
			reason := err.Error()
			if os.IsNotExist(err) {
				reason = "路径不存在"
			}
			return "", &startupFailure{
				message: "指定的 Node.js 无法使用",
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
	failures = append(failures, "登录 shell："+err.Error())
	message := "未找到 Node.js 22.19.0 或更高版本"
	detail := "尚未安装：\n" + nodeInstallHelp + "\n\n" + nodeLocationHelp
	if unusable {
		message = "找到的 Node.js 无法使用"
		detail = failures[0] + "\n\n" + nodeInstallHelp
	}
	return "", &startupFailure{
		message:    message,
		detail:     detail,
		diagnostic: "已检查 PATH、Homebrew、pi、Volta、nvm、fnm 和登录 shell。\n" + strings.Join(failures, "\n"),
	}
}

func checkNode(ctx context.Context, path string) error {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	cmd.WaitDelay = 100 * time.Millisecond
	output, err := cmd.Output()
	if ctx.Err() != nil {
		return fmt.Errorf("版本探测超时")
	}
	if err != nil {
		return err
	}
	version := strings.TrimSpace(string(output))
	parts := strings.Split(strings.TrimPrefix(version, "v"), ".")
	if len(parts) != 3 {
		return fmt.Errorf("无法识别版本：%q；需要 Node.js 22.19.0 或更高版本", version)
	}
	var numbers [3]int
	for i, part := range parts {
		numbers[i], err = strconv.Atoi(part)
		if err != nil {
			return fmt.Errorf("无法识别版本：%q；需要 Node.js 22.19.0 或更高版本", version)
		}
	}
	if numbers[0] < 22 || (numbers[0] == 22 && numbers[1] < 19) {
		return fmt.Errorf("版本 %s 过旧；需要 Node.js 22.19.0 或更高版本", version)
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
		return "", fmt.Errorf("查找超时")
	}
	if err != nil {
		return "", err
	}
	// Shell startup messages can precede command -v's result.
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	return strings.TrimSpace(lines[len(lines)-1]), nil
}
