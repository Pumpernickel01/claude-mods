-- osascript ghostty_close.applescript terminal|window <id>
on run argv
  set kind to item 1 of argv
  set theId to item 2 of argv
  tell application "Ghostty"
    if kind is "terminal" then
      close (first terminal whose id is theId)
    else
      close window (first window whose id is theId)
    end if
  end tell
end run
