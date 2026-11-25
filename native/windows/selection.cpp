// Yap Yap's selection reader. It reads the text selected in the app in front through UI
// Automation, inside Yap Yap's own process, and says whether that text can be typed over.
// Yap Yap calls it on a worker thread, so a slow or frozen app never holds up the app.
#include <windows.h>
#include <UIAutomation.h>
#include <mutex>
#include <string>

namespace {

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
    withTimeouts->put_ConnectionTimeout(1000);
    withTimeouts->put_TransactionTimeout(1500);
    withTimeouts->Release();
  }
  automation = created;
  return automation;
}

template <typename T> void Release(T*& object) {
  if (object) object->Release();
  object = nullptr;
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

// The text pattern of the element, or of the nearest ancestor that has one: a selection on a web
// page belongs to the document, which may be an ancestor of what has focus.
IUIAutomationTextPattern* TextPatternFor(IUIAutomation* uia, IUIAutomationElement* element) {
  IUIAutomationTreeWalker* walker = nullptr;
  IUIAutomationElement* root = nullptr;
  uia->get_ControlViewWalker(&walker);
  uia->GetRootElement(&root);
  IUIAutomationTextPattern* pattern = nullptr;
  IUIAutomationElement* node = element;
  node->AddRef();
  for (int depth = 0; node && depth < 12; depth++) {
    if (SUCCEEDED(node->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&pattern))) && pattern) break;
    pattern = nullptr;
    IUIAutomationElement* parent = nullptr;
    if (!walker || FAILED(walker->GetParentElement(node, &parent))) parent = nullptr;
    Release(node);
    node = parent;
    BOOL same = FALSE;
    if (node && root && SUCCEEDED(uia->CompareElements(node, root, &same)) && same) break;
  }
  Release(node);
  Release(root);
  Release(walker);
  return pattern;
}

enum FieldEditability { FieldUnknown = 0, FieldWritable = 4, FieldReadOnly = 8 };

// Distinguish a control that explicitly rejects editing from an app that exposes no field.
FieldEditability ReadFieldEditability(IUIAutomationElement* element) {
  BOOL enabled = FALSE;
  if (FAILED(element->get_CurrentIsEnabled(&enabled))) return FieldUnknown;
  if (!enabled) return FieldReadOnly;

  CONTROLTYPEID type = 0;
  if (FAILED(element->get_CurrentControlType(&type))) return FieldUnknown;
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
      return FieldReadOnly;
  }
  if (type != UIA_EditControlTypeId && type != UIA_DocumentControlTypeId) return FieldUnknown;
  IUIAutomationValuePattern* value = nullptr;
  if (type == UIA_EditControlTypeId &&
      SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value) {
    BOOL readOnly = FALSE;
    const HRESULT result = value->get_CurrentIsReadOnly(&readOnly);
    Release(value);
    if (SUCCEEDED(result)) return readOnly ? FieldReadOnly : FieldWritable;
  }
  IUIAutomationTextPattern* text = nullptr;
  if (FAILED(element->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&text))) || !text) return FieldUnknown;
  IUIAutomationTextRange* range = nullptr;
  VARIANT readOnly;
  VariantInit(&readOnly);
  const bool known = SUCCEEDED(text->get_DocumentRange(&range)) && range &&
      SUCCEEDED(range->GetAttributeValue(UIA_IsReadOnlyAttributeId, &readOnly)) && readOnly.vt == VT_BOOL;
  const auto editability = known ? (readOnly.boolVal == VARIANT_FALSE ? FieldWritable : FieldReadOnly) : FieldUnknown;
  VariantClear(&readOnly);
  Release(range);
  Release(text);
  return editability;
}

bool HasWindowClass(HWND window, const wchar_t* expected) {
  wchar_t name[32];
  return window && GetClassNameW(window, name, ARRAYSIZE(name)) && wcscmp(name, expected) == 0;
}

HWND FocusedWindow(HWND window) {
  GUITHREADINFO info = { sizeof(GUITHREADINFO) };
  if (!window || GetForegroundWindow() != window || !GetGUIThreadInfo(0, &info) ||
      info.hwndActive != window || GetAncestor(info.hwndFocus, GA_ROOT) != window) return nullptr;
  return info.hwndFocus;
}

// Inside a cell, Excel focuses EXCEL6. The worksheet grid is EXCEL7 and Copy there
// would put the active cell on the clipboard even without a text highlight.
HWND ExcelCellEditor(HWND window) {
  if (!HasWindowClass(window, L"XLMAIN")) return nullptr;
  HWND focus = FocusedWindow(window);
  if (!HasWindowClass(focus, L"EXCEL6") || !HasWindowClass(GetParent(focus), L"XLDESK")) return nullptr;
  return focus;
}

}  // namespace

