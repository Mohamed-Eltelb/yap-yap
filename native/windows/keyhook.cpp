// Yap Yap's Windows keyboard hook. It swallows the keys Yap Yap owns (Right Alt and the
// keys that complete a shortcut with it) so other apps never see them, and reports every
// key to Yap Yap. The hook thread decides on its own and never waits for JavaScript: a
// slow hook delays all typing, and Windows drops hooks that take too long.
#include <windows.h>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <set>
#include <thread>

typedef void (*KeyCallback)(int down, int code, unsigned time);

namespace {

const int kRightAlt = 0xE38;
const int kLeftCtrl = 0x1D;
const DWORD kAltGrCtrlScan = 0x21D;

struct Event { int down; int code; unsigned time; };

std::mutex keysLock;
std::set<int> leads, chords;
// Only touched by the hook thread (or by tests, with no hook running).
std::set<int> heldLeads, swallowedDowns;

std::mutex queueLock;
std::condition_variable queueReady;
std::deque<Event> queue;
KeyCallback callback = nullptr;
bool stopping = false;

HHOOK hook = nullptr;
DWORD hookThreadId = 0;
std::thread hookThread, notifierThread;

int codeOf(DWORD scan, DWORD flags) {
  if (scan == kAltGrCtrlScan) return kLeftCtrl;
  return static_cast<int>(scan & 0xFF) | ((flags & LLKHF_EXTENDED) ? 0xE00 : 0);
}

bool swallow(bool down, DWORD scan, DWORD flags) {
  if (flags & LLKHF_INJECTED) return false;
  const int code = codeOf(scan, flags);
  std::lock_guard<std::mutex> guard(keysLock);
  if (leads.count(code)) {
    if (down) heldLeads.insert(code); else heldLeads.erase(code);
    return true;
  }
  // AltGr layouts send a fake left Ctrl just before Right Alt.
  if (scan == kAltGrCtrlScan && leads.count(kRightAlt)) return true;
  if (down && !heldLeads.empty() && chords.count(code)) {
    swallowedDowns.insert(code);
    return true;
  }
  if (!down && swallowedDowns.erase(code)) return true;
  return false;
}

LRESULT CALLBACK hookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  const auto* key = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
  // Simulated keys (Yap Yap's own paste and menu mask) are neither swallowed nor
  // reported: they carry no scan code and are never a shortcut press.
  if (nCode == HC_ACTION && !(key->flags & LLKHF_INJECTED)) {
    const bool down = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
    const bool swallowed = swallow(down, key->scanCode, key->flags);
    {
      std::lock_guard<std::mutex> guard(queueLock);
      queue.push_back({down ? 1 : 0, codeOf(key->scanCode, key->flags), static_cast<unsigned>(key->time)});
    }
    queueReady.notify_one();
    if (swallowed) return 1;
  }
  return CallNextHookEx(hook, nCode, wParam, lParam);
}

void notify() {
  for (;;) {
    Event event;
    KeyCallback target;
    {
      std::unique_lock<std::mutex> guard(queueLock);
      queueReady.wait(guard, [] { return stopping || !queue.empty(); });
      if (stopping) return;
      event = queue.front();
      queue.pop_front();
      target = callback;
    }
    if (target) target(event.down, event.code, event.time);
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
  heldLeads.clear();
  swallowedDowns.clear();
}

__declspec(dllexport) int yk_start(KeyCallback cb) {
  if (hookThread.joinable()) return 1;
  {
    std::lock_guard<std::mutex> guard(queueLock);
    callback = cb;
    stopping = false;
    queue.clear();
  }
  notifierThread = std::thread(notify);
  std::mutex startLock;
  std::condition_variable started;
  int result = -1;
  hookThread = std::thread([&] {
    MSG msg;
    // Creates this thread's message queue before anyone posts WM_QUIT to it.
    PeekMessageW(&msg, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
    HMODULE module = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&hookProc), &module);
    hook = SetWindowsHookExW(WH_KEYBOARD_LL, hookProc, module, 0);
    {
      std::lock_guard<std::mutex> guard(startLock);
      hookThreadId = GetCurrentThreadId();
      result = hook ? 1 : 0;
    }
    started.notify_one();
    if (!hook) return;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    UnhookWindowsHookEx(hook);
    hook = nullptr;
  });
  std::unique_lock<std::mutex> guard(startLock);
  started.wait(guard, [&] { return result != -1; });
  if (result == 1) return 1;
  guard.unlock();
  hookThread.join();
  {
    std::lock_guard<std::mutex> queueGuard(queueLock);
    stopping = true;
  }
  queueReady.notify_all();
  notifierThread.detach();
  return 0;
}

__declspec(dllexport) void yk_stop() {
  if (hookThread.joinable()) {
    PostThreadMessageW(hookThreadId, WM_QUIT, 0, 0);
    hookThread.join();
  }
  {
    std::lock_guard<std::mutex> guard(queueLock);
    stopping = true;
    callback = nullptr;
    queue.clear();
  }
  queueReady.notify_all();
  // The notifier may be waiting for JavaScript on this very thread, so it is not joined.
  if (notifierThread.joinable()) notifierThread.detach();
}

__declspec(dllexport) int yk_test_event(int down, int scan, int flags) {
  return swallow(down != 0, static_cast<DWORD>(scan), static_cast<DWORD>(flags)) ? 1 : 0;
}

__declspec(dllexport) void yk_test_reset() {
  std::lock_guard<std::mutex> guard(keysLock);
  heldLeads.clear();
  swallowedDowns.clear();
}

}  // extern "C"
