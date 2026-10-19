import nlp from 'compromise';
import { inNoteAntonyms } from './in-note-antonyms.js';

const words = text => String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const CONTENT = word => !/^(?:a|an|the|of|to|by|from|for|and|or|but|this|that|these|those|it|its|i|we|you|he|she|they|someone|something)$/u.test(word);
const stem = word => word.replace(/(?:ing|ed|s)$/u, '').replace(/([b-df-hj-np-tv-z])\1$/u, '$1');
const head = text => words(text).filter(CONTENT);
const overlap = (first, second) => first.length > 0 && first.some(word => second.includes(word));

export function inNoteGrammar(text, nested = false) {
  const doc = nlp(text), sentence = doc.sentences().json()[0]?.sentence || {}, verbs = doc.verbs().json({ offset: true });
  const first = verbs[0], verb = first?.verb || {}, passive = Boolean(verb.grammar?.passive || /\b(?:is|are|was|were|be|been)\b/iu.test(sentence.verb || '') && first?.terms.at(-1)?.tags.includes('PastTense') && !sentence.predicate || !sentence.subject && /\bby\b/iu.test(sentence.predicate || ''));
  const by = String(sentence.predicate || '').match(/\bby\s+(.+?)(?=\b(?:for|during|after|before|because)\b|$)/iu);
  const recipient = String(sentence.predicate || '').match(/\bto\s+(.+?)(?=\b(?:for|during|after|before|because)\b|$)/iu);
  const predicate = head(String(sentence.predicate || '').split(/\b(?:for|during|after|before|because|by)\b/iu)[0]);
  let actor = passive ? head(by?.[1] || '') : head(sentence.subject || '');
  const patient = passive ? head(sentence.subject || '') : head(recipient?.[1] || predicate.join(' '));
  let root = verb.grammar?.copula ? stem(predicate.at(-1) || '') : String(verb.infinitive || '').toLowerCase(), copula = Boolean(verb.grammar?.copula);
  const state = String(text).match(/^(.*?)\b(?:is|are|was|were)\s+(?:not\s+)?([^.!?]+)/iu), stateWords = state ? head(state[2].split(/\b(?:by|for|in|from|before|after)\b/iu)[0]) : [], stateHead = stateWords.at(-1);
  if (stateHead && !/(?:ed|en)$/u.test(stateHead) && nlp(stateHead).has('#Adjective')) { root = stateHead; actor = head(state[1]); copula = true; }
  const negative = Boolean(verb.negative || /\b(?:no|neither|none|nobody|nothing|no-one)\b/iu.test(sentence.subject || ''));
  const clauses = nested ? [] : text.split(/\s*(?:;|\b(?:but|whereas|while|although|however)\b)\s*/iu).filter(Boolean);
  return { sentence, verbs: verbs.map(item => ({ text: item.text, terms: item.terms.map(term => ({ tags: term.tags })) })), actor, patient, root, negative, passive, copula, words: head(text), frames: clauses.length > 1 ? clauses.slice(0, 8).map(clause => inNoteGrammar(clause, true)) : [] };
}

export function inNoteQuery(query) {
  const text = String(query || '').trim(); let grammar = inNoteGrammar(text);
  // Resolve bare imperatives whose first word is also a noun ("match either
  // word", "cross out some text") through their determiner/particle grammar.
  const imperative = !grammar.verbs.length && /^\p{L}+\s+(?:(?:out|up|off|on|away|down|back|over)\s+)?(?:a|an|the|this|that|these|those|my|your|our|either|any|some|each)\b/iu.test(text);
  if (imperative) { const firstWord = text.match(/^\p{L}+/u)[0], doc = nlp(text, { [firstWord]: 'Verb' }), sentence = doc.sentences().json()[0]?.sentence || {}; grammar = { ...grammar, sentence, verbs: doc.verbs().json({ offset: true }), actor: [], root: firstWord.toLowerCase() }; }
  const question = /\?\s*$/u.test(text) || /^(?:how|why|what|where|when|who|which|can|could|does|do|is|are|should)\b/iu.test(text);
  const core = text.replace(/^(?:how\s+(?:can|could|do|does|should)\s+(?:i|we|you)\s+|please\s+)/iu, '').replace(/[?!.]+$/u, '').trim();
  const first = grammar.verbs[0], infinitive = first?.terms.some(term => term.tags.includes('Infinitive') || term.tags.includes('Imperative'));
  const request = question || !grammar.sentence.subject && infinitive && !grammar.passive && !/\bby\b/iu.test(text) && !/^\S+\s+(?:is|are|was|were|has|have|had)\b/iu.test(text);
  const claim = request ? nlp(`Someone ${core}`).sentences().toPresentTense().text() : text;
  const lookup = question || /^(?:find|locate|search\s+for|look\s+for|show\s+me|tell\s+me)\b/iu.test(text);
  return { text, core, grammar, question, request, lookup, claim };
}

