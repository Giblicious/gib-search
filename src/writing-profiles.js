import { TEXT_ANALYSIS_VERSION, TEXT_SIGNAL_PROFILES } from './text-signals.js';

export const WRITING_PROFILE_VERSION = 3;
export const WRITING_PROFILE_SIGNALS = Object.freeze(['emotion', 'purpose', 'form']);

const FINDING_THRESHOLDS = Object.freeze({ emotion: .5, purpose: .5, form: .5 });
const ABSTENTION_LABELS = Object.freeze({
  emotion: 'No clear expressed emotion',
  purpose: 'No clear predominant purpose',
  form: 'No clear writing form',
});
const PURPOSE_LABELS = Object.freeze({ questioning: 'Questioning purpose', explaining: 'Explanatory purpose', reflecting: 'Reflective purpose', persuading: 'Persuasive purpose', comparing: 'Comparative purpose', planning: 'Planning purpose', summarizing: 'Summarizing purpose' });
const FORM_LABELS = Object.freeze({ journal: 'Journal reflection', analysis: 'Analytical essay', conversation: 'Conversation', reference: 'Reference note', narrative: 'Narrative form', outline: 'Outline / plan' });
const EMOTION_LABELS = Object.freeze({ joy: 'Joyful expression', contentment: 'Contented expression', gratitude: 'Grateful expression', hope: 'Hopeful expression', love: 'Loving expression', compassion: 'Compassionate expression', awe: 'Awe / wonder', relief: 'Relieved expression', longing: 'Longing expression', loneliness: 'Loneliness expression', sadness: 'Sad expression', grief: 'Grief-related expression', despondency: 'Despondent expression', fear: 'Fearful expression', anxiety: 'Anxious expression', confusion: 'Confused expression', surprise: 'Surprised expression', frustration: 'Frustrated expression', anger: 'Angry expression', indignation: 'Indignant expression', contempt: 'Contemptuous expression', guilt: 'Guilt-related expression', shame: 'Shame-related expression', determination: 'Determined expression' });
const SUMMARY_TITLES = Object.freeze({
  'planning:outline': 'Practical outline for planning', 'explaining:analysis': 'Analytical explanation', 'reflecting:journal': 'Reflective journal entry', 'persuading:analysis': 'Persuasive analytical essay', 'questioning:analysis': 'Analytical inquiry', 'summarizing:reference': 'Reference summary', 'comparing:analysis': 'Comparative analysis', 'planning:reference': 'Practical reference note', 'explaining:reference': 'Explanatory reference note', 'summarizing:outline': 'Structured summary',
});
const SUMMARY_LABELS = Object.freeze({ questioning: 'Questioning', explaining: 'Explaining', reflecting: 'Reflecting', persuading: 'Persuading', comparing: 'Comparing', planning: 'Planning', summarizing: 'Summarizing', journal: 'Journal', analysis: 'Analysis', conversation: 'Conversation', reference: 'Reference', narrative: 'Narrative', outline: 'Outline' });

