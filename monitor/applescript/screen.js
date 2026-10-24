// osascript -l JavaScript screen.js [winLeft winTop winRight winBottom]
//   -> "<left> <top> <right> <bottom>" usable area, in AppleScript (top-origin) coordinates,
//      of the screen that contains the given window's centre (main screen when no bounds given).
// Needs no Automation permission.
function run(argv) {
  ObjC.import("AppKit");
  var screens = $.NSScreen.screens, n = screens.count;
  var primaryH = screens.objectAtIndex(0).frame.size.height;   // AppleScript y = primaryH - (ns y + height)
  function asRect(r) {
    var top = primaryH - (r.origin.y + r.size.height);
    return [r.origin.x, top, r.origin.x + r.size.width, top + r.size.height].map(Math.round);
  }
  var pick = $.NSScreen.mainScreen;
  if (argv.length === 4) {
    var b = argv.map(Number), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    for (var i = 0; i < n; i++) {
      var s = screens.objectAtIndex(i), f = asRect(s.frame);
      if (cx >= f[0] && cx < f[2] && cy >= f[1] && cy < f[3]) { pick = s; break; }
    }
  }
  return asRect(pick.visibleFrame).join(" ");
}
