-- osascript ghostty_open.applescript "<shell command>"
-- Splits the focused terminal of the front Ghostty window to the RIGHT running the command
-- (grammar from Ghostty.sdef: split <terminal> direction right with configuration <surface configuration>).
-- Falls back to a new window when there is no front window. Prints "terminal:<id>" or "window:<id>".
on run argv
  set cmd to item 1 of argv
  tell application "Ghostty"
    set cfg to new surface configuration
    set command of cfg to cmd
    set wait after command of cfg to false
    try
      set t to focused terminal of selected tab of front window
      try
        set nt to split t direction right with configuration cfg
      on error
        -- record literal in case the configuration object does not accept "set command of"
        set nt to split t direction right with configuration {command:cmd, wait after command:false}
      end try
      return "terminal:" & (id of nt)
    on error
      set w to new window with configuration cfg
      return "window:" & (id of w)
    end try
  end tell
end run
