// Sway's virtual keyboard can send a normal clipboard paste when the editor
// exposes its text over AT-SPI and no IBus service can deliver the edit.
export const linuxWaylandPaste = String.raw`
def paste_with_sway(text, still_selected, inserted):
    import os
    import shutil
    import signal
    import subprocess
    import time

    if not os.environ.get('SWAYSOCK') or not all(shutil.which(tool) for tool in ('wl-copy', 'wl-paste', 'wtype')):
        return False

    def command(args, data=None):
        return subprocess.run(args, input=data, capture_output=True, timeout=.6, check=False)

    def clipboard():
        listing = command(['wl-paste', '--list-types'])
        types = set(listing.stdout.splitlines())
        if listing.returncode:
            if listing.stderr.strip() == b'Nothing is copied':
                return None
            raise ValueError('Clipboard unavailable')
        # The temporary paste can restore a plain-text clipboard. Leave richer
        # clipboard contents alone, including items that also advertise text.
        if not types or not types <= {b'text/plain', b'text/plain;charset=utf-8', b'UTF8_STRING', b'STRING', b'TEXT'}:
            raise ValueError('Clipboard is not plain text')
        result = command(['wl-paste', '--no-newline'])
        if result.returncode:
            raise ValueError('Clipboard read failed')
        return result.stdout

    def copy(data):
        if data is None:
            return command(['wl-copy', '--clear']).returncode == 0
        # A clipboard owner outlives this command. Avoid pipes inherited by the owner.
        result = subprocess.run(['wl-copy', '--type', 'text/plain;charset=utf-8'], input=data,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=.6, check=False)
        return result.returncode == 0

    def terminate(_signum, _frame):
        raise SystemExit(1)

    payload = text.encode('utf-8')
    owned = False
    previous_handler = signal.signal(signal.SIGTERM, terminate)
    try:
        previous = clipboard()
        if not still_selected() or clipboard() != previous or not copy(payload):
            return False
        owned = True
        if not still_selected() or clipboard() != payload:
            return False
        sent = command(['wtype', '-M', 'ctrl', '-k', 'v', '-m', 'ctrl'])
        if sent.returncode:
            return False
        deadline = time.monotonic() + .55
        while time.monotonic() < deadline:
            if inserted():
                return True
            time.sleep(.02)
        return False
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False
    finally:
        if owned:
            try:
                if clipboard() == payload:
                    copy(previous)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                pass
        signal.signal(signal.SIGTERM, previous_handler)
`;
