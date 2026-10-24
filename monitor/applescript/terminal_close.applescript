-- osascript terminal_close.applescript <window id>
on run argv
  set theId to (item 1 of argv) as integer
  tell application "Terminal"
    close (first window whose id is theId)
  end tell
end run
