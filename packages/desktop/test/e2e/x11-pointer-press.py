"""Press and release the primary pointer button at one X screen point.

XTest makes the X server generate the events, so they reach Electron through
the same native window path as a user's mouse, including Chromium's hit test
for window drag regions. Playwright's mouse methods inject events into the
page and skip that path.
"""

import ctypes
import sys

x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
xtst.XTestFakeMotionEvent.argtypes = [
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_ulong,
]
xtst.XTestFakeButtonEvent.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.c_ulong,
]

x, y = map(int, sys.argv[1:])
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("XOpenDisplay failed")
try:
    for fake in (
        lambda: xtst.XTestFakeMotionEvent(display, -1, x, y, 0),
        lambda: xtst.XTestFakeButtonEvent(display, 1, True, 0),
        lambda: xtst.XTestFakeButtonEvent(display, 1, False, 0),
    ):
        if fake() == 0:
            raise RuntimeError("XTest event failed")
        x11.XSync(display, False)
finally:
    x11.XCloseDisplay(display)