extern "C" {

__declspec(dllexport) HWND ys_focused_window(HWND window) {
  return FocusedWindow(window);
}

__declspec(dllexport) HWND ys_excel_cell_editor(HWND window) {
  return ExcelCellEditor(window);
}

// Writes the selected text (at most `capacity` characters) to `text` and returns its length, or 0
// when nothing is selected. `flags` gets 1 when the selection can be typed over, and 2 when the
// focused element is a password field (then nothing is read, and nothing may be copied).
// Flags 4 and 8 identify a writable or read-only focused control when no selection was read.
// `process` gets the focused app's process name, without ".exe". Returns -1 on failure.
__declspec(dllexport) int ys_read_selection(wchar_t* text, int capacity, int* flags, wchar_t* process, int processCapacity) {
  *flags = 0;
  if (processCapacity > 0) process[0] = 0;
  HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(init) && init != RPC_E_CHANGED_MODE) return -1;
  IUIAutomation* uia = Automation();
  int length = -1;
  if (uia) {
    std::wstring found;
    bool editable = true;
    // Browsers and Electron apps switch their accessibility on at the first query: until then they
    // show a placeholder or a page whose selection reads as empty. So a browser that shows no
    // selection is asked again for about a second.
    for (int attempt = 0; attempt < 13; attempt++) {
      if (attempt) Sleep(80);
      IUIAutomationElement* element = nullptr;
      if (FAILED(uia->GetFocusedElement(&element)) || !element) break;
      BOOL password = FALSE;
      element->get_CurrentIsPassword(&password);
      int pid = 0;
      element->get_CurrentProcessId(&pid);
      std::wstring name = ProcessName(pid);
      wcsncpy_s(process, processCapacity, name.c_str(), _TRUNCATE);
      if (password) {
        *flags = 2;
        Release(element);
        length = 0;
        break;
      }
      BSTR framework = nullptr;
      element->get_CurrentFrameworkId(&framework);
      bool web = framework && (wcscmp(framework, L"Chrome") == 0 || wcscmp(framework, L"Gecko") == 0);
      SysFreeString(framework);

      IUIAutomationTextPattern* pattern = TextPatternFor(uia, element);
      found.clear();
      editable = true;
      if (pattern) {
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
            VARIANT readOnly;
            VariantInit(&readOnly);
            if (FAILED(range->GetAttributeValue(UIA_IsReadOnlyAttributeId, &readOnly)) || readOnly.vt != VT_BOOL || readOnly.boolVal != VARIANT_FALSE) editable = false;
            VariantClear(&readOnly);
          }
          SysFreeString(piece);
          Release(range);
        }
        Release(ranges);
        Release(pattern);
      }
      length = 0;
      const bool done = !found.empty() || !web || attempt == 12;
      if (done && found.empty()) *flags = ReadFieldEditability(element);
      Release(element);
      if (done) break;
    }
    if (!found.empty()) {
      length = static_cast<int>(found.size() < static_cast<size_t>(capacity) ? found.size() : capacity);
      wmemcpy(text, found.c_str(), length);
      if (editable) *flags = 1;
    }
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
  IUIAutomationTextPattern* pattern = nullptr;
  IUIAutomationTextRange* document = nullptr;
  BSTR contents = nullptr;
  bool read = SUCCEEDED(element->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&pattern))) && pattern &&
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

// Only the known clipboard shortcuts, with the foreground and clipboard checked directly
// before SendInput. Inserting the four events as a batch keeps key-down and key-up together.
__declspec(dllexport) int ys_send_clipboard_shortcut(HWND window, DWORD sequence, WORD key, HWND excelEditor, HWND focusedWindow) {
  if (key != 'C' && key != 'V' && key != VK_INSERT) return 0;
  const int modifiers[] = {VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN};
  for (int modifier : modifiers) {
    if (GetAsyncKeyState(modifier) & 0x8000) return 0;
  }
  INPUT inputs[4] = {};
  for (auto& input : inputs) input.type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = inputs[3].ki.wVk = VK_CONTROL;
  inputs[1].ki.wVk = inputs[2].ki.wVk = key;
  if (key == VK_INSERT) inputs[1].ki.dwFlags = inputs[2].ki.dwFlags = KEYEVENTF_EXTENDEDKEY;
  inputs[2].ki.dwFlags |= KEYEVENTF_KEYUP;
  inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
  if (excelEditor && ((key != 'C' && key != 'V') || ExcelCellEditor(window) != excelEditor)) return 0;
  if (focusedWindow && FocusedWindow(window) != focusedWindow) return 0;
  if (!window || GetForegroundWindow() != window || GetClipboardSequenceNumber() != sequence) return 0;
  return SendInput(ARRAYSIZE(inputs), inputs, sizeof(INPUT)) == ARRAYSIZE(inputs);
}

}  // extern "C"
