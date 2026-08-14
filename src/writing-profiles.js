import { TEXT_ANALYSIS_VERSION, TEXT_SIGNAL_PROFILES } from './text-signals.js';

export const WRITING_PROFILE_VERSION = 2;
export const WRITING_PROFILE_SIGNALS = Object.freeze(['emotion', 'purpose', 'form']);

const FINDING_THRESHOLDS = Object.freeze({ emotion: .5, purpose: .5, form: .5 });
const ABSTENTION_LABELS = Object.freeze({
  emotion: 'No clear expressed emotion',
  purpose: 'No clear predominant purpose',
  form: 'No clear writing form',
});

const EMOTION_RADAR_GROUPS = Object.freeze([
  { key: 'warmth', label: 'Warmth', members: ['joy', 'contentment', 'gratitude', 'love', 'compassion'] },
  { key: 'hope', label: 'Hope', members: ['hope', 'relief', 'determination'] },
  { key: 'wonder', label: 'Wonder', members: ['awe', 'surprise'] },
  { key: 'longing', label: 'Longing', members: ['longing', 'loneliness'] },
  { key: 'sorrow', label: 'Sorrow', members: ['sadness', 'grief', 'despondency'] },
  { key: 'fear', label: 'Fear', members: ['fear', 'anxiety', 'confusion'] },
  { key: 'anger', label: 'Anger', members: ['anger', 'frustration', 'indignation', 'contempt'] },
  { key: 'self-conscious', label: 'Guilt / shame', members: ['guilt', 'shame'] },
]);

function clampScore(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function signalValue(profile, signal, key) { return clampScore(profile?.signals?.[signal]?.scores?.[`${signal}:${key}`] ?? profile?.signals?.[signal]?.scores?.[key]); }

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

export function profileRadarRows(profile, signal) {
  const visible = writingProfileSignalState(profile, signal).clear;
  if (signal === 'emotion') return EMOTION_RADAR_GROUPS.map(group => ({ key: group.key, label: group.label, score: visible ? Math.max(0, ...group.members.map(key => signalValue(profile, signal, key))) : 0 }));
  return (TEXT_SIGNAL_PROFILES[signal] || []).map(item => ({ key: item.key, label: item.name, score: visible ? signalValue(profile, signal, item.key) : 0 }));
}

export function writingProfileSignalState(profile, signal) {
  const value = profile?.signals?.[signal] || {}, threshold = clampScore(value.threshold ?? FINDING_THRESHOLDS[signal] ?? .5), ranked = Object.entries(value.scores || {}).sort((first, second) => Number(second[1]) - Number(first[1])), highest = clampScore(ranked[0]?.[1]), applicability = clampScore(value.applicability ?? highest), clear = value.clear === true && applicability >= threshold && highest >= threshold;
  return { clear, applicability, threshold, reason: String(value.reason || (clear ? 'clear' : 'insufficient-evidence')), emptyLabel: ABSTENTION_LABELS[signal] || 'No clear signal' };
}

export function strongestProfileFindings(profile, signal, limit = 3) {
  const definitions = new Map((TEXT_SIGNAL_PROFILES[signal] || []).map(item => [item.key, item])), value = profile?.signals?.[signal] || {}, state = writingProfileSignalState(profile, signal);
  if (!state.clear) return [];
  return Object.entries(value.scores || {}).map(([id, score]) => { const key = id.startsWith(`${signal}:`) ? id.slice(signal.length + 1) : id, definition = definitions.get(key); return { id, key, label: definition?.name || key, score: clampScore(score), evidence: String(value.evidence?.[id] || value.evidence?.[key] || '') }; }).filter(item => item.score >= state.threshold).sort((first, second) => second.score - first.score || first.label.localeCompare(second.label)).slice(0, Math.max(1, Number(limit) || 3));
}
