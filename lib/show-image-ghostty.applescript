-- show-image --window for Ghostty: split the focused terminal to the right (new window if there is
-- none) and run `<show-image> --inline <path>` there. Both values arrive as argv and are shell-quoted
-- with `quoted form of`; nothing is interpolated into this script. Ghostty runs a command with
-- arguments through /bin/sh -c; `wait after command` keeps the split open until a key is pressed.
on run argv
	set cmd to quoted form of (item 1 of argv) & " --inline " & quoted form of (item 2 of argv)
	tell application "Ghostty"
		set cfg to {command:cmd, wait after command:true}
		try
			set t to focused terminal of selected tab of front window
			split t direction right with configuration cfg
		on error
			new window with configuration cfg
		end try
	end tell
end run
