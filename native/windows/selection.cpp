// Yap Yap's selection reader. It reads the text selected in the app in front through UI
// Automation (or classic Edit messages) inside Yap Yap's own process, says whether that text
// can be typed over, sends clipboard shortcuts with hardware scan codes, and safely saves/restores
// Win32 clipboard formats without polluting Windows Clipboard History.
#include <windows.h>
#include <UIAutomation.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <cwctype>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

constexpr int kFlagEditable = 1;
constexpr int kFlagPassword = 2;
constexpr int kFlagFieldWritable = 4;
constexpr int kFlagFieldReadOnly = 8;
constexpr int kFlagInTerminal = 16;
constexpr int kFlagUiaOpaque = 32;
constexpr int kFlagReadOnlyDocument = 64;
constexpr ULONG_PTR kYapYapExtraInfo = 0x59415059;  // "YAPY"

constexpr size_t kMaxFormatBytes = 8 * 1024 * 1024;
constexpr size_t kMaxTotalSnapshotBytes = 24 * 1024 * 1024;

std::mutex automationLock;
IUIAutomation* automation = nullptr;

// One automation object for the whole process, in the multithreaded apartment, so every
// worker thread can use it.
IUIAutomation* Automation() {
  std::lock_guard<std::mutex> lock(automationLock);
  if (automation) return automation;
  IUIAutomation* created = nullptr;
  if (FAILED(CoCreateInstance(__uuidof(CUIAutomation8), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&created)))) {
    if (FAILED(CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&created)))) return nullptr;
  }
  // An app that stops answering would otherwise hold the worker thread for good.
  IUIAutomation2* withTimeouts = nullptr;
  if (SUCCEEDED(created->QueryInterface(IID_PPV_ARGS(&withTimeouts)))) {
    withTimeouts->put_ConnectionTimeout(800);
    withTimeouts->put_TransactionTimeout(1200);
    withTimeouts->Release();
  }
  automation = created;
  return automation;
}

template <typename T> void Release(T*& object) {
  if (object) object->Release();
  object = nullptr;
}

std::wstring ToLower(std::wstring s) {
  for (wchar_t& ch : s) ch = static_cast<wchar_t>(std::towlower(ch));
  return s;
}

bool ContainsInsensitive(const std::wstring& haystack, const wchar_t* needle) {
  if (haystack.empty() || !needle || !*needle) return false;
  return ToLower(haystack).find(ToLower(needle)) != std::wstring::npos;
}

std::wstring ProcessName(int pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
  if (!process) return L"";
  wchar_t path[MAX_PATH * 2];
  DWORD size = ARRAYSIZE(path);
  std::wstring name;
  if (QueryFullProcessImageNameW(process, 0, path, &size)) {
    name.assign(path, size);
    size_t slash = name.find_last_of(L"\\/");
    if (slash != std::wstring::npos) name = name.substr(slash + 1);
    if (name.size() > 4 && _wcsicmp(name.c_str() + name.size() - 4, L".exe") == 0) name.resize(name.size() - 4);
  }
  CloseHandle(process);
  return name;
}

std::wstring WindowClassName(HWND hwnd) {
  wchar_t name[64] = {};
  if (!hwnd) return L"";
  int len = GetClassNameW(hwnd, name, ARRAYSIZE(name));
  return len > 0 ? std::wstring(name, static_cast<size_t>(len)) : L"";
}

bool HasWindowClass(HWND window, const wchar_t* expected) {
  return window && _wcsicmp(WindowClassName(window).c_str(), expected) == 0;
}

bool IsClassicEditClass(HWND hwnd) {
  const std::wstring cls = WindowClassName(hwnd);
  if (cls.empty()) return false;
  return _wcsicmp(cls.c_str(), L"Edit") == 0
      || _wcsicmp(cls.c_str(), L"RichEdit") == 0
      || _wcsicmp(cls.c_str(), L"RichEdit20W") == 0
      || _wcsicmp(cls.c_str(), L"RichEdit50W") == 0
      || _wcsicmp(cls.c_str(), L"RICHEDIT60W") == 0;
}

bool IsStrictEditClass(HWND hwnd) {
  return hwnd && _wcsicmp(WindowClassName(hwnd).c_str(), L"Edit") == 0;
}

bool IsWebHostWindow(HWND hwnd) {
  const std::wstring cls = WindowClassName(hwnd);
  if (cls.empty()) return false;
  return _wcsicmp(cls.c_str(), L"Chrome_WidgetWin_1") == 0
      || _wcsicmp(cls.c_str(), L"Chrome_WidgetWin_0") == 0
      || _wcsicmp(cls.c_str(), L"Chrome_RenderWidgetHostHWND") == 0
      || _wcsicmp(cls.c_str(), L"MozillaWindowClass") == 0
      || _wcsicmp(cls.c_str(), L"Intermediate D3D Window") == 0
      || _wcsicmp(cls.c_str(), L"ApplicationFrameWindow") == 0;
}

bool IsBrowserProcess(const std::wstring& process) {
  if (process.empty()) return false;
  const wchar_t* browsers[] = {
      L"chrome", L"msedge", L"firefox", L"brave", L"vivaldi", L"opera", L"arc", L"comet", L"zen",
  };
  for (const wchar_t* b : browsers) {
    if (_wcsicmp(process.c_str(), b) == 0) return true;
  }
  return false;
}

