import { InNoteMatcher, inNoteUnits, inNotePhraseHighlight } from './in-note-search.js';
import { inNoteWordAlignment, inNoteEvidence } from './in-note-focus.js';
import { inNoteGrammar, inNoteQuery, inNoteConflict, inNoteRoleMatch, inNoteEquivalentState, inNoteInverseRelation, inNoteActionGrounded } from './in-note-logic.js';

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
    if (!prepared) { const units = inNoteUnits(source); prepared = remember(this.sources, source, { units, representations: [...new Set(units.flatMap(unit => [unit.phrase, ...unit.topics]))], vectors: new Map(), grammars: new Map() }, 2); }
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
  async guarded(pairs, check) {
    const keys = pairs.map(pair => `${pair.premise}\0${pair.hypothesis}`), resolved = new Map(), missing = new Map();
    pairs.forEach((pair, index) => { if (this.guards.has(keys[index])) resolved.set(keys[index], this.guards.get(keys[index])); else missing.set(keys[index], pair); });
    const entries = [...missing];
    for (let offset = 0; offset < entries.length; offset += this.batchSize) {
      current(check); const batch = entries.slice(offset, offset + this.batchSize), scores = await this.guard(batch.map(([, pair]) => pair)); current(check);
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
  async searchCurrent(query, source, { breadth = 'balanced', isCurrent, diagnostics = false } = {}) {
    await this.cacheReady; current(isCurrent); const text = String(source || ''), literal = String(query || '').trim(); if (literal.length < 2 || !text.trim()) return [];
    const cacheKey = JSON.stringify([literal, text, breadth]), cached = this.rankedResults.get(cacheKey); if (cached && !diagnostics) return cached;
    const prepared = this.snapshot(text), intent = inNoteQuery(literal); this.activeGrammars = prepared.grammars;
    const verified = await super.searchCurrent(literal, text, { breadth, isCurrent, diagnostics: true, retrievalOnly: intent.lookup });
    const candidates = verified.candidates, actionGrounding = new Map();
    const groundedAction = unit => { if (!intent.request || intent.lookup) return true; return actionGrounding.get(unit.phrase) ?? inNoteActionGrounded(intent, unit.phrase, this.grammar(unit.phrase), inNoteWordAlignment(this.vectors.get(literal).focus, prepared.vectors.get(unit.phrase).focus)); };
    if (intent.request && !intent.lookup) {
      const uncertain = [...new Map(candidates.filter(unit => !groundedAction(unit) && !inNoteConflict(intent, this.grammar(unit.phrase))).map(unit => [unit.phrase, unit])).values()];
      const scores = await this.guarded(uncertain.map(unit => ({ premise: unit.phrase, hypothesis: literal })), isCurrent);
      uncertain.forEach((unit, index) => actionGrounding.set(unit.phrase, scores[index].entailment >= .8 && scores[index].contradiction <= .1));
    }
    const strict = verified.matches.filter(unit => !inNoteConflict(intent, this.grammar(unit.phrase)) && groundedAction(unit));
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
      const queryVector = this.vectors.get(literal), bodies = candidates.filter(unit => !unit.isHeading), best = Math.max(...(bodies.length ? bodies : candidates).map(unit => intent.lookup ? unit.similarity : unit.bodySimilarity), 0), floor = Math.max(intent.lookup ? .4 : .55, best - (intent.lookup ? .3 : .2)), pool = [];
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
    matches.sort((first, second) => first.from - second.from); current(isCurrent); remember(this.rankedResults, cacheKey, matches, 8); this.saveVectors();
    return diagnostics ? { matches, candidates } : matches;
  }
}
