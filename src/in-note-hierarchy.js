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
