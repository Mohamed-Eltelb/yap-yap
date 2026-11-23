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

}  // namespace

extern "C" {

// Writes the selected text (at most `capacity` characters) to `text` and returns its length, or 0
// when nothing is selected. `flags` gets 1 when the selection can be typed over, and 2 when the
// focused element is a password field (then nothing is read, and nothing may be copied).
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
      Release(element);
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
      if (!found.empty() || !web) break;
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

}  // extern "C"
