"""Perform one native Electron window drag under Xvfb.

Xvfb supplies an X server but no window manager. Electron still crosses its
production draggable-region boundary by sending _NET_WM_MOVERESIZE. This
helper accepts that native request, grabs the X pointer, and moves only the
requesting top-level window as XTest pointer motion arrives.
"""

import ctypes
import sys


class ClientMessageData(ctypes.Union):
    _fields_ = [
        ("bytes", ctypes.c_char * 20),
        ("shorts", ctypes.c_short * 10),
        ("longs", ctypes.c_long * 5),
    ]


class ClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("message_type", ctypes.c_ulong),
        ("format", ctypes.c_int),
        ("data", ClientMessageData),
    ]


class MotionEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("root", ctypes.c_ulong),
        ("subwindow", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("x_root", ctypes.c_int),
        ("y_root", ctypes.c_int),
        ("state", ctypes.c_uint),
        ("is_hint", ctypes.c_char),
        ("same_screen", ctypes.c_int),
    ]


class ButtonEvent(ctypes.Structure):
    _fields_ = MotionEvent._fields_[:-2] + [
        ("button", ctypes.c_uint),
        ("same_screen", ctypes.c_int),
    ]


class XEvent(ctypes.Union):
    _fields_ = [
        ("type", ctypes.c_int),
        ("client", ClientMessageEvent),
        ("motion", MotionEvent),
        ("button", ButtonEvent),
        ("padding", ctypes.c_long * 24),
    ]


CLIENT_MESSAGE = 33
MOTION_NOTIFY = 6
BUTTON_RELEASE = 5
SUBSTRUCTURE_NOTIFY_MASK = 1 << 19
POINTER_MOTION_MASK = 1 << 6
BUTTON_RELEASE_MASK = 1 << 3
GRAB_MODE_ASYNC = 1
CURRENT_TIME = 0
MOVE_DIRECTION = 8

x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")
display_pointer = ctypes.c_void_p
window_id = ctypes.c_ulong
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = display_pointer
x11.XDefaultRootWindow.argtypes = [display_pointer]
x11.XDefaultRootWindow.restype = window_id
x11.XInternAtom.argtypes = [display_pointer, ctypes.c_char_p, ctypes.c_int]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XSelectInput.argtypes = [display_pointer, window_id, ctypes.c_long]
x11.XSync.argtypes = [display_pointer, ctypes.c_int]
x11.XNextEvent.argtypes = [display_pointer, ctypes.POINTER(XEvent)]
x11.XGetGeometry.argtypes = [
    display_pointer,
    window_id,
    ctypes.POINTER(window_id),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
]
x11.XGrabPointer.argtypes = [
    display_pointer,
    window_id,
    ctypes.c_int,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.c_int,
    window_id,
    ctypes.c_ulong,
    ctypes.c_ulong,
]
x11.XGrabPointer.restype = ctypes.c_int
x11.XMoveWindow.argtypes = [display_pointer, window_id, ctypes.c_int, ctypes.c_int]
x11.XUngrabPointer.argtypes = [display_pointer, ctypes.c_ulong]
x11.XCloseDisplay.argtypes = [display_pointer]
xtst.XTestFakeMotionEvent.argtypes = [
    display_pointer,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_ulong,
]
xtst.XTestFakeButtonEvent.argtypes = [
    display_pointer,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.c_ulong,
]


def next_event(display, event_type):
    while True:
        event = XEvent()
        x11.XNextEvent(display, ctypes.byref(event))
        if event.type == event_type:
            return event


def move_pointer(display, x, y):
    if xtst.XTestFakeMotionEvent(display, -1, x, y, 0) == 0:
        raise RuntimeError("XTestFakeMotionEvent failed")
    x11.XSync(display, False)


pointer_x, pointer_y, delta_x, delta_y, steps = map(int, sys.argv[1:])
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("XOpenDisplay failed")
root = x11.XDefaultRootWindow(display)
move_atom = x11.XInternAtom(display, b"_NET_WM_MOVERESIZE", False)
x11.XSelectInput(display, root, SUBSTRUCTURE_NOTIFY_MASK)
x11.XSync(display, False)
pressed = False
grabbed = False

try:
    move_pointer(display, pointer_x, pointer_y)
    if xtst.XTestFakeButtonEvent(display, 1, True, 0) == 0:
        raise RuntimeError("XTestFakeButtonEvent down failed")
    pressed = True
    x11.XSync(display, False)
    # Chromium M150 does not ask the window manager to begin moving until the
    # held pointer crosses its drag threshold.
    move_pointer(display, pointer_x + delta_x // steps, pointer_y + delta_y // steps)

    while True:
        request = next_event(display, CLIENT_MESSAGE).client
        if request.message_type == move_atom and request.data.longs[2] == MOVE_DIRECTION:
            break

    root_return = window_id()
    window_x = ctypes.c_int()
    window_y = ctypes.c_int()
    width = ctypes.c_uint()
    height = ctypes.c_uint()
    border = ctypes.c_uint()
    depth = ctypes.c_uint()
    if x11.XGetGeometry(
        display,
        request.window,
        ctypes.byref(root_return),
        ctypes.byref(window_x),
        ctypes.byref(window_y),
        ctypes.byref(width),
        ctypes.byref(height),
        ctypes.byref(border),
        ctypes.byref(depth),
    ) == 0:
        raise RuntimeError("XGetGeometry failed")

    grab_result = x11.XGrabPointer(
        display,
        root,
        False,
        POINTER_MOTION_MASK | BUTTON_RELEASE_MASK,
        GRAB_MODE_ASYNC,
        GRAB_MODE_ASYNC,
        0,
        0,
        CURRENT_TIME,
    )
    if grab_result != 0:
        raise RuntimeError(f"XGrabPointer failed with status {grab_result}")
    grabbed = True
    x11.XSync(display, False)

    for step in range(1, steps + 1):
        move_pointer(
            display,
            pointer_x + delta_x * step // steps,
            pointer_y + delta_y * step // steps,
        )
        motion = next_event(display, MOTION_NOTIFY).motion
        x11.XMoveWindow(
            display,
            request.window,
            window_x.value + motion.x_root - int(request.data.longs[0]),
            window_y.value + motion.y_root - int(request.data.longs[1]),
        )
        x11.XSync(display, False)

    if xtst.XTestFakeButtonEvent(display, 1, False, 0) == 0:
        raise RuntimeError("XTestFakeButtonEvent up failed")
    pressed = False
    x11.XSync(display, False)
    next_event(display, BUTTON_RELEASE)
    x11.XUngrabPointer(display, CURRENT_TIME)
    grabbed = False
    x11.XSync(display, False)
finally:
    if pressed:
        xtst.XTestFakeButtonEvent(display, 1, False, 0)
    if grabbed:
        x11.XUngrabPointer(display, CURRENT_TIME)
    x11.XSync(display, False)
    x11.XCloseDisplay(display)
