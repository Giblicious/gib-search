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
