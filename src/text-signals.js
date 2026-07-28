export const TEXT_ANALYSIS_VERSION = 1;

export const EMOTION_HYPOTHESES = {
  joy: 'The writer expresses joy, gratitude, hope, delight, or contentment.',
  sadness: 'The writer expresses sadness, grief, loss, loneliness, sorrow, or melancholy.',
  fear: 'The writer expresses fear, anxiety, dread, danger, vulnerability, or apprehension.',
  anger: 'The writer expresses anger, frustration, resentment, injustice, outrage, or irritation.',
  love: 'The writer expresses love, affection, care, tenderness, attachment, or devotion.',
  surprise: 'The writer expresses surprise, astonishment, shock, wonder, or unexpected discovery.',
};

export const TEXT_SIGNALS = {
  semantic: { label: 'Meaning', description: 'What the writing is about.', engine: 'embedding' },
  emotion: { label: 'Emotion', description: 'The feeling expressed by the writing, not merely its subject.', engine: 'nli' },
  purpose: { label: 'Purpose', description: 'What the writing is trying to accomplish.', engine: 'nli' },
  position: { label: 'Position', description: 'How the writer relates to a reference claim.', engine: 'nli', needsReference: true },
  form: { label: 'Form', description: 'What kind of writing the passage is and how it is presented.', engine: 'hybrid' },
};

const category = (key, name, description, extra = {}) => ({ key, name, description, ...extra });

export const TEXT_SIGNAL_TEMPLATES = {
  emotions: {
    name: 'Emotional tone', signal: 'emotion', description: 'Classify the feelings expressed by the writing.', categories: [
      category('joy', 'Joy', 'The passage expresses happiness, gratitude, hope, delight, or contentment.', { modelLabel: 'joy' }),
      category('sadness', 'Sadness', 'The passage expresses grief, loss, loneliness, disappointment, sorrow, or melancholy.', { modelLabel: 'sadness' }),
      category('fear', 'Fear', 'The passage expresses anxiety, dread, danger, vulnerability, or apprehension.', { modelLabel: 'fear' }),
      category('anger', 'Anger', 'The passage expresses frustration, resentment, injustice, outrage, or irritation.', { modelLabel: 'anger' }),
      category('love', 'Love', 'The passage expresses affection, care, tenderness, attachment, or devotion.', { modelLabel: 'love' }),
      category('surprise', 'Surprise', 'The passage expresses astonishment, shock, wonder, or unexpected discovery.', { modelLabel: 'surprise' }),
    ],
  },
  purpose: {
    name: 'Writing purpose', signal: 'purpose', description: 'Classify what each passage is trying to do.', categories: [
      category('questioning', 'Questioning', 'This passage primarily asks, investigates, or opens a question.'),
      category('explaining', 'Explaining', 'This passage primarily explains, defines, or clarifies an idea.'),
      category('reflecting', 'Reflecting', 'This passage primarily interprets an experience or works through its meaning.'),
      category('persuading', 'Persuading', 'This passage primarily argues for a conclusion or tries to convince the reader.'),
      category('comparing', 'Comparing', 'This passage primarily compares, contrasts, or distinguishes alternatives.'),
      category('planning', 'Planning', 'This passage primarily decides, plans, instructs, or identifies concrete action.'),
      category('summarizing', 'Summarizing', 'This passage primarily condenses or records information without developing a new argument.'),
    ],
  },
  position: {
    name: 'Position toward a claim', signal: 'position', description: 'Map how passages relate to one reference claim.', reference: '', categories: [
      category('supports', 'Supports', 'The writer supports or affirms the reference claim.'),
      category('opposes', 'Opposes', 'The writer rejects or contradicts the reference claim.'),
      category('questions', 'Questions', 'The writer questions, tests, or challenges the reference claim without clearly rejecting it.'),
      category('uncertain', 'Uncertain', 'The writer is unsure or unresolved about the reference claim.'),
      category('reports', 'Reports', 'The writer reports the reference claim without personally endorsing or rejecting it.'),
    ],
  },
  form: {
    name: 'Writing form', signal: 'form', description: 'Classify the kind and presentation of the writing.', categories: [
      category('journal', 'Journal reflection', 'This is personal journal writing centered on lived experience, introspection, or self-understanding.'),
      category('analysis', 'Analytical essay', 'This is sustained analytical prose using definitions, reasons, distinctions, or evidence.'),
      category('conversation', 'Conversation', 'This is dialogue, an interview, or a transcript containing exchanges between speakers.'),
      category('reference', 'Reference note', 'This is reference material organized to preserve facts, quotations, sources, or definitions.'),
      category('narrative', 'Narrative', 'This is a story or chronological account of events and experiences.'),
      category('outline', 'Outline or plan', 'This is an outline, checklist, set of instructions, or structured action plan.'),
    ],
  },
};

export function validTextSignal(value) { return TEXT_SIGNALS[value] ? value : 'semantic'; }

export function signalHypothesis(signal, categoryValue, reference = '') {
  const category = categoryValue || {}, description = String(category.description || '').trim(), name = String(category.name || '').trim();
  if (signal !== 'position') return description || `This passage is primarily ${name.toLowerCase()}.`;
  const claim = String(reference || '').trim();
  if (!claim) return description || `The writer takes a ${name.toLowerCase()} position.`;
  const prefix = {
    supports: 'The writer supports the claim that',
    opposes: 'The writer opposes the claim that',
    questions: 'The writer questions whether',
    uncertain: 'The writer is uncertain whether',
    reports: 'The writer reports without endorsing the claim that',
  }[category.key] || `The writer takes a ${name.toLowerCase()} position toward the claim that`;
  return `${prefix} ${claim}`;
}
