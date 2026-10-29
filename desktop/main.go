package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

type serviceInfo struct {
	Origin string `json:"origin"`
	Token  string `json:"token"`
}
type Desktop struct{}

// PickFolder opens the system folder chooser so adding a project never asks the
// reader to type an absolute path by hand.
func (Desktop) PickFolder(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: "选择项目目录", ButtonLabel: "添加", Directory: true, Parent: mygo.CallerWindow(ctx)})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

var service serviceInfo
var review, scratch *mygo.Window
var webSession *mygo.Session
var quitting, quitPending, testMode bool
var closing = map[int]bool{}

func (Desktop) OpenScratch(ctx context.Context) {
	if mygo.CallerWindow(ctx) == nil {
		return
	}
	mygo.RunOnMain(openScratch)
}

func eval(w *mygo.Window, script string) (any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	return w.Page().EvalContext(ctx, script)
}
func command(w *mygo.Window, name string) {
	if w == nil {
		return
	}
	encoded, _ := json.Marshal(name)
	go func() {
		if _, err := eval(w, "window.reviewDesktop?.command("+string(encoded)+")"); err != nil {
			log.Print(err)
		}
	}()
}
func canClose(w *mygo.Window) bool {
	// The bridge is installed before any editable content mounts; an unloaded page has no drafts.
	value, err := eval(w, "window.reviewDesktop ? (window.reviewDesktop.canClose?.() ?? false) : true")
	return err == nil && value == true
}
func configure(w *mygo.Window) {
	w.Page().SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
		u, err := url.Parse(req.URL)
		if err == nil && (u.Scheme == "https" || u.Scheme == "http" || u.Scheme == "mailto") {
			go mygo.Shell.OpenExternal(req.URL)
		}
		return nil
	})
	w.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
		u, err := url.Parse(e.URL)
		if err != nil {
			e.PreventDefault()
			return
		}
		if u.Scheme+"://"+u.Host == service.Origin && (u.Path == "/" || u.Path == "/scratch") {
			return
		}
		e.PreventDefault()
		if u.Scheme == "https" || u.Scheme == "http" || u.Scheme == "mailto" {
			go mygo.Shell.OpenExternal(e.URL)
		}
	})
	w.OnClose(func(e *mygo.CloseEvent) {
		if quitting || closing[w.ID()] {
			return
		}
		e.PreventDefault()
		go func() {
			if !canClose(w) {
				return
			}
			mygo.RunOnMain(func() { closing[w.ID()] = true; w.Close() })
		}()
	})
	w.OnClosed(func() {
		delete(closing, w.ID())
		if review == w {
			review = nil
		}
		if scratch == w {
			scratch = nil
		}
	})
}
func openReview(raw string) {
	if review != nil {
		review.Show()
		review.Focus()
		if raw != "" {
			u, err := url.Parse(raw)
			if err != nil || u.Scheme+"://"+u.Host != service.Origin {
				return
			}
			fragment, _ := json.Marshal("#" + u.Fragment)
			w := review
			go func() {
				if _, err := eval(w, "window.reviewDesktop?.focus("+string(fragment)+")"); err != nil {
					log.Print(err)
				}
			}()
		}
		return
	}
	target := service.Origin + "/#" + url.Values{"token": {service.Token}}.Encode()
	if raw != "" {
		if u, e := url.Parse(raw); e == nil && u.Scheme+"://"+u.Host == service.Origin {
			target = raw
		}
	}
	review = mygo.NewWindow(mygo.WindowOptions{Title: "Review Console", URL: target, Width: 1440, Height: 950, MinWidth: 950, MinHeight: 600, Page: mygo.PageOptions{TrustedOrigins: []string{service.Origin}, Session: webSession}})
	configure(review)
}
func openScratch() {
	if scratch != nil {
		scratch.Show()
		scratch.Focus()
		return
	}
	scratch = mygo.NewWindow(mygo.WindowOptions{Title: "临时文档", URL: service.Origin + "/scratch", Width: 1280, Height: 850, MinWidth: 700, MinHeight: 500, Page: mygo.PageOptions{TrustedOrigins: []string{service.Origin}, Session: webSession}})
	configure(scratch)
}
func targetArg(args []string) string {
	for _, arg := range args {
		if strings.HasPrefix(arg, service.Origin+"/#") {
			return arg
		}
	}
	return ""
}

