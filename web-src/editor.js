import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, lineNumbers, keymap, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--editor-bg)", color: "var(--editor-ink)", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.75" },
  ".cm-content": { padding: "16px 0", caretColor: "var(--ink)" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "var(--editor-bg)", color: "var(--subtle)", border: "none", paddingRight: "8px" },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-activeLine": { backgroundColor: "var(--editor-line)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--editor-selection)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--ink)", borderColor: "var(--border)" },
  ".cm-search": { padding: "8px 12px", fontFamily: "var(--ui)" },
  ".cm-textfield": { background: "var(--background)", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 6px" },
  ".cm-button": { background: "var(--hover)", color: "var(--ink)", border: "1px solid var(--border)", borderRadius: "4px", textTransform: "none" },
});
const editorHighlight = HighlightStyle.define([
  { tag: [tags.heading, tags.keyword], color: "var(--syntax-red)" },
  { tag: tags.strong, color: "var(--syntax-orange)", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.string, tags.link, tags.url], color: "var(--syntax-green)" },
  { tag: [tags.monospace, tags.number, tags.atom], color: "var(--syntax-orange)" },
  { tag: [tags.comment, tags.meta], color: "var(--subtle)" },
  { tag: [tags.function(tags.variableName), tags.typeName], color: "var(--syntax-blue)" },
]);
const editing = [drawSelection(), search({ top: true }), keymap.of(searchKeymap), syntaxHighlighting(editorHighlight), editorTheme];

export function findInEditor(parent = document) {
  const host = parent.querySelector(".cm-editor");
  if (host) openSearchPanel(EditorView.findFromDOM(host));
}

// The macOS menu consumes Cmd+Z before CodeMirror can see the keydown.
export function editHistory(name) {
  const view = EditorView.findFromDOM(document.activeElement);
  if (view?.hasFocus) (name === "undo" ? undo : redo)(view);
  else document.execCommand(name);
}

export function createScratchEditor(parent, { state, text, label, isMarkdown, onChange, onPasteImages, scrollTo }) {
  const view = new EditorView({
    parent, scrollTo,
    state: state || EditorState.create({
      doc: text,
      extensions: [
        EditorState.lineSeparator.of(text.match(/\r\n|\r|\n/)?.[0] || "\n"),
        isMarkdown ? markdown() : [], lineNumbers(), history(), highlightActiveLine(),
        editing, EditorView.lineWrapping,
        EditorView.domEventHandlers({
          paste(event) {
            const images = [...(event.clipboardData?.items || [])].filter(item => item.type.startsWith("image/")).map(item => item.getAsFile());
            if (!onPasteImages || !images.length) return false;
            event.preventDefault(); onPasteImages(images); return true;
          },
        }),
        EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state.sliceDoc()); }),
      ],
    }),
  });
  return {
    insert(text) { view.dispatch(view.state.replaceSelection(text)); view.focus(); },
    setText(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
    snapshot: () => ({ state: view.state, scrollTo: view.scrollSnapshot() }),
    destroy: () => view.destroy(),
  };
}

export function createFileEditor(parent, file, onSave, onChange, onPasteImages) {
  const access = new Compartment();
  let editable = !file.partial && /\.(md|markdown|mdx)$/i.test(file.path);
  let original = file.content;
  const permissions = () => [EditorState.readOnly.of(!editable), EditorView.editable.of(editable)];
  const language = /\.(md|markdown|mdx)$/i.test(file.path) ? markdown() : /\.[cm]?[jt]sx?$/i.test(file.path) ? javascript({ typescript: /\.tsx?$/.test(file.path), jsx: /\.[jt]sx$/.test(file.path) }) : [];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: file.content,
      extensions: [
        // Preserve disk line endings when CodeMirror serialises its normalised document.
        EditorState.lineSeparator.of(file.content.match(/\r\n|\r|\n/)?.[0] || "\n"),
        access.of(permissions()), language, lineNumbers(), history(), highlightActiveLine(),
        editing, EditorView.lineWrapping,
        EditorView.domEventHandlers({
          paste(event) {
            const images = [...(event.clipboardData?.items || [])].filter(item => item.type.startsWith("image/")).map(item => item.getAsFile());
            if (!editable || !onPasteImages || !images.length) return false;
            event.preventDefault(); onPasteImages(images, text => view.dispatch(view.state.replaceSelection(text))); return true;
          },
        }),
        EditorView.contentAttributes.of({ "aria-label": "文件内容", tabindex: "0" }),
        keymap.of([{ key: "Mod-s", run: () => { onSave(); return true; } }, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(); }),
        editorTheme,
      ],
    }),
  });
  return {
    get text() { return view.state.sliceDoc(); },
    get dirty() { return view.state.sliceDoc() !== original; },
    get editable() { return editable; },
    markSaved(content) { original = content; onChange(); },
    enable() { if (!file.partial) { editable = true; view.dispatch({ effects: access.reconfigure(permissions()) }); view.focus(); onChange(); } },
    goToLine(line) { const target = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, line))); view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) }); },
    destroy() { view.destroy(); },
  };
}
