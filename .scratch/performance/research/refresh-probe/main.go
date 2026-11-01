// Isolated research host. Build from desktop/ so it uses the product's pinned MyGo.
package main

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"

	"github.com/ebitengine/purego/objc"
	"github.com/egoist/mygo"
	_ "github.com/egoist/mygo/plugins/automation"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
)

func send(o objc.ID, name string, args ...any) objc.ID {
	return o.Send(objc.RegisterName(name), args...)
}

func webView(view objc.ID) objc.ID {
	if send(view, "isKindOfClass:", objc.GetClass("WKWebView")) != 0 {
		return view
	}
	children := send(view, "subviews")
	for i, n := uintptr(0), uintptr(send(children, "count")); i < n; i++ {
		if found := webView(send(children, "objectAtIndex:", i)); found != 0 {
			return found
		}
	}
	return 0
}

// This SPI changes only this test window, never a persisted/global preference.
func near60(w *mygo.Window, enabled bool) {
	web := webView(send(objc.ID(w.NativeHandle()), "contentView"))
	prefs := send(send(web, "configuration"), "preferences")
	features := send(objc.ID(objc.GetClass("WKPreferences")), "_features")
	for i, n := uintptr(0), uintptr(send(features, "count")); i < n; i++ {
		f := send(features, "objectAtIndex:", i)
		key := objc.Send[string](send(f, "key"), objc.RegisterName("UTF8String"))
		if key == "PreferPageRenderingUpdatesNear60FPSEnabled" {
			send(prefs, "_setEnabled:forFeature:", enabled, f)
			log.Printf("preferNear60=%v readback=%v", enabled, send(prefs, "_isEnabledForFeature:", f) != 0)
			return
		}
	}
	panic("near-60 feature unavailable")
}

func main() {
	mygo.App.SetName("Galley Refresh Probe")
	mode, target := os.Getenv("PROBE_MODE"), os.Getenv("PROBE_URL")
	mygo.App.WhenReady(func() {
		options := mygo.WindowOptions{Title: "Galley Refresh Probe", Width: 1440, Height: 950, X: 100, Y: 70}
		if mode == "native" {
			patch, err := os.ReadFile(os.Getenv("PROBE_PATCH"))
			if err != nil {
				panic(err)
			}
			files, err := editor.ParsePatch(string(patch))
			if err != nil || len(files) != 1 {
				panic(fmt.Sprintf("patch: %v, files=%d", err, len(files)))
			}
			d := &editor.DiffState{Layout: editor.DiffUnified, Wrap: true, ExpandUnchanged: true, LineHeight: 1.6}
			d.SetPatch(files[0])
			options.Content = ui.View(func(c *ui.Context) {
				ui.Row(c).Fill().Children(func() {
					ui.Box(c).Width(459).FillHeight()
					editor.DiffView(c, d).Width(510).FillHeight()
					ui.Box(c).Grow(1).FillHeight()
				})
			})
		} else {
			u, err := url.Parse(target)
			if err != nil {
				panic(err)
			}
			options.URL = target
			options.Page = mygo.PageOptions{Session: mygo.NewEphemeralSession(), TrustedOrigins: []string{u.Scheme + "://" + u.Host}}
		}
		w := mygo.NewWindow(options)
		items := []*mygo.MenuItem{{Label: "Quit", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { mygo.App.Quit() }}}
		if mode != "native" {
			var lines strings.Builder
			for i := 0; i < 5000; i++ {
				fmt.Fprintf(&lines, "<div>%05d — simple scrolling baseline 中文 text</div>", i)
			}
			html := `<!doctype html><style>body{margin:0;background:#fafafa}#content{position:absolute;left:459px;width:510px;top:40px;bottom:0;overflow:auto;font:13px/35px monospace}#marker{position:fixed;left:650px;top:250px;width:100px;height:100px;background:#000;color:white;display:none}</style><div id="content">` + lines.String() + `</div><div id="marker"></div>`
			items = append(items,
				&mygo.MenuItem{Label: "Near60 On", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { near60(w, true) }},
				&mygo.MenuItem{Label: "Near60 Off", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { near60(w, false) }},
				&mygo.MenuItem{Label: "Minimal", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { w.Page().LoadHTML(html, "") }},
			)
		}
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{{Role: mygo.RoleAppMenu}, {Label: "Probe", Submenu: items}}))
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
