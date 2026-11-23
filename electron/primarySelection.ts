// Linux keeps the last highlighted text (the "primary selection", what middle-click pastes) in
// almost every app, Chromium and terminals included, and reading it presses no keys and leaves
// the clipboard alone. But it outlives the highlight: text highlighted an hour ago is still there.

/**
 * Tells new highlights from old ones. It is fed the primary selection at every Ask and passes it
 * on only when it changed since the last Ask, so a highlight already asked about, or one that was
 * sitting there at an earlier Ask, is never taken for a new selection.
 */
export function freshHighlights(): (text: string | undefined) => string | undefined {
  let lastSeen: string | undefined;
  return (text) => {
    const fresh = text?.trim() && text !== lastSeen ? text : undefined;
    lastSeen = text;
    return fresh;
  };
}
