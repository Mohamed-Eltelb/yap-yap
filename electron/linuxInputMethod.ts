// Included in the AT-SPI probe so the same accessible field can be checked before and after delivery.
export const linuxInputMethod = String.raw`
def commit_with_ibus(node, text, start, end, old, count):
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

    name = 'yapyap-' + str(os.getpid())
    focused = None
    focus_id_seen = False
    unidentified_focus = False
    engine_seq = 0
    class Engine(IBus.Engine):
        def do_focus_in(self):
            nonlocal unidentified_focus
            unidentified_focus = True

        def do_focus_in_id(self, path, client):
            nonlocal focused, focus_id_seen
            focus_id_seen = True
            # The compositor's input-method bridge follows its text-input seat ('wayland'
            # for ibus-wayland, 'gnome-shell' for GNOME/Mutter). A toolkit client or the
            # daemon's dummy context could belong to another app.
            focused = self if path == context and client in ('wayland', 'gnome-shell') else None

        def do_focus_out(self):
            nonlocal focused
            focused = None

        def do_focus_out_id(self, path):
            nonlocal focused
            focused = None

    connection = bus.get_connection()
    factory = IBus.Factory.new(connection)
    def create_engine(factory, requested):
        nonlocal engine_seq
        if requested == name:
            engine_seq += 1
            return Engine(connection=connection, object_path='/org/freedesktop/IBus/YapYapEngine/' + str(engine_seq), has_focus_id=True)
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
        while switched and not focus_id_seen and not unidentified_focus and time.monotonic() < deadline:
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
        if not switched or not focused or bus.current_input_context() != context or not still_focused():
            return False
        if selection_offsets(node) != (start, end) or node.get_character_count() != count:
            return False
        if end > start and Atspi.Text.get_text(node, start, end) != old:
            return False
        focused.commit_text(IBus.Text.new_from_string(text))
        deadline = time.monotonic() + .5
        while time.monotonic() < deadline:
            dispatch()
            node.clear_cache()
            if (node.get_character_count() == count - (end - start) + len(text)
                    and Atspi.Text.get_text(node, start, start + len(text)) == text
                    and selection_offsets(node) == (start + len(text), start + len(text))):
                return True
        return False
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
`;
