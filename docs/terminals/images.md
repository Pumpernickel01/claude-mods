# Showing images to the user: `show-image`

`bin/show-image <path>` previews an image. `bin/` is on the Bash tool's PATH (FORMATS.md §7.1), so
Claude can call it by name. Add this line to your project's `CLAUDE.md` (or `~/.claude/CLAUDE.md`):

```
After reading or producing an image (screenshot, plot, diagram, generated PNG), run `show-image <path>` so I can see it.
```

## The limitation, honestly

When Claude runs a command through the Bash tool, its output is captured by Claude Code and shown as
text in the transcript. A kitty-graphics escape sequence in that output is **never drawn on your
terminal**. So an inline render is useless from Claude's side. `show-image` therefore has two modes:

| Mode | What happens | Default when |
|---|---|---|
| `--inline` | Ghostty / kitty / WezTerm: kitty graphics protocol inline (`\e_Gf=100,a=T,q=2,m=…;<base64 PNG, 4096-byte chunks>\e\\`). Terminal.app / others: `chafa --size <cols>x<rows>` block art if installed, else Quick Look (`qlmanage -p`), with `open -a Preview <path>` printed as the alternative. | stdout is a TTY (you typed it) |
| `--window` | Opens a **new surface next to you** that runs `show-image --inline <path>`: Ghostty → split to the right of the focused terminal (new window if none) via its AppleScript dictionary; Terminal.app → `do script` in a new window; other terminals (VS Code, unknown wrappers) → Quick Look panel. | stdout is not a TTY (Claude ran it) |

In every mode the **last stdout line is `<absolute path> <width>x<height>`** (from `sips`, PNG header
as fallback), so Claude can always tell you where the file is even when nothing could be drawn.

Non-PNG input is converted with `sips -s format png`, and anything larger than 1000 px on a side is
downscaled (`sips -Z 1000`) into a temp file; the original is untouched. Off macOS only PNGs render.

## Permissions

`--window` uses `osascript`. The first time, macOS asks whether the calling app may control
"Ghostty" or "Terminal" (System Settings > Privacy & Security > Automation). Deny it and `show-image`
prints nothing visible but still prints the path line. The image path is passed to the AppleScript as
an **argument** (`on run argv`, `quoted form of`), never spliced into script text.

## Examples

```
show-image out/plot.png            # from Claude: opens a split (Ghostty) / window (Terminal.app)
show-image --inline out/plot.png   # from your own shell in Ghostty: inline picture
show-image --window shot.jpg       # force the new-surface behaviour from a TTY
```

## Not tested live

The Ghostty split and Terminal.app window were not opened during the build (the session could not see
real windows). `bin/test_show_image.sh` checks the kitty byte stream, the `chafa` call, the `osascript`
argument order and the Quick Look fallback with fakes on PATH; both AppleScripts compile against the
apps' dictionaries (`osacompile`). Report any runtime AppleScript error with its message.