HWND FocusedWindow(HWND window) {
  if (!window || GetForegroundWindow() != window) return nullptr;
  GUITHREADINFO info = { sizeof(GUITHREADINFO) };
  DWORD tid = GetWindowThreadProcessId(window, nullptr);
  if (!((tid && GetGUIThreadInfo(tid, &info)) || GetGUIThreadInfo(0, &info))) return nullptr;
  if (!info.hwndFocus) return nullptr;
  if (info.hwndFocus != window && GetAncestor(info.hwndFocus, GA_ROOT) != window) return nullptr;
  return info.hwndFocus;
}

// Inside a cell, Excel focuses EXCEL6. The formula bar is EXCEL< and dialogs can use Edit/RichEdit.
// The worksheet grid is EXCEL7, where Copy would put the active cell on the clipboard without a text highlight.
HWND ExcelCellEditor(HWND window) {
  if (!HasWindowClass(window, L"XLMAIN")) return nullptr;
  HWND focus = FocusedWindow(window);
  if (!focus) return nullptr;
  if (HasWindowClass(focus, L"EXCEL6") && HasWindowClass(GetParent(focus), L"XLDESK")) return focus;
  if (HasWindowClass(focus, L"EXCEL<")) return focus;
  if (IsClassicEditClass(focus)) return focus;
  return nullptr;
}

void WakeAccessibility(HWND window) {
  if (!window) return;
  DWORD_PTR result = 0;
  SendMessageTimeoutW(window, WM_GETOBJECT, 0, 1, SMTO_ABORTIFHUNG, 80, &result);
  HWND focus = FocusedWindow(window);
  if (focus && focus != window) {
    SendMessageTimeoutW(focus, WM_GETOBJECT, 0, 1, SMTO_ABORTIFHUNG, 80, &result);
  }
}

IUIAutomationTextPattern* GetTextPattern(IUIAutomationElement* node) {
  if (!node) return nullptr;
  IUIAutomationTextPattern* pattern = nullptr;
  if (SUCCEEDED(node->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&pattern))) && pattern) {
    return pattern;
  }
  Release(pattern);
  IUIAutomationTextPattern2* pattern2 = nullptr;
  if (SUCCEEDED(node->GetCurrentPatternAs(UIA_TextPattern2Id, IID_PPV_ARGS(&pattern2))) && pattern2) {
    return static_cast<IUIAutomationTextPattern*>(pattern2);
  }
  Release(pattern2);
  return nullptr;
}

// The text pattern of the element, of the nearest ancestor (web page document), or of a direct child.
IUIAutomationTextPattern* TextPatternFor(IUIAutomation* uia, IUIAutomationElement* element, IUIAutomationElement** hostOut) {
  if (hostOut) *hostOut = nullptr;
  if (!uia || !element) return nullptr;
  IUIAutomationTreeWalker* walker = nullptr;
  IUIAutomationElement* root = nullptr;
  uia->get_ControlViewWalker(&walker);
  uia->GetRootElement(&root);
  IUIAutomationTextPattern* pattern = nullptr;
  IUIAutomationElement* node = element;
  node->AddRef();
  for (int depth = 0; node && depth < 12; depth++) {
    pattern = GetTextPattern(node);
    if (pattern) {
      if (hostOut) {
        *hostOut = node;
        node->AddRef();
      }
      break;
    }
    IUIAutomationElement* parent = nullptr;
    if (!walker || FAILED(walker->GetParentElement(node, &parent))) parent = nullptr;
    Release(node);
    node = parent;
    BOOL same = FALSE;
    if (node && root && SUCCEEDED(uia->CompareElements(node, root, &same)) && same) break;
  }
  Release(node);

  // If neither the element nor its ancestors exposed TextPattern, check direct children (up to 8).
  if (!pattern && walker) {
    IUIAutomationElement* child = nullptr;
    if (SUCCEEDED(walker->GetFirstChildElement(element, &child)) && child) {
      for (int count = 0; child && count < 8; count++) {
        pattern = GetTextPattern(child);
        if (pattern) {
          if (hostOut) {
            *hostOut = child;
            child->AddRef();
          }
          Release(child);
          break;
        }
        IUIAutomationElement* next = nullptr;
        if (FAILED(walker->GetNextSiblingElement(child, &next))) next = nullptr;
        Release(child);
        child = next;
      }
      Release(child);
    }
  }

  Release(root);
  Release(walker);
  return pattern;
}

bool LooksLikeTerminalElement(IUIAutomation* uia, IUIAutomationElement* element) {
  if (!uia || !element) return false;
  IUIAutomationTreeWalker* walker = nullptr;
  uia->get_ControlViewWalker(&walker);
  IUIAutomationElement* node = element;
  node->AddRef();
  bool found = false;
  for (int depth = 0; node && depth < 5; depth++) {
    BSTR name = nullptr;
    BSTR autoId = nullptr;
    BSTR cls = nullptr;
    node->get_CurrentName(&name);
    node->get_CurrentAutomationId(&autoId);
    node->get_CurrentClassName(&cls);
    const std::wstring sName = name ? std::wstring(name, SysStringLen(name)) : L"";
    const std::wstring sId = autoId ? std::wstring(autoId, SysStringLen(autoId)) : L"";
    const std::wstring sCls = cls ? std::wstring(cls, SysStringLen(cls)) : L"";
    SysFreeString(name);
    SysFreeString(autoId);
    SysFreeString(cls);

    if (ContainsInsensitive(sName, L"terminal") || ContainsInsensitive(sName, L"xterm") || ContainsInsensitive(sName, L"console")
        || ContainsInsensitive(sId, L"terminal") || ContainsInsensitive(sId, L"xterm") || ContainsInsensitive(sId, L"console")
        || ContainsInsensitive(sCls, L"terminal") || ContainsInsensitive(sCls, L"xterm") || ContainsInsensitive(sCls, L"console")) {
      found = true;
      break;
    }
    IUIAutomationElement* parent = nullptr;
    if (!walker || FAILED(walker->GetParentElement(node, &parent))) break;
    Release(node);
    node = parent;
  }
  Release(node);
  Release(walker);
  return found;
}

