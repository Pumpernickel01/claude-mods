-- osascript terminal_open.applescript "<shell command>" <screenLeft> <screenTop> <screenRight> <screenBottom>
-- Opens a Terminal.app window running the command to the RIGHT of the front window, same height.
-- When fewer than 60 columns fit on the right, the front window is shrunk to the left half first.
-- Prints the new window's id.
on run argv
  set cmd to item 1 of argv
  set scrLeft to (item 2 of argv) as integer
  set scrRight to (item 4 of argv) as integer
  tell application "Terminal"
    set mainWin to front window
    set {l, t, r, b} to bounds of mainWin
    set pxPerCol to (r - l) / (number of columns of mainWin)
    if (scrRight - r) < 60 * pxPerCol then
      set r to scrLeft + ((scrRight - scrLeft) div 2)
      set bounds of mainWin to {scrLeft, t, r, b}
    end if
    do script cmd
    set w to front window
    set custom title of tab 1 of w to "Claude agents"
    set bounds of w to {r, t, scrRight, b}
    return id of w
  end tell
end run
