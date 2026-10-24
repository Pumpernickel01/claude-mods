// osascript -l JavaScript screen.js  ->  "<left> <top> <right> <bottom>" of the main screen's
// usable area in AppleScript (top-origin) coordinates. Needs no Automation permission.
function run() {
  ObjC.import("AppKit");
  var s = $.NSScreen.mainScreen, f = s.frame, v = s.visibleFrame;
  var top = f.size.height - (v.origin.y + v.size.height);
  return [v.origin.x, top, v.origin.x + v.size.width, top + v.size.height].map(Math.round).join(" ");
}
