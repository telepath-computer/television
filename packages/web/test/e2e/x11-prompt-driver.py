"""See and answer a browser's own prompt on an X display.

A browser prompt, such as Chromium's confirmation before it opens an
application link, is not part of the page, so Playwright can neither see nor
answer it. This helper reads the screen and types through the XTEST extension
instead, as a person at the display would.

    x11-prompt-driver.py DISPLAY pixel X Y    prints the pixel at X, Y as RRGGBB
    x11-prompt-driver.py DISPLAY keys KEY...  presses each key, an X keysym name
"""

import ctypes
import sys
import time

Z_PIXMAP = 2
ALL_PLANES = ctypes.c_ulong(-1).value

x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XGetImage.argtypes = [
    ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
    ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int,
]
x11.XGetImage.restype = ctypes.c_void_p
x11.XGetPixel.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
x11.XGetPixel.restype = ctypes.c_ulong
x11.XDestroyImage.argtypes = [ctypes.c_void_p]
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]


def pixel(display, x, y):
    image = x11.XGetImage(display, x11.XDefaultRootWindow(display), x, y, 1, 1, ALL_PLANES, Z_PIXMAP)
    if not image:
        sys.exit(f"could not read the screen at {x}, {y}")
    value = x11.XGetPixel(image, 0, 0)
    x11.XDestroyImage(image)
    print(f"{value & 0xFFFFFF:06x}")


def keys(display, names):
    for name in names:
        keycode = x11.XKeysymToKeycode(display, x11.XStringToKeysym(name.encode()))
        if keycode == 0:
            sys.exit(f"no key for {name}")
        xtst.XTestFakeKeyEvent(display, keycode, True, 0)
        xtst.XTestFakeKeyEvent(display, keycode, False, 0)
        x11.XFlush(display)
        time.sleep(0.1)


def main():
    display = x11.XOpenDisplay(sys.argv[1].encode())
    if not display:
        sys.exit(f"could not open display {sys.argv[1]}")
    try:
        if sys.argv[2] == "pixel":
            pixel(display, int(sys.argv[3]), int(sys.argv[4]))
        elif sys.argv[2] == "keys":
            keys(display, sys.argv[3:])
        else:
            sys.exit(f"unknown command {sys.argv[2]}")
    finally:
        x11.XCloseDisplay(display)


main()
