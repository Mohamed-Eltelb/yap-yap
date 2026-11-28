// A temporary input method for the active Wayland text-input client.
export const linuxInputMethod = String.raw`
def with_ibus(operation, surrounding=False):
    import os
    import signal
    import time
    try:
        gi.require_version('IBus', '1.0')
        from gi.repository import GLib, IBus
    except (ValueError, ImportError):
        return False
    IBus.init()
    bus = IBus.Bus.new()
    if not bus.is_connected():
        return False
    context = bus.current_input_context()
    previous = bus.get_global_engine()
    # Switching away from an input method mid-composition could discard unfinished text.
    if not context or not previous or not previous.get_name().startswith('xkb:'):
        return False

    name = 'yapyap-' + str(os.getpid())
    focused = None
    lost_focus = False
    focus_id_seen = unidentified_focus = False
    engine_seq = 0
    class Engine(IBus.Engine):
        private = None
        snapshot = None
        updated = 0.0

        def commit_string(self, text):
            self.commit_text(IBus.Text.new_from_string(text))

        def do_reset(self):
            self.snapshot = None

        def do_set_content_type(self, purpose, hints):
            private_hints = int(IBus.InputHints.PRIVATE) | int(getattr(IBus.InputHints, 'SENSITIVE', 0))
            private = purpose in (IBus.InputPurpose.PASSWORD, IBus.InputPurpose.PIN) or bool(int(hints) & private_hints)
            if self.private != private:
                self.snapshot = None
            # Once a password or PIN appears, discard this request even if focus changes back.
            self.private = bool(self.private or private)

        def do_set_surrounding_text(self, value, cursor, anchor):
            # Some toolkits send surrounding text even for a password field. Only
            # unpack it after the compositor has explicitly identified a normal field.
            if surrounding and focused is self and self.private is False:
                self.snapshot = None
                text = value.get_text()
                if 0 <= cursor <= len(text) and 0 <= anchor <= len(text):
                    self.snapshot = text, cursor, anchor
                    self.updated = time.monotonic()

        def do_focus_in(self):
            nonlocal unidentified_focus
            unidentified_focus = True

        def do_focus_out(self):
            self.do_focus_out_id(context)

        def do_focus_in_id(self, path, client):
            nonlocal focused, focus_id_seen
            focus_id_seen = True
            # The compositor's input-method bridge follows its text-input seat. A
            # toolkit client or the daemon's dummy context could belong to another app.
            compositor = client in ('wayland', 'gnome-shell')
            focused = self if compositor and not lost_focus and path == context else None
            if focused and surrounding:
                self.get_surrounding_text()

        def do_focus_out_id(self, path):
            nonlocal focused, lost_focus
            if focused is self:
                lost_focus = True
                focused = None
            self.private = self.snapshot = None

    connection = bus.get_connection()
    factory = IBus.Factory.new(connection)
    def create_engine(factory, requested):
        nonlocal engine_seq
        if requested == name:
            engine_seq += 1
            options = {}
            if surrounding and Engine.find_property('active-surrounding-text'):
                options['active_surrounding_text'] = True
            return Engine(connection=connection, object_path='/org/freedesktop/IBus/YapYapEngine/' + str(engine_seq), has_focus_id=True, **options)
    factory.connect('create-engine', create_engine)
    component = IBus.Component.new('org.freedesktop.IBus.YapYap' + str(os.getpid()), 'Yap Yap', '1', 'MIT', 'Yap Yap', '', '', '')
    component.add_engine(IBus.EngineDesc.new(name, 'Yap Yap', 'Insert text', 'und', 'MIT', 'Yap Yap', '', 'default'))

    # Service the factory on this thread while the daemon switches engines.
    def set_engine(target):
        loop = GLib.MainLoop()
        ok = False
        def ready(bus, result):
            nonlocal ok
            try:
                ok = bus.set_global_engine_async_finish(result)
            finally:
                loop.quit()
        bus.set_global_engine_async(target, 1000, None, ready)
        loop.run()
        return ok

    # execFile uses SIGTERM when the probe times out. Let the finally block run.
    def terminate(signum, frame):
        raise SystemExit(1)
    signal.signal(signal.SIGTERM, terminate)
    try:
        if not bus.register_component(component):
            return False
        switched = set_engine(name)
        events = GLib.MainContext.default()
        def dispatch():
            while events.pending():
                events.iteration(False)
            time.sleep(.01)
        deadline = time.monotonic() + .35
        # GNOME can deliver FocusInId shortly after an ordinary FocusIn. Give it
        # time before switching engines again, which would discard that focus.
        while switched and not focus_id_seen and time.monotonic() < deadline:
            dispatch()
        # On a brand-new engine name, ibus-daemon calls FocusIn before its async
        # Get("FocusId") reply populates its focus-id cache. Bounce once so the
        # daemon delivers FocusInId(path, client) and we can verify the compositor client.
        if switched and not focus_id_seen and unidentified_focus:
            set_engine(previous.get_name())
            switched = set_engine(name)
            deadline = time.monotonic() + .35
            while switched and not focus_id_seen and time.monotonic() < deadline:
                dispatch()
        if not switched or not focused or bus.current_input_context() != context:
            return False
        engine = focused
        def wait_for(condition):
            deadline = time.monotonic() + .5
            while time.monotonic() < deadline:
                dispatch()
                if focused is not engine or engine.private:
                    return False
                if condition():
                    return True
            return False
        if engine.private:
            return False
        return operation(engine, wait_for)
    finally:
        current = bus.get_global_engine()
        restore = current.get_name() if current else previous.get_name()
        if restore == name:
            restore = previous.get_name()
        owner = connection.get_unique_name()
        connection.close_sync(None)
        # Unregistering the temporary component can clear even a restored engine.
        # Reconnect after the factory has gone away, then restore the user's engine.
        bus.destroy()
        bus = IBus.Bus.new()
        deadline = time.monotonic() + .35
        while bus.name_has_owner(owner) and time.monotonic() < deadline:
            time.sleep(.01)
        current = bus.get_global_engine()
        if restore and (not current or current.get_name() != restore):
            bus.set_global_engine(restore)


def commit_with_ibus(node, text, start, end, old, count):
    # A compositor may keep the same IBus context as focus moves between windows.
    # Recheck the original field and its selection just before asking the client to commit.
    def still_focused():
        parent = node
        for _ in range(LIMIT):
            if not parent:
                break
            parent.clear_cache()
            if parent == node:
                states = node.get_state_set()
                if not states.contains(Atspi.StateType.FOCUSED) or not states.contains(Atspi.StateType.EDITABLE):
                    return False
                if node.get_role() == Atspi.Role.PASSWORD_TEXT or (node.get_attributes() or {}).get('text-input-type', '').lower() == 'password':
                    return False
            if parent.get_state_set().contains(Atspi.StateType.ACTIVE):
                return True
            parent = parent.get_parent()
        return False

    def commit(engine, wait_for):
        if not still_focused() or selection_offsets(node) != (start, end) or node.get_character_count() != count:
            return False
        if end > start and Atspi.Text.get_text(node, start, end) != old:
            return False
        engine.commit_string(text)
        caret = start + len(text)
        def inserted():
            node.clear_cache()
            return (node.get_character_count() == count - (end - start) + len(text)
                    and Atspi.Text.get_text(node, start, caret) == text and selection_offsets(node) == (caret, caret))
        return wait_for(inserted)
    return with_ibus(commit)

def input_method_field(mode):
    import time
    def read_or_insert(engine, wait_for):
        # A bridge can first report the old caret and then the new selection.
        def ready():
            if engine.snapshot is None or time.monotonic() - engine.updated < .04:
                return False
            return mode == 'insert' or engine.snapshot[1] != engine.snapshot[2]
        if not wait_for(ready):
            return False
        old, cursor, anchor = engine.snapshot
        start, end = sorted((cursor, anchor))
        # Wayland text-input carries at most 4000 bytes of context. At the boundary,
        # rounding to a complete UTF-8 character can remove up to three more bytes.
        if len(old.encode('utf-8')) >= 3997 and (start == 0 or end == len(old)):
            return False
        if mode == 'selection':
            return dict(text=old[start:end], editable=True) if end > start else None
        text = sys.stdin.read()
        expected = old[:start] + text + old[end:]
        if not text or len(expected.encode('utf-8')) >= 3997:
            return False
        engine.snapshot = None
        engine.commit_string(text)
        caret = start + len(text)
        return dict(inserted=wait_for(lambda: engine.snapshot == (expected, caret, caret)))
    return with_ibus(read_or_insert, surrounding=True)
`;
