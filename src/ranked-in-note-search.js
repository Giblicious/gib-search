import { InNoteMatcher, inNoteUnits, inNotePhraseHighlight } from './in-note-search.js';
import { inNoteWordAlignment, inNoteEvidence } from './in-note-focus.js';
import { inNoteGrammar, inNoteQuery, inNoteFragmentClaim, inNoteConflict, inNoteRoleMatch, inNoteEquivalentState, inNoteInverseRelation, inNoteActionGrounded } from './in-note-logic.js';
import { inNoteParagraphs, inNoteDot } from './in-note-hierarchy.js';

function current(check) { if (check && !check()) { const error = new Error('Superseded by a newer in-note query'); error.name = 'AbortError'; throw error; } }
function remember(cache, key, value, limit) { cache.delete(key); cache.set(key, value); while (cache.size > limit) cache.delete(cache.keys().next().value); return value; }

export class RankedInNoteMatcher extends InNoteMatcher {
  constructor(options) {
    super(options); this.rank = options.rank; this.guard = options.guard; this.ranks = new Map(); this.guards = new Map(); this.grammars = new Map(); this.rankedResults = new Map(); this.cache = options.cache;
    this.cacheReady = this.cache ? this.cache.load().then(entries => { for (const [text, vector] of entries) remember(this.vectors, text, vector, 2048); }).catch(() => {}) : Promise.resolve();
  }
  saveVectors() {
    if (!this.cache || this.disposed) return;
    clearTimeout(this.cacheTimer); this.cacheTimer = setTimeout(() => { const allowed = new Set([...this.sources.values()].flatMap(source => source.representations)); this.cache.save(this.vectors, allowed).catch(() => {}); }, 1500);
  }
  dispose() { this.disposed = true; clearTimeout(this.cacheTimer); this.cacheTimer = null; }
  snapshot(source) {
    let prepared = this.sources.get(source);
    if (!prepared) { const units = inNoteUnits(source), paragraphs = inNoteParagraphs(units, source); prepared = remember(this.sources, source, { units, unitsByRange: new Map(units.map(unit => [`${unit.from}:${unit.to}`, unit])), paragraphs, representations: [...new Set([...paragraphs.map(paragraph => paragraph.phrase), ...units.flatMap(unit => [unit.phrase, ...unit.topics])])], vectors: new Map(), grammars: new Map() }, 2); }
    return prepared;
  }
  prepare(source, isCurrent) {
    const run = (this.pending || Promise.resolve()).then(async () => {
      await this.cacheReady; current(isCurrent); const prepared = this.snapshot(String(source || '')); this.activeGrammars = prepared.grammars; this.preparing = true;
      try {
        for (let offset = 0; offset < prepared.representations.length; offset += 4) await this.embeddings(prepared.representations.slice(offset, offset + 4), isCurrent, prepared.vectors);
        for (let offset = 0; offset < prepared.units.length; offset += 4) { current(isCurrent); for (const unit of prepared.units.slice(offset, offset + 4)) this.grammar(unit.phrase); await this.yieldControl(); }
      }
      finally { this.preparing = false; this.saveVectors(); }
    });
    this.pending = run.catch(() => {}); return run;
  }
  grammar(text) { let value = this.activeGrammars?.get(text) || this.grammars.get(text); if (!value) value = remember(this.grammars, text, inNoteGrammar(text), 2048); this.activeGrammars?.set(text, value); return value; }
  async ranking(pairs, check) {
    const resolved = new Map(), missing = new Map(), keys = pairs.map(pair => pair.cacheKey || `${pair.query}\0${pair.passage}`);
    pairs.forEach((pair, index) => { const key = keys[index]; if (this.ranks.has(key)) resolved.set(key, this.ranks.get(key)); else missing.set(key, pair); });
    const entries = [...missing].sort((first, second) => first[1].passage.length - second[1].passage.length);
    for (let offset = 0; offset < entries.length; offset += this.batchSize) {
      current(check); const batch = entries.slice(offset, offset + this.batchSize), scores = await this.rank(batch.map(([, pair]) => pair)); current(check);
      if (scores.length !== batch.length || scores.some(value => !Number.isFinite(value))) throw new Error('In-note relevance model returned invalid scores');
      batch.forEach(([key], index) => { resolved.set(key, scores[index]); remember(this.ranks, key, scores[index], 640); }); await this.yieldControl();
    }
    return keys.map(key => resolved.get(key));
  }
  async guarded(pairs, check, maximumBatchSize = this.batchSize) {
    const keys = pairs.map(pair => `${pair.premise}\0${pair.hypothesis}`), resolved = new Map(), missing = new Map();
    pairs.forEach((pair, index) => { if (this.guards.has(keys[index])) resolved.set(keys[index], this.guards.get(keys[index])); else missing.set(keys[index], pair); });
    const entries = [...missing];
    for (let offset = 0; offset < entries.length; offset += maximumBatchSize) {
      current(check); const batch = entries.slice(offset, offset + maximumBatchSize), scores = await this.guard(batch.map(([, pair]) => pair)); current(check);
      if (scores.length !== batch.length || scores.some(value => !['entailment', 'neutral', 'contradiction'].every(key => Number.isFinite(value?.[key]) && value[key] >= 0 && value[key] <= 1) || Math.abs(value.entailment + value.neutral + value.contradiction - 1) > .01)) throw new Error('In-note consistency model returned invalid scores');
      batch.forEach(([key], index) => { resolved.set(key, scores[index]); remember(this.guards, key, scores[index], 512); }); await this.yieldControl();
    }
    return keys.map(key => resolved.get(key));
  }
  async questionRanking(pool, pairs, check) {
    const groups = new Map();
    pairs.forEach((pair, index) => { const key = pair.cacheKey; if (!groups.has(key)) groups.set(key, { pair, similarity: pool[index].similarity, indices: [] }); const group = groups.get(key); group.similarity = Math.max(group.similarity, pool[index].similarity); group.indices.push(index); });
    const ordered = [...groups.values()].sort((a, b) => b.similarity - a.similarity), result = new Array(pool.length); let peak = -Infinity;
    // Score a dense shortlist first. Continue when its tail still contains
    // relevant answers or the next group is tied in dense similarity. This
    // bounds typical work without a fixed cap on findings or occurrences.
    for (let offset = 0; offset < ordered.length;) {
      const batch = ordered.slice(offset, offset + 12), scores = await this.ranking(batch.map(group => group.pair), check);
      scores.forEach((score, index) => { peak = Math.max(peak, score); for (const position of batch[index].indices) result[position] = score; }); offset += batch.length;
      const relevant = score => score >= peak - 1.5;
      const boundary = Math.min(...batch.filter((group, index) => relevant(scores[index])).map(group => group.similarity));
      if (peak < -9 || offset < ordered.length && !(offset < 24 && peak < 0) && !scores.slice(-6).some(relevant) && ordered[offset].similarity < boundary - .005) break;
    }
    return result;
  }
  async sentenceMeaning(units, query, check) {
    const groups = new Map();
    units.forEach((unit, index) => { if (!groups.has(unit.phrase)) groups.set(unit.phrase, { phrase: unit.phrase, similarity: unit.similarity, indices: [] }); const group = groups.get(unit.phrase); group.similarity = Math.max(group.similarity, unit.similarity); group.indices.push(index); });
    const ordered = [...groups.values()].sort((a, b) => b.similarity - a.similarity), result = units.map(() => ({ entailment: 0, neutral: 1, contradiction: 0, unscored: true })); let peak = 0;
    for (let offset = 0; offset < ordered.length;) {
      const batch = ordered.slice(offset, offset + 12), scores = await this.meaning(batch.map(unit => ({ premise: unit.phrase, hypothesis: query })), check);
      scores.forEach((score, index) => { peak = Math.max(peak, score.entailment); for (const position of batch[index].indices) result[position] = score; }); offset += batch.length;
      const relevant = score => score.entailment >= .4 && score.contradiction <= .4;
      const boundary = Math.min(...batch.filter((unit, index) => relevant(scores[index])).map(unit => unit.similarity));
      // Continue through answer-rich tails and dense ties. A sparse query stops
      // after its useful neighborhood, without capping findings or occurrences.
      if (offset < ordered.length && !(offset < 24 && peak < .4) && !scores.slice(-6).some(relevant) && ordered[offset].similarity < boundary - .005) break;
    }
    return result;
  }
  async searchCurrent(query, source, { breadth = 'balanced', isCurrent, diagnostics = false, onProgress } = {}) {
    await this.cacheReady; current(isCurrent); const text = String(source || ''), literal = String(query || '').trim(); if (literal.length < 2 || !text.trim()) return [];
    const cacheKey = JSON.stringify([literal, text, breadth]), cached = this.rankedResults.get(cacheKey); if (cached && !diagnostics) return cached;
    const prepared = this.snapshot(text), intent = inNoteQuery(literal); this.activeGrammars = prepared.grammars;
    const publish = async (stage, ranges) => { current(isCurrent); await onProgress?.({ stage, ranges }); current(isCurrent); await this.yieldControl(); };
    const [queryVector] = await this.embeddings([literal], isCurrent);
    await this.embeddings(prepared.paragraphs.map(paragraph => paragraph.phrase), isCurrent, prepared.vectors);
    const paragraphs = prepared.paragraphs.map(paragraph => ({ ...paragraph, similarity: Math.max(inNoteDot(queryVector, prepared.vectors.get(paragraph.phrase)), ...paragraph.indices.map(index => prepared.vectors.has(prepared.units[index].phrase) ? inNoteDot(queryVector, prepared.vectors.get(prepared.units[index].phrase)) : 0)) })).sort((a, b) => b.similarity - a.similarity);
    const paragraphPeak = Math.max(0, ...paragraphs.filter(paragraph => !paragraph.isHeading).map(paragraph => paragraph.similarity)), paragraphFloor = Math.max(.30, paragraphPeak - .30);
    const selectedParagraphs = paragraphs.filter(paragraph => paragraph.isHeading || paragraph.similarity >= paragraphFloor);
    const unitIndices = new Set(selectedParagraphs.flatMap(paragraph => paragraph.indices));
    await publish('paragraph', selectedParagraphs.filter(paragraph => !paragraph.isHeading && paragraph.similarity >= paragraphPeak - .1));
    const verified = await super.searchCurrent(literal, text, { breadth, isCurrent, diagnostics: true, retrievalOnly: intent.lookup, unitIndices, scoreCandidates: (units, query, check) => this.sentenceMeaning(units, query, check), onCandidates: async candidates => {
      const bodies = candidates.filter(unit => !unit.isHeading), peak = Math.max(0, ...bodies.map(unit => unit.bodySimilarity));
      await publish('sentence', bodies.filter(unit => unit.bodySimilarity >= Math.max(.4, peak - .15)));
    } });
    const candidates = verified.candidates.filter(unit => !unit.unscored), actionGrounding = new Map();
    const groundedAction = unit => { if (!intent.request || intent.lookup) return true; return actionGrounding.get(unit.phrase) ?? inNoteActionGrounded(intent, unit.phrase, this.grammar(unit.phrase), inNoteWordAlignment(this.vectors.get(literal).focus, prepared.vectors.get(unit.phrase).focus)); };
    if (intent.request && !intent.lookup) {
      const uncertain = [...new Map(candidates.filter(unit => !groundedAction(unit) && !inNoteConflict(intent, this.grammar(unit.phrase))).map(unit => [unit.phrase, unit])).values()];
      const scores = await this.guarded(uncertain.map(unit => ({ premise: unit.phrase, hypothesis: literal })), isCurrent);
      uncertain.forEach((unit, index) => actionGrounding.set(unit.phrase, scores[index].entailment >= .8 && scores[index].contradiction <= .1));
    }
    const strict = verified.matches.filter(unit => !inNoteConflict(intent, this.grammar(unit.phrase)) && groundedAction(unit));
    const finish = matches => {
      matches.sort((first, second) => first.from - second.from);
      // Attribution only narrows a verified sentence; it cannot introduce hits.
      matches = matches.map(unit => { const original = prepared.unitsByRange.get(`${unit.from}:${unit.to}`); const highlight = inNotePhraseHighlight(unit, queryVector.focus, prepared.vectors.get(unit.phrase).focus, 0, original?.displayPositions); return { ...unit, ...(highlight ? { highlight } : {}) }; });
      current(isCurrent); remember(this.rankedResults, cacheKey, matches, 8); this.saveVectors();
      return diagnostics ? { matches, candidates } : matches;
    };
    if (!intent.request) return finish(await this.fragmentMatches(literal, intent, candidates, strict, prepared, queryVector, breadth, isCurrent));
    let matches = [...strict];
    for (const unit of candidates) {
      const grammar = this.grammar(unit.phrase);
      if (!inNoteConflict(intent, grammar) && inNoteRoleMatch(intent, grammar) && !matches.some(match => match.from === unit.from && match.to === unit.to)) {
        const queryVector = this.vectors.get(literal), vector = prepared.vectors.get(unit.phrase), highlight = inNotePhraseHighlight(unit, queryVector.focus, vector.focus, 0, prepared.units[unit.unitIndex].displayPositions);
        matches.push({ from: unit.from, to: unit.to, phrase: unit.phrase, sourcePhrase: unit.sourcePhrase, score: 1, similarity: unit.similarity, kind: 'semantic', ...(highlight ? { highlight } : {}) });
      }
    }
    const factual = !intent.request && intent.grammar.verbs.length > 0 && intent.grammar.actor.length > 0;
    const inverses = candidates.filter(unit => !inNoteConflict(intent, this.grammar(unit.phrase)) && inNoteInverseRelation(intent, this.grammar(unit.phrase)) && !matches.some(match => match.from === unit.from && match.to === unit.to));
    const inverseScores = await this.guarded(inverses.map(unit => ({ premise: unit.phrase, hypothesis: literal })), isCurrent);
    inverses.forEach((unit, index) => { if (inverseScores[index].entailment >= .8) { const queryVector = this.vectors.get(literal), vector = prepared.vectors.get(unit.phrase), highlight = inNotePhraseHighlight(unit, queryVector.focus, vector.focus, 0, prepared.units[unit.unitIndex].displayPositions); matches.push({ from: unit.from, to: unit.to, phrase: unit.phrase, sourcePhrase: unit.sourcePhrase, score: inverseScores[index].entailment, similarity: unit.similarity, kind: 'semantic', ...(highlight ? { highlight } : {}) }); } });
    const action = intent.request && !intent.lookup;
    const complex = matches.filter(unit => !inNoteEquivalentState(intent, this.grammar(unit.phrase)) && (factual || action || /\b(?:but|although|however|instead|rather|denied|deny)\b/iu.test(unit.phrase)));
    const consistency = await this.guarded(complex.map(unit => { const candidate = candidates.find(value => value.from === unit.from && value.to === unit.to); return { premise: candidate?.contextual ? `${candidate.heading}\n${unit.phrase}` : unit.phrase, hypothesis: literal }; }), isCurrent);
    const rejected = new Set(complex.filter((unit, index) => consistency[index].contradiction >= .9 || action && consistency[index].contradiction > .4).map(unit => `${unit.from}:${unit.to}`));
    matches = matches.filter(unit => !rejected.has(`${unit.from}:${unit.to}`));
    if (intent.request) {
      const queryVector = this.vectors.get(literal), bodies = candidates.filter(unit => !unit.isHeading), best = Math.max(...(bodies.length ? bodies : candidates).map(unit => intent.lookup ? unit.similarity : unit.bodySimilarity), 0), floor = Math.max(.4, best - (intent.lookup ? .3 : .2)), pool = [];
      for (const unit of candidates) {
        if (rejected.has(`${unit.from}:${unit.to}`)) continue;
        const wasStrict = strict.some(match => match.from === unit.from && match.to === unit.to);
        if (!wasStrict && (unit.isHeading || (intent.lookup ? unit.similarity : unit.bodySimilarity) < floor)) continue;
        const grammar = this.grammar(unit.phrase); unit.conflict = inNoteConflict(intent, grammar); if (unit.conflict) continue;
        if (!groundedAction(unit)) continue;
        if (intent.lookup) { unit.proof = unit.phrase; pool.push(unit); continue; }
        const vector = prepared.vectors.get(unit.phrase), alignment = inNoteWordAlignment(queryVector.focus, vector.focus), evidence = inNoteEvidence(alignment);
        // A weak instruction word may be relaxed only when most actual query
        // concepts are independently grounded in this sentence's body.
        const supports = evidence?.body || [], grounded = supports.length && supports.filter(value => value >= .4).length / supports.length >= 2 / 3;
        if (evidence && !grounded && !intent.lookup && !strict.some(match => match.from === unit.from && match.to === unit.to)) continue;
        unit.bodySupports = supports;
        unit.highlight = inNotePhraseHighlight(unit, queryVector.focus, vector.focus, 0, prepared.units[unit.unitIndex].displayPositions, alignment);
        unit.proof = unit.phrase; pool.push(unit);
      }
      const context = unit => intent.lookup && !/\d/u.test(literal) ? unit.contextHeading ?? unit.heading : unit.heading;
      const pairs = pool.map(unit => ({ query: literal, passage: intent.lookup && context(unit) ? `${context(unit)}\n${unit.phrase}` : unit.phrase, cacheKey: `${literal}\0${intent.lookup ? context(unit) : ''}\0${unit.proof}` }));
      const ranks = intent.lookup ? await this.questionRanking(pool, pairs, isCurrent) : await this.ranking(pairs, isCurrent);
      pool.forEach((unit, index) => { unit.relevance = ranks[index]; });
      const strictPool = pool.filter(unit => strict.some(match => match.from === unit.from && match.to === unit.to)), strictBodies = strictPool.filter(unit => !unit.isHeading), strictPeak = Math.max(...(strictBodies.length ? strictBodies : strictPool).map(unit => unit.relevance), -Infinity);
      if (intent.lookup) matches = [];
      else if (strictPeak >= -5 || new Set(strictPool.map(unit => unit.proof)).size > 8) matches = matches.filter(match => {
        const unit = strictPool.find(value => value.from === match.from && value.to === match.to);
        return !unit || unit.bodySupports.length && unit.bodySupports.every(value => value >= .55) || strictPeak >= -5 && unit.relevance >= strictPeak - 3;
      });
      const peak = Math.max(...ranks.filter(Number.isFinite), -Infinity), questionCheck = intent.lookup && /^(?:how|why|what|where|when|who|which)\b/iu.test(literal), promising = peak < (questionCheck ? -9 : -5) ? [] : pool.filter(unit => unit.relevance >= peak - (intent.lookup ? 2.5 : 3) && !matches.some(match => match.from === unit.from && match.to === unit.to));
      const guards = intent.lookup && !questionCheck ? [] : await this.guarded(promising.map(unit => ({ premise: questionCheck && unit.heading ? `${unit.heading}\n${unit.phrase}` : unit.phrase, hypothesis: questionCheck ? literal : intent.claim })), isCurrent);
      const eligible = promising.filter((unit, index) => {
        unit.guard = guards[index];
        if (!intent.lookup && guards[index].contradiction > .4) { unit.guard = guards[index]; return false; }
        return !questionCheck || !(guards[index].contradiction > .8 || peak < -5 && (guards[index].entailment < .05 || guards[index].contradiction > .25));
      }), acceptedPeak = Math.max(...eligible.map(unit => unit.relevance), -Infinity);
      eligible.forEach(unit => {
        if (intent.lookup && unit.relevance < acceptedPeak - 1.5) return;
        if (matches.some(other => unit.from < other.to && unit.to > other.from)) return;
        if (intent.lookup) unit.highlight = inNotePhraseHighlight(unit, queryVector.focus, prepared.vectors.get(unit.phrase).focus, 0, prepared.units[unit.unitIndex].displayPositions);
        matches.push({ from: unit.from, to: unit.to, phrase: unit.phrase, sourcePhrase: unit.sourcePhrase, score: 1 / (1 + Math.exp(-unit.relevance / 4)), similarity: unit.similarity, kind: 'semantic', ...(unit.highlight ? { highlight: unit.highlight } : {}) });
      });
    }
    return finish(matches);
  }
  async fragmentMatches(query, intent, candidates, strict, prepared, queryVector, breadth, check) {
    const peak = Math.max(0, ...candidates.filter(unit => !unit.isHeading).map(unit => unit.similarity)), pool = [];
    for (const unit of candidates) {
      if (inNoteConflict(intent, this.grammar(unit.phrase))) continue;
      const alignment = inNoteWordAlignment(queryVector.focus, prepared.vectors.get(unit.phrase).focus), evidence = inNoteEvidence(alignment);
      const grammar = this.grammar(unit.phrase), wasStrict = strict.some(match => match.from === unit.from && match.to === unit.to) || inNoteRoleMatch(intent, grammar) || inNoteEquivalentState(intent, grammar);
      if (!wasStrict && (unit.isHeading || unit.similarity < Math.max(.40, peak - .30) || evidence && !evidence.supported)) continue;
      pool.push(Object.assign(unit, { contextEvidence: unit.evidence, evidence, wasStrict }));
    }
    // Rank is useful for ordering work, but its question-trained logits are not
    // calibrated probabilities for terse fragments. Verify those with NLI too.
    const strong = [], weak = []; for (const unit of pool) (unit.wasStrict || unit.entailment >= .1 ? strong : weak).push(unit);
    const ranks = await this.questionRanking(weak, weak.map(unit => ({ query, passage: unit.phrase, cacheKey: `${query}\0\0${unit.phrase}` })), check);
    const scored = [...strong, ...weak.filter((unit, index) => { unit.relevance = ranks[index]; return unit.relevance >= -5; })];
    const guards = await this.guarded(scored.map(unit => ({ premise: unit.phrase, hypothesis: query })), check);
    const claim = inNoteFragmentClaim(intent), completions = claim ? scored.filter((unit, index) => unit.wasStrict && unit.entailment >= .4 && guards[index].entailment < .1 && guards[index].contradiction <= .4 && unit.evidence?.body.every(value => value >= .25)) : [];
    // Use a stable single-pair check only for an otherwise-supported fragment
    // whose incomplete hypothesis remains neutral. Original contradictions veto
    // completion; a newly supplied subject cannot reverse a negative statement.
    const completedScores = await this.guarded(completions.map(unit => ({ premise: unit.phrase, hypothesis: claim })), check, 1), completedMatches = new Set();
    completions.forEach((unit, index) => { unit.completedGuard = completedScores[index]; if (completedScores[index].entailment >= .25 && completedScores[index].contradiction <= .25) completedMatches.add(unit.unitIndex); });
    const references = scored.filter((unit, index) => {
      const body = unit.evidence?.body || [], floor = Math.max(.25, .5 * Math.max(0, ...body));
      return guards[index].entailment < .4 && unit.contextual && unit.wasStrict && unit.contextHeading && unit.contextEvidence?.supported && unit.contextEvidence.support.some((value, anchor) => value >= .5 && value - body[anchor] >= .15) && body.filter(value => value >= floor).length >= Math.ceil(body.length / 2);
    });
    // A heading can resolve a reference only when the sentence adds evidence
    // beyond the heading alone. Prefixing a query-like heading to a date or an
    // unrelated sentence must not turn that occurrence into an entailed claim.
    const contextualScores = await this.guarded(references.flatMap(unit => [{ premise: `${unit.contextHeading}\n${unit.phrase}`, hypothesis: query }, { premise: unit.contextHeading, hypothesis: query }]), check), contextualMatches = new Set();
    references.forEach((unit, index) => {
      const context = contextualScores[index * 2], heading = contextualScores[index * 2 + 1]; unit.contextGuard = context; unit.headingGuard = heading;
      if (context.entailment >= .4 && context.contradiction <= .25 && context.entailment - heading.entailment >= .2) contextualMatches.add(unit.unitIndex);
    });
    const accepted = [];
    scored.forEach((unit, index) => {
      const guard = guards[index], grammar = this.grammar(unit.phrase), equivalent = inNoteEquivalentState(intent, grammar), role = inNoteRoleMatch(intent, grammar);
      const body = unit.evidence?.body || [], local = body.length && body.every(value => value >= .25);
      const supported = guard.entailment >= (breadth === 'precise' ? .60 : .40) || role || equivalent || completedMatches.has(unit.unitIndex);
      const corroborated = unit.wasStrict && unit.entailment >= (breadth === 'precise' ? .6 : breadth === 'broad' ? .3 : .4) && local && guard.entailment >= .03 && guard.contradiction <= .25;
      const contextual = contextualMatches.has(unit.unitIndex);
      unit.guard = guard;
      if (!(supported || corroborated || contextual) || !role && !equivalent && guard.contradiction > .4) return;
      if (accepted.some(other => unit.from < other.to && unit.to > other.from)) return;
      accepted.push({ from: unit.from, to: unit.to, phrase: unit.phrase, sourcePhrase: unit.sourcePhrase, score: guard.entailment, similarity: unit.similarity, kind: 'semantic' });
    });
    return accepted;
  }
}