bool IsRangeEditable(
    IUIAutomationTextRange* range,
    IUIAutomationElement* element,
    IUIAutomationTextPattern* pattern,
    const std::wstring& processName) {
  VARIANT readOnly;
  VariantInit(&readOnly);
  const HRESULT hr = range->GetAttributeValue(UIA_IsReadOnlyAttributeId, &readOnly);
  if (SUCCEEDED(hr) && readOnly.vt == VT_BOOL) {
    const bool editable = (readOnly.boolVal == VARIANT_FALSE);
    VariantClear(&readOnly);
    return editable;
  }
  VariantClear(&readOnly);

  BOOL enabled = TRUE;
  if (SUCCEEDED(element->get_CurrentIsEnabled(&enabled)) && !enabled) return false;

  IUIAutomationValuePattern* value = nullptr;
  if (SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value) {
    BOOL ro = FALSE;
    const HRESULT vhr = value->get_CurrentIsReadOnly(&ro);
    Release(value);
    if (SUCCEEDED(vhr)) return !ro;
  }
  Release(value);

  CONTROLTYPEID type = 0;
  if (FAILED(element->get_CurrentControlType(&type))) return false;
  if (type == UIA_EditControlTypeId) return true;
  switch (type) {
    case UIA_ButtonControlTypeId:
    case UIA_CheckBoxControlTypeId:
    case UIA_HyperlinkControlTypeId:
    case UIA_ImageControlTypeId:
    case UIA_MenuItemControlTypeId:
    case UIA_RadioButtonControlTypeId:
    case UIA_SliderControlTypeId:
    case UIA_TabItemControlTypeId:
    case UIA_TextControlTypeId:
      return false;
    case UIA_DocumentControlTypeId:
    case UIA_PaneControlTypeId:
    case UIA_CustomControlTypeId:
    case UIA_GroupControlTypeId: {
      if (pattern) {
        IUIAutomationTextRange* doc = nullptr;
        VARIANT docRo;
        VariantInit(&docRo);
        const bool known = SUCCEEDED(pattern->get_DocumentRange(&doc)) && doc
            && SUCCEEDED(doc->GetAttributeValue(UIA_IsReadOnlyAttributeId, &docRo))
            && docRo.vt == VT_BOOL;
        const bool docEditable = known && (docRo.boolVal == VARIANT_FALSE);
        VariantClear(&docRo);
        Release(doc);
        if (known) return docEditable;
      }
      return !IsBrowserProcess(processName);
    }
    default:
      return false;
  }
}

// Distinguish a control that explicitly rejects editing from an app that exposes no field
// or only exposes a read-only document wrapper.
int ReadFieldEditability(IUIAutomationElement* element) {
  BOOL enabled = FALSE;
  if (FAILED(element->get_CurrentIsEnabled(&enabled))) return 0;
  if (!enabled) return kFlagFieldReadOnly;

  IUIAutomationValuePattern* value = nullptr;
  if (SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value) {
    BOOL readOnly = FALSE;
    const HRESULT result = value->get_CurrentIsReadOnly(&readOnly);
    Release(value);
    if (SUCCEEDED(result)) return readOnly ? kFlagFieldReadOnly : kFlagFieldWritable;
  }
  Release(value);

  CONTROLTYPEID type = 0;
  if (FAILED(element->get_CurrentControlType(&type))) return 0;

  IUIAutomationTextPattern* text = GetTextPattern(element);
  if (text) {
    IUIAutomationTextRange* range = nullptr;
    VARIANT readOnly;
    VariantInit(&readOnly);
    const bool known = SUCCEEDED(text->get_DocumentRange(&range)) && range
        && SUCCEEDED(range->GetAttributeValue(UIA_IsReadOnlyAttributeId, &readOnly))
        && readOnly.vt == VT_BOOL;
    const bool isReadOnly = known && (readOnly.boolVal != VARIANT_FALSE);
    VariantClear(&readOnly);
    Release(range);
    Release(text);
    if (known) {
      if (!isReadOnly) return kFlagFieldWritable;
      return type == UIA_DocumentControlTypeId ? kFlagReadOnlyDocument : kFlagFieldReadOnly;
    }
  }

  // Selecting a row, link or button can provide clipboard text without a place to paste.
  switch (type) {
    case UIA_ButtonControlTypeId:
    case UIA_CheckBoxControlTypeId:
    case UIA_DataItemControlTypeId:
    case UIA_HyperlinkControlTypeId:
    case UIA_ImageControlTypeId:
    case UIA_ListItemControlTypeId:
    case UIA_MenuItemControlTypeId:
    case UIA_RadioButtonControlTypeId:
    case UIA_SliderControlTypeId:
    case UIA_TabItemControlTypeId:
    case UIA_TreeItemControlTypeId:
      return kFlagFieldReadOnly;
    case UIA_EditControlTypeId:
      return kFlagFieldWritable;
    case UIA_DocumentControlTypeId:
      return 0;
    default:
      return 0;
  }
}

