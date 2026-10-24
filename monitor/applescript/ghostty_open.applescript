-- osascript ghostty_open.applescript "<shell command>"
-- Splits the focused terminal of the front Ghostty window to the RIGHT and types the command
-- into the new shell (grammar from Ghostty.sdef: split <terminal> direction right; input text <t> to <terminal>).
-- The `command` property of a surface configuration was ignored by Ghostty 1.3.1, so the command is
-- entered as pasted text instead. Falls back to a new window when there is no front window.
-- Prints "terminal:<id>" or "window:<id>".
on run argv
  set cmd to item 1 of argv
  tell application "Ghostty"
    try
      set t to focused terminal of selected tab of front window
      set nt to split t direction right
      delay 0.6
      -- bracketed paste keeps pasted text on the prompt; a real Enter key runs it
      input text cmd to nt
      send key "enter" to nt
      return "terminal:" & (id of nt)
    on error
      set w to new window
      delay 0.8
      set nt to focused terminal of selected tab of w
      input text cmd to nt
      send key "enter" to nt
      return "window:" & (id of w)
    end try
  end tell
end run
