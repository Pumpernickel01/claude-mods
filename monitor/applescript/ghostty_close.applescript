-- osascript ghostty_close.applescript terminal|window <id>
on run argv
  set theKind to item 1 of argv -- "kind" is a reserved word in AppleScript
  set theId to item 2 of argv
  tell application "Ghostty"
    if theKind is "terminal" then
      close (first terminal whose id is theId)
    else
      close window (first window whose id is theId)
    end if
  end tell
end run
