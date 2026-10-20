import nlp from 'compromise';
import { inNoteGrammar } from './in-note-logic.js';
import { inNoteEvidence } from './in-note-focus.js';

const auxiliaries = 'can|could|may|might|should|must|will|would|is|are|was|were|has|have|had|do|does|did';
const sentenceCase = text => text.replace(/^\p{L}/u, letter => letter.toUpperCase());
function statement(auxiliary, tail) {
  const negative = /^not\s+/iu.test(tail); tail = tail.replace(/^not\s+/iu, '');
  let subject = inNoteGrammar(tail).sentence.subject;
  if (!subject || subject.length === tail.length) {
    // The missing auxiliary makes noun/verb homographs ambiguous ("refunds
    // available", "the lights fail"). Restore it before asking for a parse.
    subject = '';
    for (const gap of tail.matchAll(/\s+/gu)) {
      const prefix = tail.slice(0, gap.index), rest = tail.slice(gap.index + gap[0].length);
      const parsed = inNoteGrammar(`${prefix} ${auxiliary} ${rest}`);
      if (parsed.actor.length && parsed.sentence.subject.toLowerCase() === prefix.toLowerCase() && parsed.verbs.length) { subject = prefix; break; }
    }
  }
  if (!subject || !tail.toLowerCase().startsWith(subject.toLowerCase())) return '';
  const remainder = tail.slice(subject.length).trim(); if (!remainder) return '';
  if (/^(?:do|does|did)$/iu.test(auxiliary) && !negative) {
    const doc = nlp(`${subject} ${auxiliary} ${remainder}`);
    doc.verbs().toInfinitive();
    if (auxiliary.toLowerCase() === 'did') doc.verbs().toPastTense(); else doc.verbs().toPresentTense();
    return doc.text().replace(/[.!?]+$/u, '') + '.';
  }
  return `${subject} ${auxiliary}${negative ? ' not' : ''} ${remainder}.`;
}
export function inNoteQuestionPlan(query) {
  const text = String(query).replace(/\bcan['’]t\b/giu, 'can not').replace(/\bwon['’]t\b/giu, 'will not').replace(/\b(could|would|should|did|does|do|is|are|was|were|has|have|had|must)n['’]t\b/giu, '$1 not').trim().replace(/[.!?]+$/u, '');
  const location = text.match(/^where\s+(is|are|was|were)\s+(.+)$/iu);
  if (location) return { type: 'location', hypothesis: `There ${location[1]} ${location[2]}.` };
  const typed = text.match(new RegExp(`^(why|when|how long)\\s+(${auxiliaries})\\s+(.+)$`, 'iu'));
  if (typed) { const hypothesis = statement(typed[2], typed[3]); return hypothesis ? { type: typed[1].toLowerCase() === 'why' ? 'cause' : 'time', hypothesis: sentenceCase(hypothesis) } : null; }
  const boolean = text.match(new RegExp(`^(${auxiliaries})\\s+(.+)$`, 'iu'));
  if (boolean) { const hypothesis = statement(boolean[1], boolean[2]); return hypothesis ? { type: 'boolean', hypothesis: sentenceCase(hypothesis) } : null; }
  return null;
}

export function inNoteQuestionWordEvidence(alignment) {
  if (!alignment) return null;
  const indices = alignment.queryRows.map((word, index) => /^(?:why|many|much)$/u.test(word.text) ? -1 : index).filter(index => index >= 0);
  const scores = new Float32Array(alignment.words.length * indices.length);
  alignment.words.forEach((word, row) => indices.forEach((column, index) => { scores[row * indices.length + index] = alignment.scores[row * alignment.queryRows.length + column]; }));
  return { ...inNoteEvidence({ ...alignment, queryRows: indices.map(index => alignment.queryRows[index]), scores }), queryWords: indices.map(index => alignment.queryRows[index].text) };
}

const locationCue = /\b(?:in|on|at|under|beneath|behind|beside|near|inside|outside|above|below|across|between|among|within|next to|here|there|upstairs|downstairs|home)\b/iu;
const timeCue = /\b(?:after|before|until|once|when|during|whenever|as soon as|morning|afternoon|evening|night|noon|midnight|sunrise|sunset|dawn|dusk|tomorrow|yesterday)\b/iu;
const numericTime = /\b\d{1,2}:\d{2}(?:\s*[ap]m)?\b|\b\d{1,2}\s*[ap]m\b|\b(?:19|20)\d{2}\b|\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/iu;
export function inNoteQuestionSlot(plan, text, grammar) {
  if (plan.type === 'location') return locationCue.test(text);
  if (plan.type === 'time') return Boolean(grammar.dates?.length || numericTime.test(text) || timeCue.test(text));
  return true;
}
export function inNoteQuestionRange(plan, text, grammar) {
  let start = -1;
  if (plan.type === 'location') {
    const verb = grammar.verbs[0]?.text, verbAt = verb ? text.toLowerCase().indexOf(verb.toLowerCase()) : -1;
    const offset = Math.max(0, verbAt), match = text.slice(offset).match(locationCue);
    start = match ? offset + match.index : text.search(locationCue);
  } else if (plan.type === 'time') {
    const marker = grammar.dates?.map(date => text.indexOf(date)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? text.search(numericTime);
    const prefixes = marker >= 0 ? [...text.slice(0, marker).matchAll(/\b(?:at|after|before|until|within|during|by|from)\b/giu)] : [];
    start = prefixes.length ? prefixes.at(-1).index : marker >= 0 ? marker : text.search(timeCue);
  }
  if (start < 0) return null;
  const boundary = text.slice(start).search(/[,;!?]|\.(?=\s|$)/u), end = boundary < 0 ? text.length : start + boundary;
  const selected = text.slice(start, end), left = selected.length - selected.trimStart().length;
  return { from: start + left, to: start + selected.trimEnd().length };
}