bool IsElementUiaOpaque(IUIAutomationElement* element) {
  if (!element) return true;
  CONTROLTYPEID type = 0;
  if (FAILED(element->get_CurrentControlType(&type))) return true;
  if (type != UIA_WindowControlTypeId && type != UIA_PaneControlTypeId) return false;

  IUIAutomationValuePattern* value = nullptr;
  const bool hasValue = SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value;
  Release(value);
  if (hasValue) return false;

  IUIAutomationTextPattern* text = GetTextPattern(element);
  if (text) {
    Release(text);
    return false;
  }

  BSTR name = nullptr;
  element->get_CurrentName(&name);
  const bool emptyName = !name || SysStringLen(name) == 0;
  SysFreeString(name);
  return emptyName;
}

bool ReadClassicEditSelection(
    HWND fg,
    std::wstring& outText,
    bool& outEditable,
    bool& outPassword,
    int capacity) {
  HWND focus = FocusedWindow(fg);
  if (!focus || !IsStrictEditClass(focus)) return false;

  const LONG style = GetWindowLongW(focus, GWL_STYLE);
  if ((style & ES_PASSWORD) != 0) {
    outPassword = true;
    return true;
  }

  DWORD start = 0;
  DWORD end = 0;
  DWORD_PTR res = 0;
  if (!SendMessageTimeoutW(
          focus, EM_GETSEL, reinterpret_cast<WPARAM>(&start), reinterpret_cast<LPARAM>(&end),
          SMTO_ABORTIFHUNG, 150, &res)) {
    return false;
  }
  if (end <= start) return false;

  DWORD_PTR totalLen = 0;
  if (!SendMessageTimeoutW(focus, WM_GETTEXTLENGTH, 0, 0, SMTO_ABORTIFHUNG, 150, &totalLen)) {
    return false;
  }
  if (totalLen == 0 || totalLen > 512 * 1024 || start >= totalLen) return false;

  std::wstring buf(static_cast<size_t>(totalLen) + 1, L'\0');
  DWORD_PTR copied = 0;
  if (!SendMessageTimeoutW(
          focus, WM_GETTEXT, buf.size(), reinterpret_cast<LPARAM>(buf.data()),
          SMTO_ABORTIFHUNG, 200, &copied)
      || copied == 0) {
    return false;
  }

  const DWORD maxEnd = static_cast<DWORD>(copied);
  if (end > maxEnd) end = maxEnd;
  if (end <= start) return false;

  const size_t selLen = (std::min)(static_cast<size_t>(end - start), static_cast<size_t>(capacity));
  outText.assign(buf.data() + start, selLen);
  outEditable = (style & ES_READONLY) == 0;
  return true;
}

// Clipboard backup/restore helpers
bool OpenClipboardWithRetry(int attempts, int delayMs) {
  for (int i = 0; i < attempts; i++) {
    if (OpenClipboard(nullptr)) return true;
    if (i + 1 < attempts) Sleep(delayMs);
  }
  return false;
}

void SetDwordClipboardFormat(const wchar_t* formatName, DWORD value) {
  UINT fmt = RegisterClipboardFormatW(formatName);
  if (!fmt) return;
  HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, sizeof(DWORD));
  if (!hMem) return;
  void* ptr = GlobalLock(hMem);
  if (!ptr) {
    GlobalFree(hMem);
    return;
  }
  *static_cast<DWORD*>(ptr) = value;
  GlobalUnlock(hMem);
  if (!SetClipboardData(fmt, hMem)) {
    GlobalFree(hMem);
  }
}

void SuppressClipboardHistory() {
  SetDwordClipboardFormat(L"ExcludeClipboardContentFromMonitorProcessing", 1);
  SetDwordClipboardFormat(L"CanIncludeInClipboardHistory", 0);
  SetDwordClipboardFormat(L"CanUploadToCloudClipboard", 0);
}

bool IsSafeBackupFormat(UINT fmt, UINT fmtExclude, UINT fmtCanHist, UINT fmtCanCloud) {
  if (fmt == 0) return false;
  if (fmt == fmtExclude || fmt == fmtCanHist || fmt == fmtCanCloud) return false;
  if (fmt == CF_BITMAP || fmt == CF_METAFILEPICT || fmt == CF_PALETTE || fmt == CF_ENHMETAFILE || fmt == CF_OWNERDISPLAY) {
    return false;
  }
  if (fmt >= CF_DSPBITMAP && fmt <= CF_DSPENHMETAFILE) return false;
  if (fmt >= CF_PRIVATEFIRST && fmt <= CF_PRIVATELAST) return false;
  if (fmt >= CF_GDIOBJFIRST && fmt <= CF_GDIOBJLAST) return false;
  return true;
}

struct SavedClipboard {
  std::vector<std::pair<UINT, std::vector<BYTE>>> formats;
};

std::mutex clipboardStoreLock;
std::unordered_map<uint64_t, SavedClipboard> clipboardStore;
std::atomic<uint64_t> nextClipboardToken{1};

void CopyFormatIntoSnapshot(
    UINT fmt,
    std::vector<UINT>& seen,
    SavedClipboard& snapshot,
    size_t& totalBytes,
    UINT fmtExclude,
    UINT fmtCanHist,
    UINT fmtCanCloud) {
  if (!IsSafeBackupFormat(fmt, fmtExclude, fmtCanHist, fmtCanCloud)) return;
  if (std::find(seen.begin(), seen.end(), fmt) != seen.end()) return;
  seen.push_back(fmt);
  if (!IsClipboardFormatAvailable(fmt)) return;

  HANDLE handle = GetClipboardData(fmt);
  if (!handle) return;
  const SIZE_T size = GlobalSize(handle);
  if (size == 0 || size > kMaxFormatBytes || totalBytes + size > kMaxTotalSnapshotBytes) return;

  const void* locked = GlobalLock(handle);
  if (!locked) return;
  std::vector<BYTE> data(static_cast<size_t>(size));
  std::memcpy(data.data(), locked, static_cast<size_t>(size));
  GlobalUnlock(handle);

  totalBytes += data.size();
  snapshot.formats.emplace_back(fmt, std::move(data));
}

