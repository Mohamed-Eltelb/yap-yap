// AT-SPI exposes Unicode character offsets and stable object paths on the desktop bus.
// The system Python uses the distro's PyGObject and AT-SPI bindings.
export const linuxContextProbe = String.raw`
import json
import sys
from collections import deque
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

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
        for _ in range(600):
            if not queue:
                return dict(editable=False) if focused_page else None
            node = queue.popleft()
            if mode == 'paste':
                states = node.get_state_set()
                if states.contains(Atspi.StateType.FOCUSED):
                    if states.contains(Atspi.StateType.EDITABLE) or node.get_role() == Atspi.Role.PASSWORD_TEXT:
                        return dict(editable=True)
                    if node.get_role() in (Atspi.Role.DOCUMENT_WEB, Atspi.Role.DOCUMENT_FRAME):
                        focused_page = True
            elif node.get_role() == Atspi.Role.PASSWORD_TEXT:
                continue
            states = node.get_state_set()
            if mode != 'paste' and states.contains(Atspi.StateType.FOCUSED) and states.contains(Atspi.StateType.EDITABLE) and node.is_text():
                attrs = node.get_attributes()
                if attrs.get('text-input-type', '').lower() == 'password':
                    return
                # Address bars can contain private URLs. Never treat one as editor context.
                label = (node.get_name() or '').lower()
                if 'address bar' in label or 'address and search' in label or 'search or enter address' in label or attrs.get('id') in ('urlbar-input', 'addressEditBox'):
                    return
                caret = node.get_caret_offset()
                count = node.get_character_count()
                if not 0 <= caret <= count or node.get_n_selections() > 0:
                    return
                if mode == 'field':
                    return dict(field=str(pid) + ':' + node.path, text=Atspi.Text.get_text(node, max(0, caret-3000), min(count, caret+3000)))
                return dict(textBefore=Atspi.Text.get_text(node, max(0, caret-240), caret), textAfter=Atspi.Text.get_text(node, caret, min(count, caret+120)))
            for i in range(min(node.get_child_count(), 600-len(queue))):
                child = node.get_child_at_index(i)
                if child:
                    queue.append(child)

print(json.dumps(read_field(int(sys.argv[1]), sys.argv[2]) or {}, ensure_ascii=False))
`;
