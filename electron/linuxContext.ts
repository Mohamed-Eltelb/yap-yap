// AT-SPI exposes Unicode character offsets and stable object paths on the desktop bus.
// The system Python uses the distro's PyGObject and AT-SPI bindings.
import { linuxInputMethod } from './linuxInputMethod';
import { SELECTION_LIMIT } from './selectionLimit';

export const linuxContextProbe = String.raw`
import json
import sys
import warnings
from collections import deque
import gi
try:
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
except (ValueError, ImportError):
    Atspi = None

warnings.simplefilter('ignore')
LIMIT = 600
SELECTION_LIMIT = ${SELECTION_LIMIT}
PAGES = (Atspi.Role.DOCUMENT_WEB, Atspi.Role.DOCUMENT_FRAME) if Atspi else ()

def page_url(node):
    # Chromium names the attribute URI and Firefox DocURL. Older AT-SPI only has the deprecated getter.
    document = node.get_document_iface()
    if not document:
        return None
    read = getattr(document, 'get_attribute_value', None) or document.get_document_attribute_value
    for key in ('URI', 'DocURL'):
        try:
            value = read(key)
        except Exception:
            continue
        if value and value.startswith(('http://', 'https://')):
            return value
    return None

def is_address_bar(node, attrs, browser):
    if not browser:
        return False
    # Browser address bars sit in a toolbar of the browser itself, outside any web page. The structure
    # works in every UI language. A toolbar inside a page (role="toolbar") holds ordinary page inputs.
    toolbar = False
    parent = node.get_parent()
    for _ in range(64):
        if not parent:
            break
        if parent.get_role() == Atspi.Role.TOOL_BAR:
            toolbar = True
        elif parent.get_role() in PAGES and page_url(parent):
            return False
        parent = parent.get_parent()
    if toolbar or attrs.get('id') in ('urlbar-input', 'addressEditBox'):
        return True
    # Fallback for browsers that lay out the address bar differently.
    label = (node.get_name() or '').lower()
    return 'address bar' in label or 'address and search' in label or 'search or enter address' in label

OBJECT = '￼'

def selected_text(node, start, end, depth=0):
    """The text from start to end, with each embedded element read in place.

    Browsers show each element inside a text (a bold word, a link) as U+FFFC in its parent's
    text. Each one is replaced with that element's text: the part selected in it, or all of it
    when the selection runs across it. Elements without text (images) add nothing. None when an
    element can't be read, so no words go missing silently. Firefox adds U+FEFF, which is dropped.
    """
    text = Atspi.Text.get_text(node, start, min(end, start + SELECTION_LIMIT + 1))
    editable = node.get_state_set().contains(Atspi.StateType.EDITABLE)
    if OBJECT not in text:
        return text.replace('﻿', ''), editable
    if depth > 8:
        return None
    parts = []
    length = 0
    for index, char in enumerate(text):
        if length > SELECTION_LIMIT:
            break
        if char != OBJECT:
            parts.append(char)
            length += 1
            continue
        try:
            link = Atspi.Hypertext.get_link(node, Atspi.Hypertext.get_link_index(node, start + index))
            child = Atspi.Hyperlink.get_object(link, 0)
        except Exception:
            return None
        if child is None:
            return None
        if child.get_text_iface() is None:
            continue
        child_selected = child.get_n_selections() > 0
        if child_selected:
            span = Atspi.Text.get_selection(child, 0)
            piece = selected_text(child, span.start_offset, span.end_offset, depth + 1)
        else:
            piece = selected_text(child, 0, child.get_character_count(), depth + 1)
        if piece is None:
            return None
        child_text, child_editable = piece
        # A document reports a selection inside a textarea as just that embedded object.
        if text == OBJECT and child_selected:
            editable = editable or child_editable
        parts.append(child_text)
        length += len(child_text)
    return ''.join(parts).replace('﻿', ''), editable

def selection_offsets(node):
    selections = node.get_n_selections()
    if selections == 0:
        caret = node.get_caret_offset()
        return caret, caret
    if selections == 1:
        span = Atspi.Text.get_selection(node, 0)
        return tuple(sorted((span.start_offset, span.end_offset)))
    return -1, -1

${linuxInputMethod}

def matches_rewrite(node, start, end, old, selected):
    if selected is None:
        return True
    if start == end or end - start > SELECTION_LIMIT:
        return False
    if old == selected:
        return True
    # Compare the same rendered text that Ask captured from Firefox and rich editors.
    selection = selected_text(node, start, end)
    return selection is not None and selection[0] == selected

def insert_text(node, text, selected=None):
    # Check what arrived: some apps acknowledge an edit they did not apply.
    if not text:
        return False
    start, end = selection_offsets(node)
    count = node.get_character_count()
    if not 0 <= start <= end <= count:
        return False
    old = Atspi.Text.get_text(node, start, end) if end > start else ''
    if not matches_rewrite(node, start, end, old, selected):
        return False
    if not node.get_editable_text_iface():
        return commit_with_ibus(node, text, start, end, old, count, selected)
    size = len(text)

    def matches(offset, expected):
        return Atspi.Text.get_text(node, offset, offset + len(expected)) == expected

    # Insert first so an unsupported insertion never erases the user's selection.
    Atspi.EditableText.insert_text(node, end, text, len(text.encode('utf-8')))
    added = node.get_character_count() - count
    if old and added == size and matches(start, old) and matches(end, text):
        Atspi.EditableText.delete_text(node, start, end)
    if node.get_character_count() == count - (end - start) + size and matches(start, text):
        Atspi.Text.set_caret_offset(node, start + size)
        return True

    # A field may cap the insertion or refuse the deletion. Remove only the prefix
    # we can still identify, leaving the original selection in place.
    if 0 < added <= size and node.get_character_count() == count + added and matches(end, text[:added]):
        if not old or matches(start, old):
            Atspi.EditableText.delete_text(node, end, end + added)
            if old and node.get_character_count() == count:
                if node.get_n_selections():
                    Atspi.Text.set_selection(node, 0, start, end)
                else:
                    Atspi.Text.add_selection(node, start, end)
    return False

def read_field(pid, mode, browser, skip_pid=0, retry_window=None):
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        # pid 0: the foreground app is unknown (native Wayland); any other app with the active window.
        if not app or (pid and app.get_process_id() != pid) or (not pid and skip_pid and app.get_process_id() == skip_pid):
            continue
        # GNOME Shell's stage stays ACTIVE even while another application has focus.
        # When only the shell is active (e.g. the overview), there is no target app.
        if not pid and app.get_name() == 'gnome-shell' and app.get_toolkit_name() == 'clutter':
            continue
        # Limit the search to an active top-level window in the foreground process.
        queue = deque()
        for i in range(app.get_child_count()):
            window = app.get_child_at_index(i)
            if retry_window is not None:
                if window != retry_window:
                    continue
                window.clear_cache()
            if window and window.get_state_set().contains(Atspi.StateType.ACTIVE):
                # Asking for attributes tells Chromium an accessibility client needs the
                # page tree. Until then it may expose only the browser window.
                if app.get_toolkit_name() == 'Chromium':
                    window.get_attributes()
                queue.append(window)
        if mode == 'pid':
            if queue:
                return dict(pid=app.get_process_id())
            continue
        if not pid and not queue:
            continue
        focused_page = False
        # Breadth-first order reaches the page document before any field inside it, but a
        # browser can list its address bar before the page. Then keep looking for the page.
        url = None
        text_hidden = False
        found = None
        first_window = queue[0] if queue else None
        page_seen = False
        for _ in range(LIMIT):
            if not queue:
                break
            node = queue.popleft()
            role = node.get_role()
            states = node.get_state_set()
            if mode == 'selection':
                page_seen = page_seen or role in PAGES
                # A focused password field: nothing is read, and the highlight fallback is not used.
                # The search goes on past a selection found first, since another field (an old
                # selection in a sibling field) may come before the focused password field.
                if role == Atspi.Role.PASSWORD_TEXT and states.contains(Atspi.StateType.FOCUSED):
                    return dict(password=True)
                # Read-only text counts: a selection on a web page is often what is asked about.
                if role != Atspi.Role.PASSWORD_TEXT and node.get_text_iface() is not None and node.get_n_selections() > 0:
                    attrs = node.get_attributes() or {}
                    if attrs.get('text-input-type', '').lower() == 'password':
                        return dict(password=True)
                    span = Atspi.Text.get_selection(node, 0)
                    if found is None and span.end_offset > span.start_offset:
                        selection = selected_text(node, span.start_offset, span.end_offset)
                        if selection is None:
                            # Part of it could not be read: the last highlight stands in for it.
                            found = dict(incomplete=True)
                        else:
                            text, editable = selection
                            if text.strip():
                                found = dict(text=text, editable=editable)
            elif mode in ('insert', 'replace'):
                if states.contains(Atspi.StateType.FOCUSED) and states.contains(Atspi.StateType.EDITABLE):
                    if role == Atspi.Role.PASSWORD_TEXT or (node.get_attributes() or {}).get('text-input-type', '').lower() == 'password':
                        return
                    if node.get_text_iface():
                        return dict(inserted=insert_text(node, *insertion_request(mode)))
            elif mode == 'paste':
                if states.contains(Atspi.StateType.FOCUSED):
                    if role == Atspi.Role.PASSWORD_TEXT or (node.get_attributes() or {}).get('text-input-type', '').lower() == 'password':
                        return dict(editable=False)
                    if states.contains(Atspi.StateType.EDITABLE):
                        return dict(editable=True)
                    if role in PAGES:
                        focused_page = True
            elif role == Atspi.Role.PASSWORD_TEXT:
                continue
            else:
                if url is None and role in PAGES and states.contains(Atspi.StateType.SHOWING):
                    url = page_url(node)
                    if url and text_hidden:
                        return dict(url=url)
                if not text_hidden and states.contains(Atspi.StateType.FOCUSED) and states.contains(Atspi.StateType.EDITABLE) and node.get_text_iface() is not None:
                    attrs = node.get_attributes() or {}
                    if attrs.get('text-input-type', '').lower() == 'password':
                        return
                    caret = node.get_caret_offset()
                    count = node.get_character_count()
                    # Address bars can contain private URLs. Never treat one as editor context.
                    if is_address_bar(node, attrs, browser) or not 0 <= caret <= count or node.get_n_selections() > 0:
                        if mode != 'context':
                            return
                        if url:
                            return dict(url=url)
                        text_hidden = True
                        continue
                    if mode == 'field':
                        return dict(field=str(pid) + ':' + node.path, text=Atspi.Text.get_text(node, max(0, caret-3000), min(count, caret+3000)))
                    return dict(url=url, textBefore=Atspi.Text.get_text(node, max(0, caret-240), caret), textAfter=Atspi.Text.get_text(node, caret, min(count, caret+120)))
            for i in range(min(node.get_child_count(), LIMIT - len(queue))):
                child = node.get_child_at_index(i)
                if child:
                    queue.append(child)
        if mode == 'selection':
            # Chromium publishes a newly requested renderer tree asynchronously.
            # Retry only this read, while the same window is still active.
            if (not found and not page_seen and first_window and retry_window is None
                    and app.get_toolkit_name() == 'Chromium'):
                from gi.repository import GLib
                loop = GLib.MainLoop()
                GLib.timeout_add(120, loop.quit)
                loop.run()
                return read_field(app.get_process_id(), mode, browser, skip_pid, first_window)
            return found
        if mode == 'paste':
            # A search cut short by the limit can't tell that no field has focus.
            return dict(editable=False) if focused_page and not queue else None
        return dict(url=url) if url and mode == 'context' else None

    if not pid and mode in ('selection', 'insert', 'replace') and wayland:
        return input_method_field(mode)

pid, mode = int(sys.argv[1]), sys.argv[2]
wayland = len(sys.argv) > 5 and sys.argv[5] == 'wayland'
if Atspi:
    result = read_field(pid, mode, len(sys.argv) > 3 and sys.argv[3] == 'browser', int(sys.argv[4]) if len(sys.argv) > 4 else 0)
elif wayland and mode in ('selection', 'insert', 'replace'):
    result = input_method_field(mode)
else:
    result = None
print(json.dumps(result or {}, ensure_ascii=False))
`;

// An X11 owner can tell when it took the primary selection. Ask separately: an owner that
// never replies must not cost us the accessibility result, especially a focused password field.
export const linuxPrimaryStampProbe = String.raw`
import sys
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
gi.require_version('GdkX11', '3.0')
from gi.repository import Gdk, GdkX11, Gtk

if isinstance(Gdk.Display.get_default(), GdkX11.X11Display):
    selection = Gtk.Clipboard.get(Gdk.SELECTION_PRIMARY)
    data = selection.wait_for_contents(Gdk.Atom.intern('TIMESTAMP', False))
    if data and data.get_data_type().name() == 'INTEGER' and data.get_format() == 32:
        # GDK returns an X11 format-32 item in a native long, including on 64-bit systems.
        value = int.from_bytes(data.get_data(), sys.byteorder)
        if 0 < value <= 0xffffffff:
            print(value)
`;