bool ReadHGlobalTextUtf16(HGLOBAL handle, size_t maxBytes, std::wstring& out) {
  if (!handle) return false;
  SIZE_T rawSize = GlobalSize(handle);
  if (rawSize < 2) return false;
  if (rawSize > maxBytes) rawSize = maxBytes;
  const void* ptr = GlobalLock(handle);
  if (!ptr) return false;
  const size_t wcharCount = static_cast<size_t>(rawSize) / sizeof(wchar_t);
  const wchar_t* wptr = static_cast<const wchar_t*>(ptr);
  size_t len = 0;
  while (len < wcharCount && wptr[len] != L'\0') len++;
  out.assign(wptr, len);
  GlobalUnlock(handle);
  return true;
}

bool ReadHGlobalBytesUtf8AsWide(HGLOBAL handle, size_t maxBytes, std::wstring& out) {
  if (!handle) return false;
  SIZE_T rawSize = GlobalSize(handle);
  if (rawSize == 0) return false;
  if (rawSize > maxBytes) rawSize = maxBytes;
  const void* ptr = GlobalLock(handle);
  if (!ptr) return false;
  const char* cptr = static_cast<const char*>(ptr);
  size_t len = 0;
  while (len < static_cast<size_t>(rawSize) && cptr[len] != '\0') len++;
  const int needed = MultiByteToWideChar(CP_UTF8, 0, cptr, static_cast<int>(len), nullptr, 0);
  if (needed > 0) {
    out.resize(static_cast<size_t>(needed));
    MultiByteToWideChar(CP_UTF8, 0, cptr, static_cast<int>(len), out.data(), needed);
  }
  GlobalUnlock(handle);
  return needed > 0;
}

int ClassifyVsCodeEmptySelectionFlag(const std::wstring& text) {
  const size_t pos = text.find(L"isFromEmptySelection");
  if (pos == std::wstring::npos) return 0;
  size_t cur = pos + 20;
  while (cur < text.size() && (text[cur] == L'"' || text[cur] == L'\'' || text[cur] == L' ' || text[cur] == L'\t')) cur++;
  if (cur < text.size() && text[cur] == L':') {
    cur++;
    while (cur < text.size() && (text[cur] == L' ' || text[cur] == L'\t' || text[cur] == L'\r' || text[cur] == L'\n')) cur++;
    if (text.compare(cur, 4, L"true") == 0) return 2;
    if (text.compare(cur, 5, L"false") == 0) return 1;
  }
  return 0;
}

}  // namespace