// zoom keeps text readable across windows: the step applies to the focused
// window only, and 0 restores 100%.
func zoom(step float64) func(*mygo.MenuItem, *mygo.Window) {
	return func(_ *mygo.MenuItem, w *mygo.Window) {
		if w == nil {
			return
		}
		page := w.Page()
		factor := 1.0
		if step != 0 {
			factor = page.ZoomFactor() + step
		}
		factor = math.Round(math.Min(2, math.Max(0.5, factor))*10) / 10
		page.SetZoomFactor(factor)
	}
}
func menu() *mygo.Menu {
	item := func(label, key, name string, temporary bool) *mygo.MenuItem {
		return &mygo.MenuItem{Label: label, Accelerator: key, Click: func(_ *mygo.MenuItem, w *mygo.Window) {
			if temporary && w != scratch {
				return
			}
			command(w, name)
		}}
	}
	tabs := []*mygo.MenuItem{}
	for i := 1; i <= 9; i++ {
		tabs = append(tabs, item(fmt.Sprintf("标签 %d", i), fmt.Sprintf("CmdOrCtrl+%d", i), fmt.Sprintf("tab:%d", i), true))
	}
	return mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Label: "File", Submenu: []*mygo.MenuItem{
			{Label: "审查台", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { openReview("") }},
			{Label: "临时文档", Accelerator: "CmdOrCtrl+Shift+N", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { openScratch() }},
			item("新建 Markdown 标签", "CmdOrCtrl+T", "new-tab", true),
			item("新建 Diff 标签", "CmdOrCtrl+Shift+T", "new-diff", true),
			{Label: "关闭标签", Accelerator: "CmdOrCtrl+W", Click: func(_ *mygo.MenuItem, w *mygo.Window) {
				if w == scratch {
					command(w, "close-tab")
				} else if w != nil {
					w.Close()
				}
			}},
			item("保存文件", "CmdOrCtrl+S", "save", false),
			{Label: "关闭窗口", Accelerator: "CmdOrCtrl+Shift+W", Click: func(_ *mygo.MenuItem, w *mygo.Window) {
				if w != nil {
					w.Close()
				}
			}},
			{Label: "退出应用", Accelerator: "CmdOrCtrl+Q", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { mygo.App.Quit() }},
		}},
		{Role: mygo.RoleEditMenu},
		{Label: "View", Submenu: []*mygo.MenuItem{
			item("回复源码", "CmdOrCtrl+Enter", "source", false),
			item("上一轮", "", "previous", false),
			item("下一轮", "", "next", false),
			{Type: mygo.MenuItemSeparator},
			{Label: "放大", Accelerator: "CmdOrCtrl+=", Click: zoom(+0.1)},
			{Label: "缩小", Accelerator: "CmdOrCtrl+-", Click: zoom(-0.1)},
			{Label: "实际大小", Accelerator: "CmdOrCtrl+0", Click: zoom(0)},
		}},
		{Label: "Window", Submenu: tabs},
	})
}
func main() {
	mygo.App.SetName("Review Console")
	// Isolated test instances must not take over the user's running app.
	if testMode {
		mygo.App.SetName("Review Console Test")
		webSession = mygo.NewEphemeralSession()
	}
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	executable, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	resources := filepath.Join(filepath.Dir(executable), "..", "Resources")
	cmd := exec.Command(filepath.Join(resources, "node"), filepath.Join(resources, "backend", "cli.mjs"), "--json")
	output, err := cmd.Output()
	if err != nil {
		message := fmt.Sprintf("启动本地服务失败：%v", err)
		if failure, ok := err.(*exec.ExitError); ok {
			message += "\n" + string(failure.Stderr)
		}
		mygo.App.WhenReady(func() { go func() { mygo.Dialog.Error("Review Console", message); mygo.App.Exit(1) }() })
		if runErr := mygo.App.Run(); runErr != nil {
			log.Print(runErr)
		}
		return
	}
	if err = json.Unmarshal(output, &service); err != nil {
		log.Fatal(err)
	}
	u, err := url.Parse(service.Origin)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" {
		log.Fatal("服务地址无效")
	}
	mygo.Bind(Desktop{})
	mygo.App.OnSecondInstance(func(args []string, _ string) { openReview(targetArg(args)) })
	mygo.App.OnWindowAllClosed(func() {})
	mygo.App.OnActivate(func(visible bool) {
		if !visible {
			openReview("")
		}
	})
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if quitting {
			return
		}
		e.PreventDefault()
		if quitPending {
			return
		}
		quitPending = true
		go func() {
			approved := true
			for _, w := range mygo.Windows() {
				if !canClose(w) {
					approved = false
					break
				}
			}
			mygo.RunOnMain(func() {
				quitPending = false
				if approved {
					quitting = true
					mygo.App.Quit()
				}
			})
		}()
	})
	mygo.App.WhenReady(func() { mygo.App.SetMenu(menu()); openReview(targetArg(os.Args[1:])) })
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
