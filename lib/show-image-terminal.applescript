-- show-image --window for Terminal.app: open a new window running `<show-image> --inline <path>`
-- (chafa if installed, else Quick Look). Both values arrive as argv and are shell-quoted with
-- `quoted form of`; nothing is interpolated into this script.
on run argv
	set cmd to quoted form of (item 1 of argv) & " --inline " & quoted form of (item 2 of argv)
	tell application "Terminal"
		activate
		do script cmd
	end tell
end run