function clampScore(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function signalValue(profile, signal, key) { return clampScore(profile?.signals?.[signal]?.scores?.[`${signal}:${key}`] ?? profile?.signals?.[signal]?.scores?.[key]); }
function findingLabel(signal, key, fallback = '') { return (signal === 'emotion' ? EMOTION_LABELS : signal === 'purpose' ? PURPOSE_LABELS : signal === 'form' ? FORM_LABELS : {})[key] || fallback || key; }

function compactSignal(signal, value) {
  const scores = Object.fromEntries(Object.entries(value?.scores || {}).map(([key, score]) => [key, Math.round(clampScore(score) * 10000) / 10000]));
  const strongest = Object.entries(scores).sort((first, second) => second[1] - first[1]).slice(0, 4), evidence = {};
  for (const [key] of strongest) { const text = String(value?.evidence?.[key] || '').replace(/\s+/g, ' ').trim(); if (text) evidence[key] = text.slice(0, 240); }
  const threshold = clampScore(value?.threshold ?? FINDING_THRESHOLDS[signal] ?? .5), highest = Number(strongest[0]?.[1] || 0), applicability = clampScore(value?.applicability ?? highest), clear = typeof value?.clear === 'boolean' ? value.clear : applicability >= threshold && highest >= threshold;
  return { signal, scores, evidence, applicability, threshold, clear, reason: String(value?.reason || (clear ? 'clear' : 'insufficient-evidence')) };
}

export function combineWritingProfile(file, fingerprint, signalProfiles, analyzedAt = Date.now()) {
  const signals = {};
  for (const signal of WRITING_PROFILE_SIGNALS) signals[signal] = compactSignal(signal, signalProfiles?.[signal]);
  return { version: WRITING_PROFILE_VERSION, analysisVersion: TEXT_ANALYSIS_VERSION, file: String(file || ''), fingerprint: String(fingerprint || ''), signals, analyzedAt: Number(analyzedAt) || Date.now() };
}

export function isCurrentWritingProfile(profile, file, fingerprint) {
  return Boolean(profile && profile.version === WRITING_PROFILE_VERSION && profile.analysisVersion === TEXT_ANALYSIS_VERSION && profile.file === file && profile.fingerprint === fingerprint);
}

export function profileScoreRows(profile, signal) {
  return (TEXT_SIGNAL_PROFILES[signal] || []).map(item => ({ key: item.key, id: `${signal}:${item.key}`, label: findingLabel(signal, item.key, item.name), score: signalValue(profile, signal, item.key) })).sort((first, second) => second.score - first.score || first.label.localeCompare(second.label));
}

export function writingProfileSignalState(profile, signal) {
  const value = profile?.signals?.[signal] || {}, threshold = clampScore(value.threshold ?? FINDING_THRESHOLDS[signal] ?? .5), ranked = Object.entries(value.scores || {}).sort((first, second) => Number(second[1]) - Number(first[1])), highest = clampScore(ranked[0]?.[1]), applicability = clampScore(value.applicability ?? highest), clear = value.clear === true && applicability >= threshold && highest >= threshold;
  return { clear, applicability, threshold, reason: String(value.reason || (clear ? 'clear' : 'insufficient-evidence')), emptyLabel: ABSTENTION_LABELS[signal] || 'No clear signal' };
}

export function strongestProfileFindings(profile, signal, limit = 3) {
  const definitions = new Map((TEXT_SIGNAL_PROFILES[signal] || []).map(item => [item.key, item])), value = profile?.signals?.[signal] || {}, state = writingProfileSignalState(profile, signal);
  if (!state.clear) return [];
  return Object.entries(value.scores || {}).map(([id, score]) => { const key = id.startsWith(`${signal}:`) ? id.slice(signal.length + 1) : id, definition = definitions.get(key); return { id, key, label: findingLabel(signal, key, definition?.name), score: clampScore(score), evidence: String(value.evidence?.[id] || value.evidence?.[key] || '') }; }).filter(item => item.score >= state.threshold).sort((first, second) => second.score - first.score || first.label.localeCompare(second.label)).slice(0, Math.max(1, Number(limit) || 3));
}

export function writingProfileConfidence(profile, signal) {
  const state = writingProfileSignalState(profile, signal), rows = profileScoreRows(profile, signal), highest = Number(rows[0]?.score || 0), second = Number(rows[1]?.score || 0), gap = highest - second;
  if (!state.clear) {
    const description = state.reason === 'neutral-structure' ? 'The note is primarily structural and contains little expressed feeling.' : signal === 'emotion' ? 'There is not enough evidence of expressed feeling to assign an emotion.' : 'The evidence is too weak or mixed to assign a reliable finding.';
    return { key: 'unclear', label: 'Unclear', description, score: highest };
  }
  const mixed = second >= state.threshold && gap < .08, key = highest >= .85 && state.applicability >= .7 && (!mixed || signal === 'emotion') ? 'strong' : highest >= .68 && gap >= .04 ? 'moderate' : 'tentative';
  const description = state.reason === 'structural-evidence' ? 'Clear structural evidence supports this classification.' : mixed ? 'Several findings are similarly supported.' : key === 'strong' ? 'Clear evidence supports this classification.' : key === 'moderate' ? 'The predominant finding is reasonably well supported.' : 'Some evidence is present, but the classification is not decisive.';
  return { key, label: key === 'strong' ? 'Strong' : key === 'moderate' ? 'Moderate' : 'Tentative', description, score: highest };
}

export function writingProfileSummary(profile) {
  const findings = Object.fromEntries(WRITING_PROFILE_SIGNALS.map(signal => [signal, strongestProfileFindings(profile, signal, 1)[0] || null])), confidence = Object.fromEntries(WRITING_PROFILE_SIGNALS.map(signal => [signal, writingProfileConfidence(profile, signal)])), purpose = findings.purpose, form = findings.form, emotion = findings.emotion, title = purpose && form ? SUMMARY_TITLES[`${purpose.key}:${form.key}`] || `${purpose.label} in ${form.label.toLowerCase()}` : purpose ? purpose.label : form ? form.label : emotion ? `${emotion.label} is predominant` : 'No predominant profile';
  const primarySignals = [purpose && ['purpose', purpose], form && ['form', form]].filter(Boolean), relevant = primarySignals.length ? primarySignals.map(([signal]) => confidence[signal]) : emotion ? [confidence.emotion] : [], rank = { unclear: 0, tentative: 1, moderate: 2, strong: 3 }, overallRank = relevant.length ? Math.min(...relevant.map(item => rank[item.key] ?? 0)) : 0, overall = ['Unclear', 'Tentative', 'Moderate', 'High'][overallRank], parts = [];
  if (purpose || form) parts.push(`Primarily ${[purpose && SUMMARY_LABELS[purpose.key] || purpose?.label, form && SUMMARY_LABELS[form.key] || form?.label].filter(Boolean).join(' and ')}`); if (!emotion) parts.push('No clear expressed emotion'); else parts.push(emotion.label);
  return { title, confidence: `${overall} confidence`, detail: parts.join(' · '), findings, confidenceBySignal: confidence };
}
