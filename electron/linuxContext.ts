// AT-SPI exposes Unicode character offsets and stable object paths on the desktop bus.
// The system Python uses the distro's PyGObject and AT-SPI bindings.
import { SELECTION_LIMIT } from './selectionLimit';

export const linuxContextProbe = String.raw`
import json
import sys
import warnings
from collections import deque
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

warnings.simplefilter('ignore')
LIMIT = 600
SELECTION_LIMIT = ${SELECTION_LIMIT}
PAGES = (Atspi.Role.DOCUMENT_WEB, Atspi.Role.DOCUMENT_FRAME)

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

def read_field(pid, mode, browser):
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if not app or app.get_process_id() != pid:
            continue
        # Limit the search to an active top-level window in the foreground process.
        queue = deque()
        for i in range(app.get_child_count()):
            window = app.get_child_at_index(i)
            if window and window.get_state_set().contains(Atspi.StateType.ACTIVE):
                queue.append(window)
        focused_page = False
        # Breadth-first order reaches the page document before any field inside it, but a
        # browser can list its address bar before the page. Then keep looking for the page.
        url = None
        text_hidden = False
        found = None
        for _ in range(LIMIT):
            if not queue:
                break
            node = queue.popleft()
            role = node.get_role()
            states = node.get_state_set()
            if mode == 'selection':
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
                        end = min(span.end_offset, span.start_offset + SELECTION_LIMIT + 1)
                        # Chromium shows each child element as U+FFFC in its parent's text. A
                        # selection that is only those is read from the children further down.
                        text = Atspi.Text.get_text(node, span.start_offset, end).replace('￼', '')
                        if text.strip():
                            found = dict(text=text, editable=states.contains(Atspi.StateType.EDITABLE))
            elif mode == 'paste':
                if states.contains(Atspi.StateType.FOCUSED):
                    if states.contains(Atspi.StateType.EDITABLE) or role == Atspi.Role.PASSWORD_TEXT:
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
            return found
        if mode == 'paste':
            # A search cut short by the limit can't tell that no field has focus.
            return dict(editable=False) if focused_page and not queue else None
        return dict(url=url) if url and mode == 'context' else None

print(json.dumps(read_field(int(sys.argv[1]), sys.argv[2], len(sys.argv) > 3 and sys.argv[3] == 'browser') or {}, ensure_ascii=False))
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
