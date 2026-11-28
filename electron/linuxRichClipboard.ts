import { spawn } from 'node:child_process';

// GTK 3 exposes the multi-target clipboard function in C only. Own CLIPBOARD in
// a small helper so Electron does not take X11 PRIMARY from the editor.
const clipboardOwner = String.raw`
import ctypes as c
import json
import sys
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('GdkX11', '3.0')
from gi.repository import Gdk, GdkX11, Gtk

if not isinstance(Gdk.Display.get_default(), GdkX11.X11Display):
    sys.exit(1)

text, html = (part.encode('utf-8') for part in json.load(sys.stdin))
gtk = c.CDLL('libgtk-3.so.0')
gdk = c.CDLL('libgdk-3.so.0')
ptr = c.c_void_p
get_data = c.CFUNCTYPE(None, ptr, ptr, c.c_uint, ptr)
clear_data = c.CFUNCTYPE(None, ptr, ptr)

class Target(c.Structure):
    _fields_ = [('name', c.c_char_p), ('flags', c.c_uint), ('info', c.c_uint)]

gtk.gtk_clipboard_get.argtypes = [ptr]
gtk.gtk_clipboard_get.restype = ptr
gdk.gdk_atom_intern.argtypes = [c.c_char_p, c.c_int]
gdk.gdk_atom_intern.restype = ptr
gtk.gtk_clipboard_set_with_data.argtypes = [ptr, c.POINTER(Target), c.c_uint, get_data, clear_data, ptr]
gtk.gtk_clipboard_set_with_data.restype = c.c_int
gtk.gtk_selection_data_set.argtypes = [ptr, ptr, c.c_int, c.c_char_p, c.c_int]
gtk.gtk_selection_data_set.restype = None

names = [b'UTF8_STRING', b'text/plain', b'text/plain;charset=utf-8', b'text/html']
targets = (Target * len(names))(*(Target(name, 0, i) for i, name in enumerate(names)))

@get_data
def serve(_clipboard, selection, index, _data):
    payload = html if index == 3 else text
    gtk.gtk_selection_data_set(selection, gdk.gdk_atom_intern(names[index], 0), 8, payload, len(payload))

@clear_data
def lost(_clipboard, _data):
    Gtk.main_quit()

clipboard = gtk.gtk_clipboard_get(gdk.gdk_atom_intern(b'CLIPBOARD', 0))
if not gtk.gtk_clipboard_set_with_data(clipboard, targets, len(names), serve, lost, None):
    sys.exit(1)
Gdk.Display.get_default().sync()
print('ready', flush=True)
sys.stdout.close()
Gtk.main()
`;

export function writeX11RichClipboard(text: string, html: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', ['-c', clipboardOwner], {
      detached: true,
      env: { ...process.env, GDK_BACKEND: 'x11', NO_AT_BRIDGE: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      if (ready) child.unref();
      else child.kill();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 1500);
    child.stdout.once('data', (chunk: Buffer) => finish(chunk.toString().trim() === 'ready'));
    child.once('error', () => finish(false));
    child.once('exit', () => finish(false));
    child.stdin.on('error', () => finish(false));
    child.stdin.end(JSON.stringify([text, html]));
  });
}