// MNLI hypotheses are sentences. Complete only a subjectless, finite past
// predicate; preserve tense, polarity and participants without adding ability.
export function inNoteFragmentClaim(query) {
  const grammar = query.grammar, verb = grammar.verbs[0];
  if (query.request || grammar.sentence.subject || grammar.actor.length || grammar.passive || grammar.verbs.length !== 1 || !verb.terms.some(term => term.tags.includes('PastTense')) || verb.terms.some(term => term.tags.includes('Participle'))) return '';
  return `Someone ${query.text.replace(/[.!?]+$/u, '')}.`;
}

// These checks inspect the complete occurrence, before any phrase is selected.
// They apply only to a shared predicate, so passive paraphrases and different
// verbs expressing the same event remain the relevance model's responsibility.
export function inNoteConflict(query, source) {
  const first = query.grammar, second = source;
  if (second.frames?.length) {
    const predicateFrames = second.frames.filter(frame => stem(frame.root) === stem(first.root));
    if (first.actor.length && predicateFrames.length && overlap(first.actor, second.words) && !predicateFrames.some(frame => overlap(first.actor, frame.actor))) return 'different-clause-actor';
    if (first.passive && !first.actor.length && first.patient.length && predicateFrames.length && overlap(first.patient, second.words) && !predicateFrames.some(frame => overlap(first.patient, frame.copula ? frame.actor : frame.patient))) return 'different-clause-patient';
    const relevant = predicateFrames.filter(frame => !first.actor.length || overlap(first.actor, frame.actor));
    if (relevant.length) return relevant.map(frame => inNoteConflict(query, frame)).every(Boolean) ? inNoteConflict(query, relevant[0]) : '';
  }
  const opposite = inNoteAntonyms(first.root, second.root), shared = overlap(first.actor, second.actor) || overlap(first.patient, second.patient);
  if (!query.question && opposite && shared && first.negative === second.negative) return 'opposite-predicate';
  if (!first.root || !second.root || stem(first.root) !== stem(second.root)) return '';
  if (!query.question && first.negative !== second.negative) return 'opposite-polarity';
  if (overlap(first.actor, second.patient) && overlap(first.patient, second.actor) && !overlap(first.actor, second.actor)) return 'reversed-roles';
  if (first.passive && first.actor.length && overlap(first.actor, second.patient) && second.actor.length && !overlap(first.actor, second.actor)) return 'reversed-agent';
  if (first.actor.length && second.actor.length && overlap(first.actor, second.words) && !overlap(first.actor, second.actor) && !first.passive) return 'different-predicate-actor';
  return '';
}

export function inNoteRoleMatch(query, source) {
  const first = query.grammar;
  if (source.frames?.length) return source.frames.some(frame => inNoteRoleMatch(query, frame));
  const existential = /^(?:someone|somebody)$/iu.test(first.sentence.subject || '') && source.actor.length && first.patient.length && first.patient.every(word => source.patient.includes(word));
  const sameRoles = first.actor.length && first.patient.length && first.actor.at(-1) === source.actor.at(-1) && first.patient.at(-1) === source.patient.at(-1);
  return !query.question && first.verbs.length === 1 && source.verbs.length === 1 && !/\b(?:if|unless|except|denied|deny|claimed|claim)\b/iu.test(source.words.join(' ')) && Boolean(first.root && source.root && stem(first.root) === stem(source.root) && (sameRoles || existential) && first.negative === source.negative);
}

export function inNoteEquivalentState(query, source) {
  const first = query.grammar;
  return Boolean(first.copula && source.copula && overlap(first.actor, source.actor) && inNoteAntonyms(first.root, source.root) && first.negative !== source.negative);
}

export function inNoteInverseRelation(query, source) {
  const first = query.grammar;
  return Boolean(first.verbs.length === 1 && source.verbs.length === 1 && first.actor.length && source.actor.length && first.patient.length && source.patient.length && inNoteAntonyms(first.root, source.root) && first.actor.at(-1) === source.patient.at(-1) && first.patient.at(-1) === source.actor.at(-1) && first.negative === source.negative);
}

// Ground a requested action in an actual predicate, rather than a nearby noun
// such as "security" supplying the entire evidence for "protect".
export function inNoteActionGrounded(query, text, grammar, alignment) {
  if (!query.request || query.lookup || !alignment || !grammar.verbs.length) return true;
  const queryVerbWords = words(query.grammar.root), anchors = alignment.queryRows.map((word, index) => queryVerbWords.includes(word.text) ? index : -1).filter(index => index >= 0);
  if (!anchors.length) return true;
  const ranges = []; let cursor = 0;
  for (const verb of grammar.verbs) { const value = verb.text.trim().replace(/[.!?]+$/u, '').toLowerCase(), from = text.toLowerCase().indexOf(value, cursor); if (from >= 0) { ranges.push([from, from + value.length]); cursor = from + 1; } }
  if (!ranges.length) return true;
  return anchors.every(anchor => {
    let all = 0, predicate = 0;
    alignment.words.forEach((word, row) => { const score = alignment.scores[row * alignment.queryRows.length + anchor]; all = Math.max(all, score); if (ranges.some(([from, to]) => word.from >= from && word.to <= to)) predicate = Math.max(predicate, score); });
    return predicate >= Math.max(.22, .8 * all);
  });
}
