import fs from 'node:fs/promises';
import path from 'node:path';
const directory = process.argv.find(value => value.startsWith('--dictionary-dir='))?.slice(17);
if (!directory) throw new Error('Pass --dictionary-dir pointing to the WordNet 3.1 dict directory.');
const synsets = new Map(), sourceHashes = {}, { createHash } = await import('node:crypto');
for (const pos of ['adj', 'verb']) {
  const file = await fs.readFile(path.join(directory, `data.${pos}`), 'utf8'); sourceHashes[pos] = createHash('sha256').update(file).digest('hex');
  for (const line of file.split(/\r?\n/u)) {
    if (!/^\d{8}\s/u.test(line)) continue;
    const fields = line.split('|')[0].trim().split(/\s+/u), offset = fields[0], type = pos === 'adj' ? 'a' : 'v', count = Number.parseInt(fields[3], 16), words = [];
    let index = 4; for (let word = 0; word < count; word++, index += 2) words.push(fields[index].replace(/\([^)]*\)$/u, '').toLowerCase());
    const pointers = Number(fields[index++]), opposites = [];
    for (let pointer = 0; pointer < pointers; pointer++, index += 4) if (fields[index] === '!') opposites.push({ key: `${fields[index + 2]}:${fields[index + 1]}`, source: Number.parseInt(fields[index + 3].slice(0, 2), 16) - 1, target: Number.parseInt(fields[index + 3].slice(2), 16) - 1 });
    synsets.set(`${type}:${offset}`, { words, opposites });
  }
}
const pairs = new Set();
for (const synset of synsets.values()) for (const pointer of synset.opposites) {
  const first = synset.words[pointer.source], second = synsets.get(pointer.key)?.words[pointer.target];
  if (first && second && first !== second && /^[a-z-]+$/u.test(first) && /^[a-z-]+$/u.test(second)) pairs.add([first, second].sort().join('|'));
}
const sorted = [...pairs].sort(), source = `// Generated from Princeton WordNet 3.1 adjective/verb lexical antonym pointers.\n// Regenerate with scripts/generate-in-note-antonyms.mjs; license: THIRD_PARTY_NOTICES.txt.\n// Input SHA-256: ${JSON.stringify(sourceHashes)}\nconst PAIRS = new Set(${JSON.stringify(sorted.join(';'))}.split(';'));\nexport function inNoteAntonyms(first, second) { return Boolean(first && second && first !== second && PAIRS.has([first, second].sort().join('|'))); }\n`;
await fs.writeFile(new URL('../src/in-note-antonyms.js', import.meta.url), source);
const dictionary = await fs.readFile(path.join(directory, 'data.adj'), 'utf8'), license = dictionary.split(/\r?\n/u).filter(line => /^\s{2}\d+\s/u.test(line)).map(line => line.replace(/^\s{2}\d+\s?/u, '')).join('\n');
let notices = `Princeton WordNet 3.1\n=====================\n${license}\n`;
for (const [name, file] of [['compromise', 'LICENSE'], ['efrt', 'LICENSE'], ['grad-school', 'LICENSE'], ['suffix-thumb', 'LICENSE.txt']]) {
  const manifest = JSON.parse(await fs.readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')), contents = await fs.readFile(new URL(`../node_modules/${name}/${file}`, import.meta.url), 'utf8');
  notices += `\n${name} ${manifest.version}\n=====================\n${contents}\n`;
}
await fs.writeFile(new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url), notices.replace(/[ \t]+$/gmu, '').trimEnd() + '\n');
console.log(`Generated ${pairs.size} adjective/verb antonym pairs (${source.length} source characters).`);