extern "C" {

__declspec(dllexport) HWND ys_focused_window(HWND window) {
  return FocusedWindow(window);
}

__declspec(dllexport) HWND ys_excel_cell_editor(HWND window) {
  return ExcelCellEditor(window);
}

__declspec(dllexport) int ys_window_title(HWND window, wchar_t* title, int capacity) {
  if (!window || !title || capacity <= 0) return 0;
  title[0] = 0;
  return GetWindowTextW(window, title, capacity);
}

// Writes the selected text (at most `capacity` characters) to `text` and returns its length, or 0
// when nothing is selected. Flags:
//   1  = selection can be typed over
//   2  = password field (nothing read, nothing copied)
//   4  = focused field is writable (when no selection was read)
//   8  = focused field is explicitly read-only (when no selection was read)
//   16 = focused element looks like an integrated terminal
//   32 = focused element is UIA-opaque (bare Window/Pane)
//   64 = focused Document reports IsReadOnly=true (wrapper Document in Word/Google Docs/etc.)
// `process` gets the focused app's process name, without ".exe". Returns -1 on COM/UIA init failure.
__declspec(dllexport) int ys_read_selection(
    wchar_t* text, int capacity, int* flags, wchar_t* process, int processCapacity, int fast) {
  *flags = 0;
  if (processCapacity > 0) process[0] = 0;

  HWND fg = GetForegroundWindow();
  DWORD fgPid = 0;
  if (fg) GetWindowThreadProcessId(fg, &fgPid);
  std::wstring fgProcess = fgPid ? ProcessName(static_cast<int>(fgPid)) : L"";
  if (!fgProcess.empty() && processCapacity > 0) {
    wcsncpy_s(process, processCapacity, fgProcess.c_str(), _TRUNCATE);
  }

  HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(init) && init != RPC_E_CHANGED_MODE) return -1;
  IUIAutomation* uia = Automation();
  if (!uia) return -1;

  if (!fast && fg) {
    WakeAccessibility(fg);
    if (IsWebHostWindow(fg) || IsWebHostWindow(FocusedWindow(fg))) {
      Sleep(30);
    }
  }

  std::wstring found;
  bool editable = true;
  int length = 0;
  const int maxAttempts = fast ? 1 : 8;

  for (int attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt) Sleep(65);
    IUIAutomationElement* element = nullptr;
    if (FAILED(uia->GetFocusedElement(&element)) || !element) {
      if (!fast && IsWebHostWindow(fg) && attempt + 1 < maxAttempts) continue;
      *flags = kFlagUiaOpaque;
      length = 0;
      break;
    }

    int pid = 0;
    element->get_CurrentProcessId(&pid);
    std::wstring currentProcess = pid ? ProcessName(pid) : fgProcess;
    if (currentProcess.empty()) currentProcess = fgProcess;
    if (!currentProcess.empty() && processCapacity > 0) {
      wcsncpy_s(process, processCapacity, currentProcess.c_str(), _TRUNCATE);
    }

    BOOL password = FALSE;
    element->get_CurrentIsPassword(&password);
    if (password) {
      *flags = kFlagPassword;
      Release(element);
      length = 0;
      found.clear();
      break;
    }

    BSTR framework = nullptr;
    element->get_CurrentFrameworkId(&framework);
    const bool frameworkWeb = framework && (wcscmp(framework, L"Chrome") == 0 || wcscmp(framework, L"Gecko") == 0);
    SysFreeString(framework);
    const bool web = frameworkWeb || IsWebHostWindow(fg) || IsWebHostWindow(FocusedWindow(fg));

    IUIAutomationElement* patternHost = nullptr;
    IUIAutomationTextPattern* pattern = TextPatternFor(uia, element, &patternHost);
    found.clear();
    editable = true;
    if (pattern) {
      IUIAutomationElement* editCheckEl = patternHost ? patternHost : element;
      IUIAutomationTextRangeArray* ranges = nullptr;
      int count = 0;
      if (SUCCEEDED(pattern->GetSelection(&ranges)) && ranges) ranges->get_Length(&count);
      for (int i = 0; i < count && static_cast<int>(found.size()) < capacity; i++) {
        IUIAutomationTextRange* range = nullptr;
        if (FAILED(ranges->GetElement(i, &range)) || !range) continue;
        BSTR piece = nullptr;
        if (SUCCEEDED(range->GetText(capacity - static_cast<int>(found.size()), &piece)) && piece && SysStringLen(piece)) {
          if (!found.empty()) found += L"\r\n";
          found.append(piece, SysStringLen(piece));
          if (!IsRangeEditable(range, editCheckEl, pattern, currentProcess)) editable = false;
        }
        SysFreeString(piece);
        Release(range);
      }
      Release(ranges);
      Release(pattern);
    }
    Release(patternHost);

    const bool done = !found.empty() || !web || attempt + 1 >= maxAttempts;
    if (done && found.empty()) {
      bool classicPassword = false;
      if (ReadClassicEditSelection(fg, found, editable, classicPassword, capacity)) {
        if (classicPassword) {
          *flags = kFlagPassword;
          found.clear();
          Release(element);
          break;
        }
      } else {
        int f = ReadFieldEditability(element);
        if (LooksLikeTerminalElement(uia, element)) f |= kFlagInTerminal;
        if (IsElementUiaOpaque(element)) f |= kFlagUiaOpaque;
        *flags = f;
      }
    }
    Release(element);
    if (done) break;
  }

  if (!found.empty()) {
    length = static_cast<int>(found.size() < static_cast<size_t>(capacity) ? found.size() : capacity);
    wmemcpy(text, found.c_str(), length);
    *flags = editable ? kFlagEditable : 0;
  }

  // The thread stays in the multithreaded apartment: leaving it could tear the apartment down
  // and with it the shared automation object.
  return length;
}

// Reads the focused control and its UIA identity. The selection offset is optional because
// controls that expose ValuePattern alone have no UIA selection range.
__declspec(dllexport) int ys_read_rewrite_field(HWND window, wchar_t* text, int capacity,
    int* runtimeId, int idCapacity, int* info, int includeSelection) {
  if (!window || GetForegroundWindow() != window) return -1;
  HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(init) && init != RPC_E_CHANGED_MODE) return -1;
  IUIAutomation* uia = Automation();
  IUIAutomationElement* element = nullptr;
  if (!uia || FAILED(uia->GetFocusedElement(&element)) || !element) return -1;

  BOOL password = TRUE;
  SAFEARRAY* id = nullptr;
  LONG low = 0;
  LONG high = -1;
  LONG* values = nullptr;
  bool identified = SUCCEEDED(element->get_CurrentIsPassword(&password)) && !password &&
      SUCCEEDED(element->GetRuntimeId(&id)) && id && SafeArrayGetDim(id) == 1 &&
      SUCCEEDED(SafeArrayGetLBound(id, 1, &low)) && SUCCEEDED(SafeArrayGetUBound(id, 1, &high)) &&
      high >= low && high - low < idCapacity && SUCCEEDED(SafeArrayAccessData(id, reinterpret_cast<void**>(&values)));
  if (identified) {
    info[0] = high - low + 1;
    for (int i = 0; i < info[0]; i++) runtimeId[i] = values[i];
    SafeArrayUnaccessData(id);
  }
  if (id) SafeArrayDestroy(id);
  if (!identified) {
    Release(element);
    return -1;
  }

  info[1] = -1;
  IUIAutomationTextPattern* pattern = GetTextPattern(element);
  IUIAutomationTextRange* document = nullptr;
  BSTR contents = nullptr;
  bool read = pattern &&
      SUCCEEDED(pattern->get_DocumentRange(&document)) && document &&
      SUCCEEDED(document->GetText(capacity, &contents));
  if (read && includeSelection && SysStringLen(contents) < static_cast<UINT>(capacity)) {
    IUIAutomationTextRangeArray* ranges = nullptr;
    IUIAutomationTextRange* selected = nullptr;
    int count = 0;
    int span = 0;
    BSTR prefix = nullptr;
    if (SUCCEEDED(pattern->GetSelection(&ranges)) && ranges &&
        SUCCEEDED(ranges->get_Length(&count)) && count == 1 &&
        SUCCEEDED(ranges->GetElement(0, &selected)) && selected &&
        SUCCEEDED(selected->CompareEndpoints(TextPatternRangeEndpoint_Start, selected, TextPatternRangeEndpoint_End, &span)) &&
        span < 0 && SUCCEEDED(document->MoveEndpointByRange(TextPatternRangeEndpoint_End, selected, TextPatternRangeEndpoint_Start)) &&
        SUCCEEDED(document->GetText(capacity, &prefix))) {
      info[1] = SysStringLen(prefix);
    }
    SysFreeString(prefix);
    Release(selected);
    Release(ranges);
  }
  Release(document);
  Release(pattern);
  if (!read) {
    SysFreeString(contents);
    contents = nullptr;
    IUIAutomationValuePattern* value = nullptr;
    read = SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value &&
        SUCCEEDED(value->get_CurrentValue(&contents));
    Release(value);
  }
  Release(element);
  int length = -1;
  if (read && SysStringLen(contents) < static_cast<UINT>(capacity) && GetForegroundWindow() == window) {
    length = SysStringLen(contents);
    if (length) wmemcpy(text, contents, length);
  }
  SysFreeString(contents);
  return length;
}

