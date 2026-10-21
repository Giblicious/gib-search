import { PassageInNoteMatcher } from './in-note-reader.js';
import { RankedInNoteMatcher } from './ranked-in-note-search.js';
import { inNoteUnits } from './in-note-search.js';
import { inNoteParagraphs, inNoteRetrievalBlocks, inNoteCandidateUnits } from './in-note-hierarchy.js';
import { inNoteReaderInput } from './in-note-reader-codec.js';
import { inNoteQuery, inNoteGrammar, inNoteActionGrounded, inNoteConflict, inNoteRoleMatch, inNoteInverseRelation } from './in-note-logic.js';
import { inNoteWordAlignment, inNoteEvidence } from './in-note-focus.js';
import { inNoteQuestionPlan, inNoteQuestionSlot, inNoteQuestionRange, inNoteQuestionWordEvidence } from './in-note-question-plan.js';

function current(check) { if (check && !check()) { const error = new Error('Superseded by a newer in-note query'); error.name = 'AbortError'; throw error; } }
const reject = reading => ({ ...reading, probability: 0, spans: [], rejected: true });
const factualIntent = intent => !intent.request && (intent.grammar.verbs.some(verb => verb.terms.some(term => ['PastTense', 'Participle', 'Modal'].some(tag => term.tags.includes(tag)))) || /^(?:did|does)\b|^[\p{L}]{2,}ed\b/iu.test(intent.text));
const metaPredicates = new Set('describe discuss mention examine explore consider debate explain read study write record document report say speak'.split(' '));
export function inNoteControlConflict(intent, source, text) {
  const verb = intent.grammar.verbs[0];
  if (!verb?.terms.some(term => term.tags.includes('Gerund')) || intent.grammar.root.split(' ')[0] !== source.root.split(' ')[0]) return false;
  const complement = text.match(/\bthat\s+(.+?)(?=\s*[,;]?\s*\b(?:but|while|whereas|although|however)\b|$)/iu)?.[1];
  if (!complement) return false;
  const embedded = inNoteGrammar(complement, true), parent = source.sentence.subject?.toLowerCase().trim(), child = embedded.sentence.subject?.toLowerCase().trim();
  return Boolean(parent && child && child !== parent && embedded.actor.length && !embedded.actor.some(word => source.actor.includes(word)));
}
const roleStem = word => String(word).toLowerCase().replace(/(?:ing|ed|s)$/u, '');
export function inNoteSemanticRoleConflict(intent, source, alignment) {
  if (intent.request || !alignment || source.frames?.length || !source.actor.length || !source.patient.length) return false;
  // An explicitly requested origin is a participant, even when synonymous
  // transfer verbs give the event different surface grammar.
  const origin = intent.text.match(/\bfrom\s+(.+?)(?=[,;.!?]|$)/iu)?.[1];
  const sourceOrigin = String(source.sentence.predicate || '').match(/\bfrom\s+(.+?)(?=[,;.!?]|$)/iu)?.[1];
  if (origin && sourceOrigin) {
    const wanted = inNoteGrammar(`There is ${origin}.`).words.filter(word => !/^(?:there|is|a|an|the)$/u.test(word));
    const supplied = sourceOrigin.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (wanted.some(word => source.actor.includes(word)) && !wanted.some(word => supplied.includes(word))) return true;
  }
  // Origins, prepositional causes and inverse transfer verbs can express one
  // event with different grammatical subjects. Their frames are not identical.
  if (inNoteInverseRelation(intent, source) || /^(?:through|from|by|about|in|on|at|with|without|for|of)\b|\bfrom\b/iu.test(source.sentence.predicate || '')) return false;
  const query = intent.grammar, actors = new Set(source.actor.map(roleStem)), patients = new Set(source.patient.map(roleStem));
  if ([...actors].some(word => patients.has(word))) return false;
  const roleSupport = (words, role) => {
    const wanted = new Set(words.map(roleStem));
    const columns = alignment.queryRows.map((word, column) => wanted.has(roleStem(word.text)) ? column : -1).filter(column => column >= 0);
    if (!columns.length) return 0;
    return Math.max(...columns.map(column => Math.max(0, ...alignment.words.map((word, row) => role.has(roleStem(word.text)) ? alignment.scores[row * alignment.queryRows.length + column] - (roleStem(word.text) === roleStem(alignment.queryRows[column].text) ? .15 : 0) : 0))));
  };
  const misplaced = (words, wrong, right) => { const other = roleSupport(words, wrong); return other >= .5 && other - roleSupport(words, right) >= .25; };
  if (query.actor.length && query.patient.length) return misplaced(query.actor, patients, actors) && misplaced(query.patient, actors, patients);
  if (query.passive && query.actor.length) return misplaced(query.actor, patients, actors);
  // Existential human references do not identify a particular participant.
  const discretePatient = query.patient.filter(word => !/^(?:people|person|persons|others|someone|somebody|something|things)$/iu.test(word));
  return !query.actor.length && discretePatient.length > 0 && misplaced(discretePatient, actors, patients);
}
const operators = /^(?:someone|somebody|no|not|never|without|cannot|neither|nor|cant|couldnt|wouldnt|shouldnt|dont|doesnt|didnt|wont|isnt|arent|wasnt|werent|hasnt|havent|hadnt)$/u;
export function inNoteNliHypothesis(query) {
  const original = String(query), expanded = original.replace(/\bcan['’]t\b/giu, 'cannot').replace(/\bwon['’]t\b/giu, 'will not').replace(/\b(could|would|should|did|does|do|is|are|was|were|has|have|had|must)n['’]t\b/giu, '$1 not');
  return expanded !== original && !/[.!?]$/u.test(expanded) ? expanded + '.' : expanded;
}
export function inNoteStatement(query) {
  const intent = inNoteQuery(query), grammar = intent.grammar;
  // NLI is trained on sentences. Complete a subjectless finite predicate with
  // an existential subject, preserving its original tense and modal operators.
  if (!intent.request && !grammar.sentence.subject && !grammar.actor.length && !grammar.passive && grammar.verbs.length === 1 && grammar.verbs[0].terms.some(term => ['PastTense', 'Modal'].some(tag => term.tags.includes(tag)))) return `Someone ${String(query).replace(/[.!?]+$/u, '')}.`;
  return '';
}
function nominalStatement(intent) { return !intent.request && (!intent.grammar.verbs.length || !intent.grammar.sentence.predicate && !factualIntent(intent)) ? `There is ${intent.text.replace(/[.!?]+$/u, '')}.` : ''; }

// A narrow literal proof covers uncomplicated clauses, including existential
// subjects and dates. Modals, qualifiers and additional predicates need models.
export function inNoteLiteralRole(intent, source) {
  const query = intent.grammar, existential = /^(?:someone|somebody)$/iu.test(query.sentence.subject || '');
  if ((query.actor.length !== 1 && !existential) || query.patient.length !== 1 || !source.actor.length || !source.patient.includes(query.patient[0])) return false;
  if (!existential && source.actor.length !== 1) return false;
  const temporal = new Set(['on', 'at', 'before', 'after', 'during', ...(source.dates || []).flatMap(text => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])]);
  if (source.patient.some(word => word !== query.patient[0] && !temporal.has(word))) return false;
  if (!inNoteRoleMatch(intent, { ...source, patient: [query.patient[0]] })) return false;
  if (source.verbs.some(verb => verb.terms.some(term => term.tags.includes('Modal') || term.tags.includes('Adverb')))) return false;
  if (query.verbs.some(verb => verb.terms.some(term => term.tags.includes('PastTense'))) && !source.verbs.some(verb => verb.terms.some(term => term.tags.includes('PastTense')))) return false;
  const allowed = new Set([...source.actor, ...source.patient, ...source.verbs.flatMap(verb => verb.text.toLowerCase().match(/[\p{L}]+/gu) || []), ...temporal]);
  return source.words.every(word => allowed.has(word));
}

export class VerifiedInNoteMatcher extends PassageInNoteMatcher {
  constructor(options) {
    super(options);
    this.rawRead = options.read;
    this.answers = new RankedInNoteMatcher({ ...options, cache: null, batchSize: options.answerBatchSize || (options.batchSize === 3 ? 6 : 24) });
    // Both paths use one bounded embedding cache and one model worker. No
    // duplicate encoding or second copy of the note's token representations.
    this.answers.vectors = this.vectors;
    this.answers.embeddings = async (texts, check, prepared) => {
      const values = await this.embeddings(texts, check);
      if (prepared) texts.forEach((text, index) => prepared.set(text, values[index]));
      return values;
    };
    this.answers.snapshot = source => {
      let prepared = this.answers.sources.get(source);
      if (!prepared) {
        const units = inNoteUnits(source, { wholeSentences: true }), paragraphs = units.length > 48 ? inNoteRetrievalBlocks(units, source) : inNoteParagraphs(units, source);
        prepared = { units, unitsByRange: new Map(units.map(unit => [`${unit.from}:${unit.to}`, unit])), paragraphs, representations: [...new Set([...paragraphs.map(paragraph => paragraph.phrase), ...units.flatMap(unit => [unit.phrase, ...unit.topics])])], vectors: new Map(), grammars: new Map() };
        this.answers.sources.set(source, prepared); while (this.answers.sources.size > 2) this.answers.sources.delete(this.answers.sources.keys().next().value);
      }
      return prepared;
    };
    this.answers.selectParagraphs = (paragraphs, prepared, query) => {
      if (prepared.units.length <= 48) return null;
      // Answer ranking already expands its sentence queue adaptively. Retain
      // every qualifying block here rather than capping possible findings.
      const indices = inNoteCandidateUnits(paragraphs, prepared.units, query, Infinity, .3);
      return paragraphs.filter(paragraph => paragraph.indices.some(index => indices.has(index)));
    };
    this.read = (pairs, check) => this.verify(pairs, check);
  }
  enqueue(action) {
    const run = (this.pending || Promise.resolve()).then(action);
    this.pending = run.catch(() => {}); return run;
  }
  prepare(source, check) {
    return this.enqueue(async () => {
      const valid = () => !this.disposed && (!check || check());
      try { await super.prepare(source, valid); if (!this.snapshot(String(source || '')).lazy) await this.answers.prepare(source, valid); }
      finally { this.releasePreparedVectors(); }
    });
  }
  releasePreparedVectors() { for (const note of this.answers.sources.values()) note.vectors.clear(); }
  search(query, source, options = {}) {
    return this.enqueue(async () => {
      const valid = () => !this.disposed && (!options.isCurrent || options.isCurrent());
      current(valid);
      try { return await this.searchVerified(query, source, { ...options, isCurrent: valid }); }
      finally { this.releasePreparedVectors(); }
    });
  }
  async searchVerified(query, source, options) {
    const intent = inNoteQuery(query);
    const question = intent.question && inNoteQuestionPlan(query);
    if (question) {
      const read = this.read; this.read = (pairs, check) => this.verifyQuestion(question, pairs, check);
      try { return await super.searchCurrent(query, source, options); } finally { this.read = read; }
    }
    // Other question forms and commands retain answer ranking; factual
    // fragments use the adapted verifier and independent sentence safeguards.
    const predicate = factualIntent(intent);
    if (predicate) return super.searchCurrent(query, source, options);
    const result = await this.answers.search(query, source, { ...options, diagnostics: true });
    current(options.isCurrent);
    if (intent.request) {
      const refined = result.matches;
      const checks = await this.readSentences(refined.map(match => ({ ...inNoteReaderInput(match.phrase), query })), options.isCurrent);
      current(options.isCurrent);
      const matches = refined.filter((match, index) => checks[index]?.complete === true);
      return options.diagnostics ? { ...result, matches } : matches;
    }
    const readings = await this.verify(result.matches.map(match => ({ ...inNoteReaderInput(match.phrase, match.heading || ''), query })), options.isCurrent);
    const byRange = new Map(result.candidates.map(candidate => [`${candidate.from}:${candidate.to}`, candidate]));
    const matches = result.matches.filter((match, index) => {
      const candidate = byRange.get(`${match.from}:${match.to}`);
      const contextual = (candidate?.contextGuard?.entailment || 0) >= .4 && candidate.contextGuard.entailment - (candidate.headingGuard?.entailment || 0) >= .2;
      const corroborated = candidate?.evidence?.reliable && candidate.entailment >= .4 && readings[index].statementEvidence >= .7;
      return readings[index].complete === true && !readings[index].rejected && (readings[index].probability >= .8 || corroborated || (candidate?.guard?.entailment || 0) >= .8 || contextual) && !(candidate?.guard?.contradiction > .4);
    });
    current(options.isCurrent);
    return options.diagnostics ? { ...result, matches } : matches;
  }
  async verifyQuestion(plan, pairs, check) {
    const checked = await this.readSentences(pairs, check), eligible = pairs.map((pair, index) => ({ pair, index })).filter(row => checked[row.index].complete);
    await this.ensureFocus(eligible.map(row => row.pair), check);
    const verdicts = await this.answers.guarded(eligible.map(({ pair }) => ({ premise: pair.passage.slice(pair.targetFrom, pair.targetTo), hypothesis: plan.hypothesis })), check, this.batchSize);
    const reasons = plan.type === 'cause' ? await this.answers.guarded(eligible.map(({ pair }) => ({ premise: pair.passage.slice(pair.targetFrom, pair.targetTo), hypothesis: plan.hypothesis.replace(/[.!?]+$/u, '') + ' for a reason.' })), check, this.batchSize) : [];
    const results = pairs.map(() => ({ probability: 0, complete: false, spans: [] }));
    eligible.forEach(({ pair, index }, row) => {
      const target = pair.passage.slice(pair.targetFrom, pair.targetTo), grammar = this.answers.grammar(target), verdict = verdicts[row];
      const evidence = inNoteQuestionWordEvidence(inNoteWordAlignment(this.vectors.get(pair.query)?.focus, this.vectors.get(target)?.focus));
      const content = evidence?.body.length && Math.min(...evidence.body) >= .24 && evidence.body.reduce((sum, score) => sum + score, 0) / evidence.body.length >= .4;
      const actors = plan.type === 'boolean' ? new Set(inNoteGrammar(plan.hypothesis).actor) : new Set();
      // A related action does not establish which participant may perform it.
      const actorFloor = Math.max(verdict.entailment, verdict.contradiction) >= .95 ? .3 : .4;
      const actorGrounded = !evidence || evidence.queryWords.every((word, column) => !actors.has(word) || evidence.body[column] >= actorFloor);
      const negative = verdict.contradiction >= .95 && content;
      let support = plan.type === 'boolean' && content ? Math.max(verdict.entailment, verdict.contradiction) : negative ? verdict.contradiction : verdict.entailment;
      if (plan.type === 'boolean' && !content || !(evidence?.supported || content)) support = 0;
      if (plan.type === 'boolean' && content && evidence.reliable && checked[index].probability >= .95 && support >= .65) support = Math.max(support, .82);
      if (plan.type === 'boolean' && content && Math.min(...evidence.body) >= .5 && support >= .5) support = Math.max(support, .82);
      if (plan.type === 'cause' && evidence?.reliable && content && reasons[row]?.entailment >= .6 && verdict.entailment >= .1) support = Math.max(support, .82);
      // A contradiction to an incomplete time/location claim does not supply
      // the missing answer. Only an explicit absence can answer without it.
      if (!inNoteQuestionSlot(plan, target, grammar) && !(negative && /\b(?:no|not|never|none|nowhere)\b/iu.test(target))) support = 0;
      // Breadth may widen retrieval, but a weak topical entailment must not
      // count as an answer even in Broad mode.
      if (support < .8) support = 0;
      if (!actorGrounded) support = 0;
      const probability = Math.max(0, Math.min(1, support >= .8 ? .9 + (support - .8) * .5 : support + .1));
      const range = !negative && inNoteQuestionRange(plan, target, grammar);
      results[index] = { probability, complete: true, spans: [{ from: pair.targetFrom, to: pair.targetTo, sentenceFrom: pair.targetFrom, sentenceTo: pair.targetTo, sentenceProbability: probability, ...(range ? { focusFrom: pair.targetFrom + range.from, focusTo: pair.targetFrom + range.to } : {}) }] };
    });
    current(check); return results;
  }
  snapshot(source) {
    if (this.sources.has(source)) return this.sources.get(source);
    const units = inNoteUnits(source, { wholeSentences: true });
    const lazy = units.length > 48, paragraphs = (lazy ? inNoteRetrievalBlocks(units, source) : inNoteParagraphs(units, source)).map(paragraph => ({ ...paragraph, retrievalTexts: paragraph.indices.map(index => units[index].phrase) }));
    const paragraphOf = new Map(); paragraphs.forEach((paragraph, index) => paragraph.indices.forEach(unit => paragraphOf.set(unit, index)));
    const pairs = units.map((unit, index) => inNoteReaderInput(unit.phrase, [unit.heading, paragraphs[paragraphOf.get(index)].phrase].filter(Boolean).join('\n')));
    const representations = [...new Set([...paragraphs.map(paragraph => paragraph.phrase), ...units.map(unit => unit.phrase)])];
    const snapshot = { units, paragraphs, paragraphOf, pairs, representations, lazy, preparationTexts: lazy ? paragraphs.map(paragraph => paragraph.phrase) : representations };
    this.sources.set(source, snapshot); while (this.sources.size > 2) this.sources.delete(this.sources.keys().next().value);
    return snapshot;
  }
  async readSentences(pairs, check) {
    const results = [];
    for (let offset = 0; offset < pairs.length; offset += this.batchSize) {
      current(check); const batch = pairs.slice(offset, offset + this.batchSize), readings = await this.rawRead(batch); current(check);
      if (readings.length !== batch.length) throw new Error('Incomplete in-note sentence results');
      results.push(...readings);
    }
    return results;
  }
  async ensureFocus(pairs, check) {
    const texts = [...new Set(pairs.flatMap(pair => [pair.passage.slice(pair.targetFrom, pair.targetTo), pair.query]))];
    // Touch retained word states before inserting replacements, so unrelated
    // note preparation cannot evict the very evidence being checked.
    for (const text of texts) { const value = this.vectors.get(text); if (value?.focus) this.rememberVector(text, value); }
    const missing = texts.filter(text => !this.vectors.get(text)?.focus);
    for (let offset = 0; offset < missing.length; offset += this.batchSize) {
      current(check); const batch = missing.slice(offset, offset + this.batchSize), values = await this.embed(batch); current(check);
      batch.forEach((text, index) => this.rememberVector(text, values[index]));
    }
  }
  async verify(pairs, check) {
    current(check);
    const readings = await this.readSentences(pairs, check); current(check);
    if (readings.length !== pairs.length) throw new Error('Incomplete in-note sentence results');
    const selected = pairs.map((pair, index) => ({ pair, index, score: readings[index].probability })).filter(row => row.score >= (nominalStatement(inNoteQuery(row.pair.query)) ? .05 : .1) && readings[row.index].complete !== false && !inNoteQuery(row.pair.query).request);
    const verdicts = await this.answers.guarded(selected.map(({ pair }) => ({ premise: pair.passage.slice(pair.targetFrom, pair.targetTo), hypothesis: inNoteNliHypothesis(pair.query) })), check);
    const extra = [];
    selected.forEach((row, index) => {
      if (row.score < .95 || verdicts[index].contradiction > .4 || verdicts[index].entailment >= .5) return;
      const clauses = row.pair.passage.slice(row.pair.targetFrom, row.pair.targetTo).split(/[;:]\s+|,?\s+\b(?:but|whereas|while|although|however)\b\s+/iu).filter(text => text.trim().split(/\s+/).length >= 4);
      if (clauses.length > 1 && clauses.length <= 4) for (const premise of clauses) extra.push({ index, premise, hypothesis: inNoteNliHypothesis(row.pair.query) });
    });
    const completions = selected.map((row, index) => ({ index, premise: row.pair.passage.slice(row.pair.targetFrom, row.pair.targetTo), hypothesis: inNoteNliHypothesis(inNoteStatement(row.pair.query) || nominalStatement(inNoteQuery(row.pair.query))) })).filter(row => row.hypothesis && verdicts[row.index].entailment < .5 && verdicts[row.index].contradiction <= .4);
    const completed = await this.answers.guarded(completions, check), completionByIndex = new Map();
    completions.forEach((row, index) => completionByIndex.set(row.index, completed[index]));
    const local = await this.answers.guarded(extra, check), proof = new Map();
    extra.forEach((row, index) => proof.set(row.index, Math.max(proof.get(row.index) || 0, local[index].entailment)));
    selected.forEach((row, index) => {
      const verdict = verdicts[index], completion = completionByIndex.get(index), evidence = Math.max(verdict.entailment, proof.get(index) || 0, completion?.entailment || 0);
      const queryIntent = inNoteQuery(row.pair.query), minimumEvidence = nominalStatement(queryIntent) ? .35 : queryIntent.grammar.verbs.length > 1 ? .2 : .1;
      const score = verdict.contradiction > .4 || completion?.contradiction > .4 || evidence < minimumEvidence ? 0 : 1 - (1 - row.score) * (1 - evidence);
      // This is a combined relevance score, not a calibrated probability.
      readings[row.index] = { ...readings[row.index], probability: score, directStatementEvidence: Math.max(verdict.entailment, proof.get(index) || 0), statementEvidence: evidence, weakStatementEvidence: evidence < .1, spans: readings[row.index].spans.map(span => ({ ...span, sentenceProbability: score })) };
    });
    // Attribution also provides a cheap independent content check. Re-encode
    // only a shortlisted sentence if its optional word states were evicted.
    await this.ensureFocus(pairs.filter((pair, index) => readings[index].probability >= .8), check);
    return readings.map((reading, index) => {
      const pair = pairs[index], target = pair.passage.slice(pair.targetFrom, pair.targetTo), intent = inNoteQuery(pair.query), grammar = inNoteGrammar(target), conflict = inNoteConflict(intent, grammar);
      if (reading.complete !== true) return reject(reading);
      if (/^no\b/iu.test(intent.text) && metaPredicates.has(grammar.root.split(' ')[0])) return reject(reading);
      if (inNoteControlConflict(intent, grammar, target)) return reject(reading);
      if (conflict && !(['different-clause-actor', 'different-clause-patient', 'different-predicate-actor'].includes(conflict) && grammar.frames?.length >= 2)) return reject(reading);
      if (!conflict && inNoteLiteralRole(intent, grammar)) return { ...reading, probability: 1, spans: [{ from: pair.targetFrom, to: pair.targetTo, sentenceFrom: pair.targetFrom, sentenceTo: pair.targetTo, sentenceProbability: 1 }] };
      if (reading.probability < .8) return reading;
      const alignment = inNoteWordAlignment(this.vectors.get(pair.query)?.focus, this.vectors.get(target)?.focus);
      if (!alignment) return reject(reading);
      if (inNoteSemanticRoleConflict(intent, grammar, alignment)) return reject(reading);
      const indices = alignment.queryRows.map((word, column) => operators.test(word.text) ? -1 : column).filter(column => column >= 0);
      const scores = new Float32Array(alignment.words.length * indices.length);
      alignment.words.forEach((word, row) => indices.forEach((column, index) => { scores[row * indices.length + index] = alignment.scores[row * alignment.queryRows.length + column]; }));
      const evidence = inNoteEvidence({ ...alignment, queryRows: indices.map(column => alignment.queryRows[column]), scores });
      if (evidence && (!evidence.supported || reading.weakStatementEvidence && !evidence.reliable)) return reject(reading);
      const query = intent.grammar;
      const heads = query.verbs.map(verb => verb.terms.find(term => term.tags.includes('Verb') && !term.tags.some(tag => ['Modal', 'Auxiliary', 'Particle'].includes(tag)))?.text?.toLowerCase()).filter(Boolean);
      if (!heads.length && /^[\p{L}]{2,}ed\b/iu.test(pair.query)) heads.push(pair.query.match(/^\p{L}+/u)[0].toLowerCase());
      if (factualIntent(intent) && !query.negative && !query.copula && heads.length) {
        if (!query.passive && grammar.verbs.length === 1 && metaPredicates.has(grammar.root.split(' ')[0]) && !metaPredicates.has(query.root.split(' ')[0]) && reading.directStatementEvidence < .8) return reject(reading);
        // Participles can be tagged as adjectives. Outside a copular clause,
        // require stronger independent evidence before treating one as an act.
        const predicates = [...grammar.verbs.flatMap(verb => verb.terms.filter(term => term.tags.includes('Verb') && !term.tags.includes('Auxiliary')).map(term => ({ text: term.text }))), ...grammar.adjectives.filter(text => grammar.copula || reading.statementEvidence >= .5 && /(?:ed|en)$/iu.test(text)).map(text => ({ text })), ...(grammar.copula && grammar.sentence.predicate ? [{ text: grammar.sentence.predicate }] : []), ...(target.match(/[\p{L}]+(?:tion|sion|ment|ance|ence|ing)\b/giu) || []).map(text => ({ text }))];
        if (!heads.every(root => inNoteActionGrounded({ ...intent, request: true, lookup: false, grammar: { ...query, root } }, target, { ...grammar, verbs: predicates }, alignment, { relativeFloor: .6, minimum: .24 }))) return reject(reading);
      }
      return reading;
    });
  }
  dispose() {
    this.answers.dispose();
    for (const key of ['sources', 'classifications', 'results', 'ranks', 'guards', 'grammars', 'rankedResults']) this.answers[key].clear();
    super.dispose();
  }
}
