# REPORT — hardware-debugger (agent)

## Files created
- `agents/hardware-debugger.md` — the subagent (`mods:hardware-debugger`). Frontmatter: `name`,
  one-line `description`, `tools: Read, Glob, Grep, Bash`, `color: orange`. Body 118 lines (budget < 120).
- `agents/README-hardware-debugger.md`
- `agents/REPORT-hardware-debugger.md` (this file)

No scripts, no `test.sh`: the deliverable is a static agent definition with nothing executable to unit-test.
The one piece of new logic (the inline Python sniffer) was extracted and run, see below.

## hooks.json / .mcp.json / settings.json snippets
None. Plugin `agents/*.md` load automatically (FORMATS.md §5); there is no hooks.json entry, no MCP
server and no settings key for this mod. Nothing for the orchestrator to merge.

## Tests run

`claude plugin validate ~/claude-mods/agents` (FORMATS.md §7.5: a directory without plugin.json
validates its skills/agents/commands folders):
```
Validating components in: ~/claude-mods/agents

✔ Validation passed
validate exit=0
```

Body line count: `awk` over the file after the closing `---` = 118 lines (total 124 with frontmatter).

Privacy grep over the three files for home-directory paths, emails, personal names: clean.

Sniffer self-check: the Python snippet in section 3 was extracted verbatim from the agent file, pointed at
the always-present `/dev/cu.Bluetooth-Incoming-Port` with the bound lowered to 2 s, `ast.parse`d, then run:
```
sniffer: syntax OK, 9 lines
sniffer: exit=0, ran 2.0s (bound 2 s); 0 bytes expected on an idle port
```
Note for whoever re-runs it: `python3 -I` hides pyserial here because it is installed in user site-packages;
run with plain `python3`.

