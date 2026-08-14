import { TEXT_ANALYSIS_VERSION, TEXT_SIGNAL_PROFILES } from './text-signals.js';

export const WRITING_PROFILE_VERSION = 1;
export const WRITING_PROFILE_SIGNALS = Object.freeze(['emotion', 'purpose', 'form']);

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
  return { signal, scores, evidence };
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
  if (signal === 'emotion') return EMOTION_RADAR_GROUPS.map(group => ({ key: group.key, label: group.label, score: Math.max(0, ...group.members.map(key => signalValue(profile, signal, key))) }));
  return (TEXT_SIGNAL_PROFILES[signal] || []).map(item => ({ key: item.key, label: item.name, score: signalValue(profile, signal, item.key) }));
}

export function strongestProfileFindings(profile, signal, limit = 3) {
  const definitions = new Map((TEXT_SIGNAL_PROFILES[signal] || []).map(item => [item.key, item])), value = profile?.signals?.[signal] || {};
  return Object.entries(value.scores || {}).map(([id, score]) => { const key = id.startsWith(`${signal}:`) ? id.slice(signal.length + 1) : id, definition = definitions.get(key); return { id, key, label: definition?.name || key, score: clampScore(score), evidence: String(value.evidence?.[id] || value.evidence?.[key] || '') }; }).sort((first, second) => second.score - first.score || first.label.localeCompare(second.label)).slice(0, Math.max(1, Number(limit) || 3));
}
