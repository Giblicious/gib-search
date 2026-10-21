// Bounded paragraph windows keep retrieval within the encoder's input budget.
// Sentence indices and source offsets survive every refinement stage.
export function inNoteParagraphs(units, source) {
  const paragraphs = []; let group = null;
  for (const [index, unit] of units.entries()) {
    const key = `${unit.paragraphFrom}:${unit.paragraphTo}`;
    if (!group || group.key !== key || group.indices.length >= 6 || group.phrase.length + unit.phrase.length > 900) {
      group = { key, from: unit.from, to: unit.to, phrase: '', indices: [], isHeading: unit.isHeading };
      paragraphs.push(group);
    }
    group.indices.push(index); group.to = unit.to;
    group.phrase += `${group.phrase ? ' ' : ''}${unit.phrase}`;
    group.sourcePhrase = source.slice(group.from, group.to);
  }
  return paragraphs;
}

export function inNoteDot(first, second) {
  let result = 0; for (let index = 0; index < first.length; index++) result += first[index] * second[index]; return result;
}

// Retrieval windows can span short paragraphs; sentence checks and highlights
// still use the original occurrence boundaries. Headings remain independent.
export function inNoteRetrievalBlocks(units, source) {
  const blocks = []; let block;
  units.forEach((unit, index) => {
    if (!block || unit.isHeading || block.isHeading || block.heading !== unit.heading || block.indices.length >= 6 || block.phrase.length + unit.phrase.length > 900) {
      block = { from: unit.from, to: unit.to, phrase: '', indices: [], heading: unit.heading, isHeading: unit.isHeading }; blocks.push(block);
    }
    block.indices.push(index); block.to = unit.to; block.phrase += (block.phrase ? ' ' : '') + unit.phrase; block.sourcePhrase = source.slice(block.from, block.to);
  });
  return blocks;
}

export function inNoteCandidateUnits(paragraphs, units, query, limit = 12, margin = .25) {
  const sorted = paragraphs.slice().sort((a, b) => b.similarity - a.similarity), peak = Math.max(0, ...sorted.filter(paragraph => !paragraph.isHeading).map(paragraph => paragraph.similarity));
  const selected = new Set(sorted.filter(paragraph => paragraph.similarity >= Math.max(.3, peak - margin)).slice(0, limit).flatMap(paragraph => paragraph.indices));
  const words = text => String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [], keys = new Set(words(query).filter(word => !/^(?:a|an|the|of|to|by|from|for|and|or|is|are|was|were|can|could|how|what|where|when|why|who)$/u.test(word)));
  const lexical = units.map((unit, index) => ({ index, hits: new Set(words(unit.phrase).filter(word => keys.has(word))).size })).filter(row => row.hits);
  lexical.sort((a, b) => b.hits - a.hits || a.index - b.index); lexical.filter((row, index) => index < limit || row.hits === keys.size).forEach(row => selected.add(row.index));
  return selected;
}