Read-only probes from the guide, run on this Mac (macOS 26.6.2, Claude Code 2.1.310, no USB device
attached at the time; serial-number-shaped tokens redacted):
```
$ ls -l /dev/cu.* /dev/tty.*
crw-rw-rw-  1 root  wheel  0x9000003 Oct 24 12:17 /dev/cu.Bluetooth-Incoming-Port
crw-rw-rw-  1 root  wheel  0x9000001 Oct 24 12:16 /dev/cu.debug-console
crw-rw-rw-  1 root  wheel  0x9000002 Oct 24 12:17 /dev/tty.Bluetooth-Incoming-Port
crw-rw-rw-  1 root  wheel  0x9000000 Oct 24 12:16 /dev/tty.debug-console

$ system_profiler SPUSBDataType -detailLevel mini | head
(no output: on macOS 26 the alias returns an empty array when nothing is attached)
$ system_profiler -listDataTypes | grep -i usb
SPUSBHostDataType
$ system_profiler SPUSBHostDataType -detailLevel mini | head -8
USB:

    USB 4.0 Bus:

      Location ID: 0x08000000
      Connection Type: Built-in
      Driver: AppleT6050USBXHCIAUSS

$ ioreg -r -c IOSerialBSDClient -l | head -16
+-o IOSerialBSDClient  <class IOSerialBSDClient, id 0x100000794, registered, matched, active, busy 0 (4 ms), retain 5>
    {
      "IOClass" = "IOSerialBSDClient"
      "CFBundleIdentifier" = "com.apple.iokit.IOSerialFamily"
      "IOProviderClass" = "IOSerialStreamSync"
      "IOTTYBaseName" = "debug-console"
      ...
      "IOTTYDevice" = "debug-console"
      "IOCalloutDevice" = "/dev/cu.debug-console"
      "IODialinDevice" = "/dev/tty.debug-console"

$ ioreg -r -c IOSerialBSDClient -t -w0 | grep -- '+-o'      # ancestry shows the owning driver class
            +-o AppleSamsungSerial  <class AppleSamsungSerial>
              +-o debug-console  <class AppleSimpleUARTSync>
                +-o IOSerialBSDClient  <class IOSerialBSDClient>

$ ioreg -p IOUSB -l -w0 | grep -E '"idVendor"|"idProduct"|"USB Product Name"'
(no matches: nothing attached; the plane shows only the four Apple XHCI root controllers)
$ ioreg -r -c IOUSBHostDevice -l | grep -c '"idVendor"'
0

$ stty -f /dev/cu.Bluetooth-Incoming-Port -a | head -3      # non-blocking on cu.*, rc 0
speed 9600 baud; 0 rows; 0 columns;
lflags: -icanon -isig -iexten -echo -echoe -echok -echoke -echonl
cflags: cread cs8 -parenb -parodd hupcl -clocal -cstopb -crtscts -dsrflow

$ log show --last 2m --predicate '...'
(eval):log:1: too many arguments        <- zsh `log` builtin shadows /usr/bin/log; the guide uses /usr/bin/log
$ /usr/bin/log show --last 1h --style compact --predicate '(process == "kernel") && (eventMessage CONTAINS[c] "usb")' | head -3
Timestamp               Ty Process[PID:TID]
2026-10-24 12:17:23.257 Df kernel[0:180f] (IOAccessoryManager) IOPortFeatureLDCMUserClient::... (target: Port-USB-C@3/LDCM ...)
$ /usr/bin/log stream --info --style compact --predicate 'subsystem == "com.apple.iokit"'   (3 s Python timeout)
Filtering the log data using "subsystem == "com.apple.iokit""     <- predicate accepted, stream started

$ for t in screen xxd ts stty cu minicom picocom; ...
screen /usr/bin/screen   xxd /usr/bin/xxd   stty /bin/stty   cu /usr/bin/cu   ts MISSING   minicom MISSING   picocom MISSING
$ python3 -c "import serial; print(serial.__version__)"; python3 -m serial.tools.miniterm -h | head -1
3.5
usage: miniterm.py [-h] [--parity {N,E,O,S,M}] [--rtscts] [--xonxoff] [--rts RTS] [--dtr DTR] ...

$ ls /System/Library/DriverExtensions | grep -iE 'usb(ftdi|slcom|chcom|plcom|serial)'; ls /System/Library/Extensions | grep -E 'AppleUSB(ACM|CDC|Serial)'
com.apple.DriverKit-AppleUSBCHCOM.dext  com.apple.DriverKit-AppleUSBFTDI.dext  com.apple.DriverKit-AppleUSBPLCOM.dext
com.apple.DriverKit-AppleUSBSLCOM.dext  com.apple.DriverKit-AppleUSBSerial.dext  AppleUSBACM.kext  AppleUSBCDC.kext  AppleUSBSerial.kext
```
The last block is what the driver table in the agent rests on: Apple ships FTDI, CP210x (SLCOM), CH34x
(CHCOM), PL2303 (PLCOM) and CDC-ACM drivers on macOS 26, so "missing driver" is the exception, not the rule.

Terminal env overrides (`TERM_PROGRAM=Apple_Terminal` / `TERM_PROGRAM=ghostty ...`) were not run: the agent
emits plain text and nothing in it depends on `TERM`, so there is nothing those overrides could change.

## Needs from user
- None required. Optional: `ts` from moreutils (`brew install moreutils`) if they prefer `cat | ts` over the
  Python timestamps. A real USB-serial device plugged in for an end-to-end run (none was attached during the build).

## Terminal.app vs Ghostty differences
None. The agent prints text; the interactive tools it hands to the user (`screen`, `miniterm`, `cu`) are
the same in both terminals.

## Known limitations
- Not exercised against a real attached device: every probe ran with an empty USB bus. The commands,
  predicates and the sniffer are verified to run; the VID:PID -> driver binding rows are from knowledge,
  with the driver files' existence verified on this Mac.
- Unified-log wording for power/enumeration faults varies by macOS release; the guide greps by keyword
  (`usb`, `power`, `over-current`, `enumerat`) rather than exact messages.
- macOS has no per-port framing/parity error counters, so the guide diagnoses framing by symptom only.
- Agents cannot honour `CLAUDE_MODS_DISABLE` (no script runs); README documents remove-the-file instead.
- No scanner or reader vendor names anywhere: the guide is generic serial/USB, as confirmed by the user.

## Security notes
Read-only by design: the body forbids writes to devices without showing the bytes and getting
confirmation, forbids `sudo`, `/dev/disk*`, kext/dext load/unload, settings changes and firmware flashing
without an explicit request plus file path, and tells the agent to redact serial numbers. `tools:` omits
Write/Edit, so the agent cannot alter files either.
