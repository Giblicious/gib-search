// Original fixtures, with explicit distractors, defined before model evaluation.
const technicalNote = `# Service handbook

## Backups
The scheduler saves a snapshot every night at two o'clock.
To recover deleted records, restore the most recent snapshot from the backup menu.
Backup archives are encrypted before leaving the computer.
The local diagnostic logs remain in plaintext.

## Access
If you forget your password, request a reset link on the sign-in screen.
Administrators can revoke a member's access from the team settings page.
Guests cannot invite new members.
Invitations expire after seven days.

## Search
Put several words inside quotation marks to find that exact phrase.
Use OR between terms to retrieve records containing either term.
Search ignores differences between uppercase and lowercase letters.
Attachments cannot be searched while the device is offline.

## Notifications
Turn off email alerts in the notification preferences to stop receiving messages.
Push notifications continue to arrive even when email alerts are disabled.
The notification service retries failed deliveries three times.
`;
const question = (name, query, expected, forbidden) => ({ name, query, source: technicalNote, expected, forbidden, required: true });
export const inNoteQuestionCases = [
  { name: 'question permission requires the requested participant', query: 'can reviewers change a locked report?', source: 'Reports in review mode are locked against editing; only the owner may switch them back to draft mode.\n\nTo reopen a closed report, use the Revisions menu and choose the most recent saved copy.', expected: [/locked against editing/i], forbidden: [/reopen a closed report/i], required: true, exhaustive: true },
  { name: 'question time answer requires the requested event', query: 'how long are refunds available', source: 'You can request your money back within fourteen days of delivery.\n\nRefund requests go to the accounts team.\n\nThe delivery service usually takes three days.\n\nThe membership renews every month.', expected: [/money back within fourteen days/i], forbidden: [/accounts team|service usually|membership renews/i], required: true, exhaustive: true },
  { name: 'question permission distinguishes related documents', query: 'can guests edit documents', source: 'Visitors have read-only access and cannot change a document.\n\nThe guest list is stored in a document.\n\nEditors can invite visitors to meetings.\n\nDocuments are backed up at midnight.', expected: [/read-only access/i], forbidden: [/guest list|invite visitors|backed up/i], required: true, exhaustive: true },
  { name: 'question cause distinguishes a later repair', query: 'why did the lights fail', source: 'A damaged transformer cut the electricity to the whole street.\n\nThe electricity company replaced the bulbs the following week.\n\nThe street had sixteen lamps before the work began.\n\nThe committee discussed switching to lower-power lamps.', expected: [/damaged transformer/i], forbidden: [/replaced the bulbs|sixteen lamps|committee discussed/i], required: true, exhaustive: true },
  { name: 'question location distinguishes related objects', query: 'where is the spare key', source: 'The extra key is taped beneath the lowest kitchen drawer.\n\nThe spare lock is kept in the garage.\n\nThe key was copied last Tuesday.\n\nThe kitchen drawer needs a new handle.', expected: [/extra key is taped/i], forbidden: [/spare lock|copied last|needs a new handle/i], required: true, exhaustive: true },
  { name: 'question preserves thirty distinct answers', query: 'who approved the budget?', source: Array.from({ length: 30 }, (_, index) => `Person${index + 1} approved the budget.`).join('\n\n') + '\n\nSeveral observers did not approve the budget.', expected: [/Person1 approved/i, /Person30 approved/i], expectedCount: 30, forbidden: [/did not approve/i], required: true },
  question('question recovery procedure', 'how can I recover deleted records?', [/restore the most recent snapshot/i], [/encrypted before/i, /plaintext/i, /scheduler saves/i]),
  question('question backup schedule', 'when are backups made?', [/every night at two/i], [/restore the most recent/i, /encrypted before/i]),
  question('question lost password', 'what should I do if I forget my password?', [/request a reset link/i], [/revoke a member/i, /Invitations expire/i]),
  question('question revoke access', 'how do I remove a team member?', [/revoke a member.s access/i], [/Guests cannot invite/i, /Invitations expire/i]),
  question('question guest limitation', 'can guests invite people?', [/Guests cannot invite/i], [/Administrators can revoke/i, /Invitations expire/i]),
  question('question invitation expiry', 'how long is an invitation valid?', [/expire after seven days/i], [/Guests cannot invite/i, /reset link/i]),
  question('question exact phrase', 'how do I search for an exact phrase?', [/inside quotation marks/i], [/Use OR/i, /ignores differences/i]),
  question('question alternative terms', 'how can I find either of two words?', [/Use OR/i], [/inside quotation marks/i, /ignores differences/i]),
  question('question case sensitivity', 'does search distinguish capital letters?', [/ignores differences/i], [/Use OR/i, /quotation marks/i]),
  question('question offline limitation', 'can I search attachments without internet?', [/cannot be searched.*offline/i], [/ignores differences/i, /quotation marks/i]),
  question('question stop emails', 'how do I stop email notifications?', [/Turn off email alerts/i], [/retries failed/i, /Push notifications continue/i]),
  question('question no answer', 'what is the maximum attachment size?', [], [/./]),
  question('question unrelated topic', 'how do I replace a bicycle tire?', [], [/./]),
];
