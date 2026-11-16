// Yap Yap's Windows keyboard hook. It swallows the keys Yap Yap owns (Right Alt and the
// keys that complete a shortcut with it) so other apps never see them, masks Alt and the
// Windows key for Yap Yap's other shortcuts, and reports every key to Yap Yap. The hook thread decides on its own and never waits for JavaScript: a
// slow hook delays all typing, and Windows drops hooks that take too long.
#include <windows.h>
#include <condition_variable>
#include <deque>
#include <future>
#include <memory>
#include <mutex>
#include <set>
#include <thread>

typedef void (*KeyCallback)(int down, int code, unsigned time);

namespace {

const int kRightAlt = 0xE38;
const int kLeftCtrl = 0x1D;
const DWORD kAltGrCtrlScan = 0x21D;
// Tracks the AltGr fake Ctrl apart from the real left Ctrl.
const int kAltGrCtrlId = -kLeftCtrl;
// Tells Yap Yap that every key was released behind its back.
const int kResetCode = -1;

std::mutex keysLock;
std::set<int> leads, chords;
// Keys whose key-down was swallowed. Their repeats and key-up are swallowed too, and
// nothing else is, so Windows never sees a key go down without coming back up.
std::set<int> swallowedDowns;
// Keys that complete a Yap Yap shortcut with Alt or the Windows key. Releasing those alone
// opens the focused app's menu or the Start menu; a key in between prevents it.
std::set<int> maskKeys;
std::set<int> heldMenuKeys, heldMaskKeys;
const int kMenuKeys[] = {0x38, kRightAlt, 0xE5B, 0xE5C};

// One per start. A notifier from an earlier start may still be waiting for JavaScript,
// so it keeps its own queue and stop flag and can never take this start's events.
struct Event { int down; int code; unsigned time; };
struct Channel {
  std::mutex lock;
  std::condition_variable ready;
  std::deque<Event> events;
  bool stopping = false;
};
std::mutex channelLock;
std::shared_ptr<Channel> channel;
KeyCallback callback = nullptr;

HHOOK hook = nullptr;
HWINEVENTHOOK desktopHook = nullptr;
DWORD hookThreadId = 0;
std::thread hookThread;

int codeOf(DWORD scan, DWORD flags) {
  if (scan == kAltGrCtrlScan) return kLeftCtrl;
  const int low = static_cast<int>(scan & 0xFF);
  if (!(flags & LLKHF_EXTENDED)) return low;
  // uiohook gives the arrow keys a different prefix, and NumLock and Right Shift
  // (which Windows marks as extended) none.
  if (low == 0x48 || low == 0x4B || low == 0x4D || low == 0x50) return 0xE000 | low;
  if (low == 0x45 || low == 0x36) return low;
  return 0xE00 | low;
}

bool swallow(bool down, DWORD scan, DWORD flags) {
  if (flags & LLKHF_INJECTED) return false;
  const int code = codeOf(scan, flags);
  const int id = scan == kAltGrCtrlScan ? kAltGrCtrlId : code;
  std::lock_guard<std::mutex> guard(keysLock);
  if (!down) return swallowedDowns.erase(id) > 0;
  if (swallowedDowns.count(id)) return true;  // a repeat
  bool leadHeld = false;
  for (int lead : leads) leadHeld = leadHeld || swallowedDowns.count(lead) > 0;
  const bool owned =
      leads.count(code) > 0 ||
      // AltGr layouts send a fake left Ctrl just before Right Alt.
      (scan == kAltGrCtrlScan && leads.count(kRightAlt) > 0) ||
      (leadHeld && chords.count(code) > 0);
  if (owned) swallowedDowns.insert(id);
  return owned;
}

// -1 asks Windows; tests set 0 or 1 because no key is really down while they run.
int menuKeyDownOverride = -1;

// The hook misses key-ups sent to windows running as administrator, so Windows' own key
// state confirms Alt or the Windows key is still down before masking.
bool menuKeyPhysicallyDown() {
  if (menuKeyDownOverride >= 0) return menuKeyDownOverride != 0;
  for (int vk : {VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN}) {
    if (GetAsyncKeyState(vk) & 0x8000) return true;
  }
  return false;
}

bool isMenuKey(int code) {
  for (int key : kMenuKeys) if (key == code) return true;
  return false;
}

// True on the first real press of a mask key while Alt or the Windows key is held.
bool shouldMask(bool down, DWORD scan, DWORD flags) {
  if (flags & LLKHF_INJECTED) return false;
  const int code = codeOf(scan, flags);
  std::lock_guard<std::mutex> guard(keysLock);
  if (isMenuKey(code)) {
    if (down) heldMenuKeys.insert(code);
    else heldMenuKeys.erase(code);
    return false;
  }
  if (!maskKeys.count(code)) return false;
  if (!down) {
    heldMaskKeys.erase(code);
    return false;
  }
  if (!heldMaskKeys.insert(code).second) return false;  // a repeat
  if (heldMenuKeys.empty()) return false;
  if (!menuKeyPhysicallyDown()) {
    heldMenuKeys.clear();
    return false;
  }
  return true;
}

// F24 is on no keyboard and bound by no app, so tapping it does nothing else.
void sendMask() {
  INPUT inputs[2] = {};
  inputs[0].type = inputs[1].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = inputs[1].ki.wVk = VK_F24;
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
  SendInput(2, inputs, sizeof(INPUT));
}

void post(int down, int code, unsigned time) {
  std::shared_ptr<Channel> target;
  {
    std::lock_guard<std::mutex> guard(channelLock);
    target = channel;
  }
  if (!target) return;
  {
    std::lock_guard<std::mutex> guard(target->lock);
    target->events.push_back({down, code, time});
  }
  target->ready.notify_one();
}

// The secure desktop (Ctrl+Alt+Del, UAC, the lock screen) takes the keyboard without
// sending key-ups to this hook, so held keys are forgotten when it appears.
void forgetHeldKeys() {
  {
    std::lock_guard<std::mutex> guard(keysLock);
    swallowedDowns.clear();
    heldMenuKeys.clear();
    heldMaskKeys.clear();
  }
  post(0, kResetCode, GetTickCount());
}

LRESULT CALLBACK hookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  const auto* key = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
  // Simulated keys (Yap Yap's own paste and menu mask) are neither swallowed nor
  // reported: they carry no scan code and are never a shortcut press.
  if (nCode == HC_ACTION && !(key->flags & LLKHF_INJECTED)) {
    const bool down = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
    if (shouldMask(down, key->scanCode, key->flags)) sendMask();
    const bool swallowed = swallow(down, key->scanCode, key->flags);
    post(down ? 1 : 0, codeOf(key->scanCode, key->flags), static_cast<unsigned>(key->time));
    if (swallowed) return 1;
  }
  return CallNextHookEx(hook, nCode, wParam, lParam);
}