// Only the known clipboard shortcuts, with hardware scan codes and foreground/clipboard checks
// directly before SendInput. Inserting events as a batch keeps key-down and key-up together.
__declspec(dllexport) int ys_send_clipboard_shortcut(
    HWND window, DWORD sequence, WORD key, int withShift, HWND excelEditor, HWND focusedWindow) {
  if (key != 'C' && key != 'V' && key != VK_INSERT) return 0;
  if (withShift && key != 'C') return 0;

  const int modifiers[] = {VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN};
  for (int modifier : modifiers) {
    if (GetAsyncKeyState(modifier) & 0x8000) return 0;
  }

  INPUT inputs[6] = {};
  int count = 0;
  auto pushKey = [&](WORD vk, DWORD flags) {
    INPUT& in = inputs[count++];
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.wScan = static_cast<WORD>(MapVirtualKeyW(vk, MAPVK_VK_TO_VSC));
    in.ki.dwFlags = flags;
    in.ki.dwExtraInfo = kYapYapExtraInfo;
  };

  const DWORD keyExt = key == VK_INSERT ? KEYEVENTF_EXTENDEDKEY : 0;
  pushKey(VK_CONTROL, 0);
  if (withShift) pushKey(VK_SHIFT, 0);
  pushKey(key, keyExt);
  pushKey(key, keyExt | KEYEVENTF_KEYUP);
  if (withShift) pushKey(VK_SHIFT, KEYEVENTF_KEYUP);
  pushKey(VK_CONTROL, KEYEVENTF_KEYUP);

  if (excelEditor && ((key != 'C' && key != 'V') || ExcelCellEditor(window) != excelEditor)) return 0;
  if (focusedWindow && FocusedWindow(window) != focusedWindow) return 0;
  if (!window || GetForegroundWindow() != window) return 0;
  if (sequence != 0 && GetClipboardSequenceNumber() != sequence) return 0;

  return SendInput(static_cast<UINT>(count), inputs, sizeof(INPUT)) == static_cast<UINT>(count) ? 1 : 0;
}

__declspec(dllexport) uint64_t ys_clipboard_save() {
  if (!OpenClipboardWithRetry(5, 15)) return 0;

  const UINT fmtExclude = RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing");
  const UINT fmtCanHist = RegisterClipboardFormatW(L"CanIncludeInClipboardHistory");
  const UINT fmtCanCloud = RegisterClipboardFormatW(L"CanUploadToCloudClipboard");
  const UINT fmtHtml = RegisterClipboardFormatW(L"HTML Format");
  const UINT fmtRtf = RegisterClipboardFormatW(L"Rich Text Format");
  const UINT fmtPng = RegisterClipboardFormatW(L"PNG");

  SavedClipboard snapshot;
  std::vector<UINT> seen;
  size_t totalBytes = 0;

  const UINT priority[] = {CF_UNICODETEXT, CF_HDROP, fmtHtml, fmtRtf, fmtPng, CF_DIBV5, CF_DIB};
  for (UINT fmt : priority) {
    CopyFormatIntoSnapshot(fmt, seen, snapshot, totalBytes, fmtExclude, fmtCanHist, fmtCanCloud);
  }
  for (UINT fmt = EnumClipboardFormats(0); fmt != 0; fmt = EnumClipboardFormats(fmt)) {
    CopyFormatIntoSnapshot(fmt, seen, snapshot, totalBytes, fmtExclude, fmtCanHist, fmtCanCloud);
  }

  CloseClipboard();

  const uint64_t token = nextClipboardToken.fetch_add(1);
  std::lock_guard<std::mutex> guard(clipboardStoreLock);
  while (clipboardStore.size() >= 4) {
    uint64_t oldest = clipboardStore.begin()->first;
    for (const auto& entry : clipboardStore) {
      if (entry.first < oldest) oldest = entry.first;
    }
    clipboardStore.erase(oldest);
  }
  clipboardStore.emplace(token, std::move(snapshot));
  return token;
}

