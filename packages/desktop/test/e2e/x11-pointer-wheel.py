"""Turn the pointer's wheel down at one X screen point, a number of notches.

As with x11-pointer-press.py, XTest makes the X server generate the events, so
they reach Electron through the native window path, as a user's wheel does.
X reports each wheel notch down as a press and release of button 5.
"""

import ctypes
import sys
import time

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

x, y, notches = map(int, sys.argv[1:])
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("XOpenDisplay failed")
try:
    # The pointer settles over its target before the wheel turns, as a hand's does.
    steps = [(lambda: xtst.XTestFakeMotionEvent(display, -1, x, y, 0), 0.3)]
    for _ in range(notches):
        steps.append((lambda: xtst.XTestFakeButtonEvent(display, 5, True, 0), 0))
        steps.append((lambda: xtst.XTestFakeButtonEvent(display, 5, False, 0), 0.05))
    for fake, pause in steps:
        if fake() == 0:
            raise RuntimeError("XTest event failed")
        x11.XSync(display, False)
        time.sleep(pause)
finally:
    x11.XCloseDisplay(display)
