// Keyboard guards kept free of the DOM so they can be unit tested.

export function isTypingTarget(target) {
  if (!target) return false;
  return Boolean(target.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(String(target.tagName || '').toUpperCase());
}

// Space activates focused buttons and links natively, so it only pauses
// elsewhere (including the board canvas). P always pauses.
export function isPauseKey(event) {
  const tag = String(event.target?.tagName || '').toUpperCase();
  if (event.code === 'Space') return !/^(BUTTON|A)$/.test(tag);
  return String(event.key || '').toLowerCase() === 'p';
}

export function ignoreKey(event) {
  return Boolean(event.repeat || event.ctrlKey || event.metaKey || event.altKey) || isTypingTarget(event.target);
}
