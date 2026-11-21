// AT-SPI exposes Unicode character offsets and stable object paths on the desktop bus.
// The system Python uses the distro's PyGObject and AT-SPI bindings.
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

def in_toolbar(node):
    # Browser address bars sit in a toolbar. Checking the structure, not the label, works in every UI language.
    parent = node.get_parent()
    for _ in range(64):
        if not parent:
            return False
        if parent.get_role() == Atspi.Role.TOOL_BAR:
            return True
        parent = parent.get_parent()
    return False

def read_field(pid, mode):
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
        # Breadth-first order reaches the page document before any field inside it.
        url = None
        for _ in range(LIMIT):
            if not queue:
                break
            node = queue.popleft()
            role = node.get_role()
            states = node.get_state_set()
            if mode == 'paste':
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
                if states.contains(Atspi.StateType.FOCUSED) and states.contains(Atspi.StateType.EDITABLE) and node.get_text_iface() is not None:
                    attrs = node.get_attributes() or {}
                    if attrs.get('text-input-type', '').lower() == 'password':
                        return
                    page = dict(url=url) if url and mode == 'context' else None
                    # Address bars can contain private URLs. Never treat one as editor context.
                    if in_toolbar(node) or attrs.get('id') in ('urlbar-input', 'addressEditBox'):
                        return page
                    caret = node.get_caret_offset()
                    count = node.get_character_count()
                    if not 0 <= caret <= count or node.get_n_selections() > 0:
                        return page
                    if mode == 'field':
                        return dict(field=str(pid) + ':' + node.path, text=Atspi.Text.get_text(node, max(0, caret-3000), min(count, caret+3000)))
                    return dict(url=url, textBefore=Atspi.Text.get_text(node, max(0, caret-240), caret), textAfter=Atspi.Text.get_text(node, caret, min(count, caret+120)))
            for i in range(min(node.get_child_count(), LIMIT - len(queue))):
                child = node.get_child_at_index(i)
                if child:
                    queue.append(child)
        if mode == 'paste':
            # A search cut short by the limit can't tell that no field has focus.
            return dict(editable=False) if focused_page and not queue else None
        return dict(url=url) if url and mode == 'context' else None

print(json.dumps(read_field(int(sys.argv[1]), sys.argv[2]) or {}, ensure_ascii=False))
`;
