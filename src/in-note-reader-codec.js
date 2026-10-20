// Shared by the worker and audit harness. All returned spans refer to the
// original candidate string, never reconstructed text from a language model.
export const IN_NOTE_READER_FORMAT = 1;
export function inNoteReaderInput(target, context = '') {
  const text = String(target || '');
  return { passage: `Target: ${text}${context ? `\nContext: ${context}` : ''}`, targetFrom: 8, targetTo: 8 + text.length };
}