void CALLBACK desktopSwitched(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD, DWORD) {
  forgetHeldKeys();
}

void notify(std::shared_ptr<Channel> own) {
  for (;;) {
    Event event;
    {
      std::unique_lock<std::mutex> guard(own->lock);
      own->ready.wait(guard, [&] { return own->stopping || !own->events.empty(); });
      if (own->stopping) return;
      event = own->events.front();
      own->events.pop_front();
    }
    if (callback) callback(event.down, event.code, event.time);
  }
}

}  // namespace

extern "C" {

__declspec(dllexport) void yk_set_keys(const int* leadCodes, int leadCount, const int* chordCodes, int chordCount) {
  std::lock_guard<std::mutex> guard(keysLock);
  leads.clear();
  chords.clear();
  for (int i = 0; i < leadCount; i++) leads.insert(leadCodes[i]);
  for (int i = 0; i < chordCount; i++) chords.insert(chordCodes[i]);
  // Keys already swallowed stay tracked so their key-ups are swallowed as well.
}

__declspec(dllexport) void yk_set_mask_keys(const int* codes, int count) {
  std::lock_guard<std::mutex> guard(keysLock);
  maskKeys.clear();
  for (int i = 0; i < count; i++) maskKeys.insert(codes[i]);
}

// The callback must stay valid for the life of the process: a notifier from an earlier
// start may still call it after yk_stop.
__declspec(dllexport) int yk_start(KeyCallback cb) {
  if (hookThread.joinable()) return 1;
  callback = cb;
  auto own = std::make_shared<Channel>();
  {
    std::lock_guard<std::mutex> guard(channelLock);
    channel = own;
  }
  std::thread(notify, own).detach();
  std::promise<bool> started;
  std::future<bool> result = started.get_future();
  hookThread = std::thread([&started] {
    MSG msg;
    // Creates this thread's message queue before anyone posts WM_QUIT to it.
    PeekMessageW(&msg, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
    hookThreadId = GetCurrentThreadId();
    HMODULE module = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&hookProc), &module);
    hook = SetWindowsHookExW(WH_KEYBOARD_LL, hookProc, module, 0);
    desktopHook = SetWinEventHook(EVENT_SYSTEM_DESKTOPSWITCH, EVENT_SYSTEM_DESKTOPSWITCH, nullptr,
                                  desktopSwitched, 0, 0, WINEVENT_OUTOFCONTEXT);
    const bool ok = hook != nullptr;
    started.set_value(ok);
    if (ok) {
      while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
      }
      UnhookWindowsHookEx(hook);
    }
    if (desktopHook) UnhookWinEvent(desktopHook);
    hook = nullptr;
    desktopHook = nullptr;
  });
  if (result.get()) return 1;
  hookThread.join();
  {
    std::lock_guard<std::mutex> guard(channelLock);
    channel.reset();
  }
  {
    std::lock_guard<std::mutex> guard(own->lock);
    own->stopping = true;
  }
  own->ready.notify_all();
  return 0;
}

__declspec(dllexport) void yk_stop() {
  if (hookThread.joinable()) {
    PostThreadMessageW(hookThreadId, WM_QUIT, 0, 0);
    hookThread.join();
  }
  std::shared_ptr<Channel> own;
  {
    std::lock_guard<std::mutex> guard(channelLock);
    own.swap(channel);
  }
  if (!own) return;
  {
    std::lock_guard<std::mutex> guard(own->lock);
    own->stopping = true;
    own->events.clear();
  }
  // The notifier may be waiting for JavaScript on this very thread, so it is not joined.
  own->ready.notify_all();
}

__declspec(dllexport) int yk_test_event(int down, int scan, int flags) {
  return swallow(down != 0, static_cast<DWORD>(scan), static_cast<DWORD>(flags)) ? 1 : 0;
}

__declspec(dllexport) int yk_test_mask(int down, int scan, int flags) {
  return shouldMask(down != 0, static_cast<DWORD>(scan), static_cast<DWORD>(flags)) ? 1 : 0;
}

__declspec(dllexport) void yk_test_set_menu_key_down(int down) {
  menuKeyDownOverride = down;
}

__declspec(dllexport) int yk_test_code(int scan, int flags) {
  return codeOf(static_cast<DWORD>(scan), static_cast<DWORD>(flags));
}

__declspec(dllexport) void yk_test_desktop_switch() {
  forgetHeldKeys();
}

__declspec(dllexport) void yk_test_reset() {
  std::lock_guard<std::mutex> guard(keysLock);
  swallowedDowns.clear();
  heldMenuKeys.clear();
  heldMaskKeys.clear();
}

}  // extern "C"