__declspec(dllexport) uint32_t ys_clipboard_write_text(const wchar_t* text, int length, int excludeFromHistory) {
  if (!text || length < 0) return 0;
  if (!OpenClipboardWithRetry(6, 15)) return 0;
  if (!EmptyClipboard()) {
    CloseClipboard();
    return 0;
  }
  const SIZE_T bytes = (static_cast<SIZE_T>(length) + 1) * sizeof(wchar_t);
  HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (!hMem) {
    CloseClipboard();
    return 0;
  }
  wchar_t* dst = static_cast<wchar_t*>(GlobalLock(hMem));
  if (!dst) {
    GlobalFree(hMem);
    CloseClipboard();
    return 0;
  }
  if (length > 0) wmemcpy(dst, text, static_cast<size_t>(length));
  dst[length] = L'\0';
  GlobalUnlock(hMem);

  if (!SetClipboardData(CF_UNICODETEXT, hMem)) {
    GlobalFree(hMem);
    CloseClipboard();
    return 0;
  }
  if (excludeFromHistory) {
    SuppressClipboardHistory();
  }
  CloseClipboard();
  return GetClipboardSequenceNumber();
}

__declspec(dllexport) int ys_clipboard_restore(uint64_t token, uint32_t expectedSequence) {
  if (token == 0) return 0;
  SavedClipboard snapshot;
  {
    std::lock_guard<std::mutex> guard(clipboardStoreLock);
    auto it = clipboardStore.find(token);
    if (it == clipboardStore.end()) return 0;
    snapshot = std::move(it->second);
    clipboardStore.erase(it);
  }
  if (expectedSequence != 0 && GetClipboardSequenceNumber() != expectedSequence) return 0;
  if (!OpenClipboardWithRetry(6, 50)) return 0;
  if (expectedSequence != 0 && GetClipboardSequenceNumber() != expectedSequence) {
    CloseClipboard();
    return 0;
  }
  if (!EmptyClipboard()) {
    CloseClipboard();
    return 0;
  }
  for (const auto& item : snapshot.formats) {
    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, item.second.size());
    if (!hMem) continue;
    void* dst = GlobalLock(hMem);
    if (!dst) {
      GlobalFree(hMem);
      continue;
    }
    std::memcpy(dst, item.second.data(), item.second.size());
    GlobalUnlock(hMem);
    if (!SetClipboardData(item.first, hMem)) {
      GlobalFree(hMem);
    }
  }
  SuppressClipboardHistory();
  CloseClipboard();
  return 1;
}

__declspec(dllexport) void ys_clipboard_discard(uint64_t token) {
  if (token == 0) return;
  std::lock_guard<std::mutex> guard(clipboardStoreLock);
  clipboardStore.erase(token);
}

// Inspects the active clipboard formats to distinguish real text highlights from implicit
// line copies (VS Code/Cursor/Antigravity, Visual Studio, Zed) and PowerPoint slide/shape objects.
// Returns: 0 = plain/unknown, 1 = explicit selection, 2 = implicit-line, 3 = non-text object.
__declspec(dllexport) int ys_inspect_copy_metadata() {
  if (!OpenClipboardWithRetry(4, 15)) return 0;

  int result = 0;
  const UINT fmtPptSlides = RegisterClipboardFormatW(L"PowerPoint 12.0 Internal Slides");
  const UINT fmtPptShapes = RegisterClipboardFormatW(L"PowerPoint 12.0 Internal Shapes");
  if ((fmtPptSlides && IsClipboardFormatAvailable(fmtPptSlides))
      || (fmtPptShapes && IsClipboardFormatAvailable(fmtPptShapes))) {
    result = 3;
  }

  if (result == 0) {
    const UINT fmtVsLine = RegisterClipboardFormatW(L"VisualStudioEditorOperationsLineCutCopyClipboardTag");
    if (fmtVsLine && IsClipboardFormatAvailable(fmtVsLine)) {
      result = 2;
    }
  }

  if (result == 0) {
    const UINT fmtZed = RegisterClipboardFormatW(L"GPUI internal metadata");
    if (fmtZed && IsClipboardFormatAvailable(fmtZed)) {
      std::wstring zedMeta;
      if (ReadHGlobalTextUtf16(static_cast<HGLOBAL>(GetClipboardData(fmtZed)), 32 * 1024, zedMeta)) {
        if (zedMeta.find(L"\"is_entire_line\":true") != std::wstring::npos) result = 2;
        else if (zedMeta.find(L"\"is_entire_line\":false") != std::wstring::npos) result = 1;
      }
    }
  }

  if (result == 0) {
    const UINT fmtChromiumCustom = RegisterClipboardFormatW(L"Chromium Web Custom MIME Data Format");
    const UINT fmtVscode = RegisterClipboardFormatW(L"vscode-editor-data");
    if (fmtChromiumCustom && IsClipboardFormatAvailable(fmtChromiumCustom)) {
      std::wstring customMeta;
      if (ReadHGlobalTextUtf16(static_cast<HGLOBAL>(GetClipboardData(fmtChromiumCustom)), 64 * 1024, customMeta)) {
        if (customMeta.find(L"vscode-editor-data") != std::wstring::npos) {
          result = ClassifyVsCodeEmptySelectionFlag(customMeta);
        }
      }
    }
    if (result == 0 && fmtVscode && IsClipboardFormatAvailable(fmtVscode)) {
      std::wstring vscodeMeta;
      if (ReadHGlobalBytesUtf8AsWide(static_cast<HGLOBAL>(GetClipboardData(fmtVscode)), 64 * 1024, vscodeMeta)) {
        result = ClassifyVsCodeEmptySelectionFlag(vscodeMeta);
      }
    }
  }

  CloseClipboard();
  return result;
}

}  // extern "C"
