// Authored whole-note fixtures: queries share a note with plausible distractors,
// dates, pronouns, corrections and contradictory statements. No private notes.
export const interviewNote = `# Oral history — community workshop

## Arrival
I think it was in 2014. The old station had already closed by then, although the calendar on the office wall still showed the previous year. We rented the rooms upstairs and used the downstairs entrance for deliveries.

Martin enjoyed being around other people. He loved meeting strangers and hearing their stories, and he made newcomers feel welcome. I cannot remember the date of his first visit. The records only give the year in which we bought the building.

## Quiet afternoons
Ruth preferred to work alone. She did not enjoy other people's company and usually left before the social events began. She liked the people painted in the old portraits, but disliked the actual visitors who interrupted her work. The sign by the door asked people to leave their umbrellas outside.

## The repair
The mechanic repaired the automobile after diagnosing the engine. Martin arranged the appointment, but the receptionist could not find his booking. I think that was in 2016. The car stayed parked outside overnight while we waited for a replacement part.

## Money and decisions
Alice sent money to Bob to cover the room hire. Bob did not pay Alice back that week. Later, Clara gave Daniel the key to the store cupboard; Daniel never handed Clara a key. The committee discussed asking for a grant but did not submit an application.

## A correction
I once said that Martin hated meeting new people, but that was wrong: he delighted in their company. Ruth was friendly when she had to greet someone, although she preferred solitude. There were people in the meeting photograph whose names I have forgotten.
`;

export const operationsNote = `# Operations handover — Monday

## Accounts
To regain access after forgetting your password, request a reset link from the sign-in page. It expires after fifteen minutes. A support agent cannot read the existing password. Old accounts remain listed in the audit report after they are disabled.

## Confidential records
Encrypt the confidential records before creating a backup. Private meetings occur on Friday, and the public data table lists quarterly revenue. The security report describes access to the archive but does not grant anyone permission to open it.

## Deliveries
The replacement parcel arrived three days late. Its tracking page had predicted a Tuesday delivery. We refunded the shipping fee after the customer called, but the original purchase price stayed the same.

## Review meeting
Ada rejected Ben's proposal because the budget was incomplete. Ben approved Clara's amended plan the following morning. The agenda lists both proposals under approvals, so read the decision rather than relying on the heading. The next review is on Thursday.

## Facilities
The office reduced its power consumption by replacing outdated bulbs. Nobody changed the heating schedule. A power outage last winter interrupted a meeting, but no equipment was damaged.
`;

export const readingNote = `# Reading journal — gifts and appearances

## The sermon
The speaker described wisdom as a gift bestowed by the Creator. He said it could not be purchased with money or earned through public praise. The congregation discussed the sermon after the service and agreed to meet again the next month.

## The description
His hands were naked, and his arms also, a little above the wrist; so, also, were his feet naked, as were his legs, a little above the ankles. The artist recorded these details of the figure's appearance, not the source of his abilities. The sketch was dated 1830.

## Questions
One writer questioned whether the visitor had received divine authority. Another insisted that the authority had been granted by God. Neither passage says anything about the visitor's age. A third writer simply repeated the description of his clothes.

## The margin
The book was given to me by my uncle. The library sold duplicate copies to raise money for new shelves. A note in the margin reads: remember to return the borrowed volume before the end of the month.
`;

export const inNoteLiveCases = [
  // The portrait sentence literally says she liked depicted people. Keep that
  // ambiguous result visible in reports instead of labeling it a clear error.
  { name: 'live social fragment', query: 'liked people', source: interviewNote, expected: [/Martin enjoyed being around other people/i, /He loved meeting strangers/i, /he delighted in their company/i], ambiguous: [/liked the people painted/i], forbidden: [/think it was in 2014/i, /did not enjoy/i, /friendly when/i, /people in the meeting photograph/i] },
  { name: 'live social noun phrase', query: 'enjoyed company', source: interviewNote, expected: [/Martin enjoyed/i, /He loved meeting strangers/i, /delighted in their company/i], forbidden: [/think it was/i, /did not enjoy/i, /people painted/i, /people in the meeting photograph/i] },
  { name: 'live solitary preference', query: 'preferred solitude', source: interviewNote, expected: [/Ruth preferred to work alone/i, /did not enjoy other people's company/i, /preferred solitude/i], optional: [/did not enjoy other people's company/i], forbidden: [/Martin enjoyed/i, /He loved meeting strangers/i, /think it was/i] },
  { name: 'live repair fragment', query: 'fixed car', source: interviewNote, expected: [/mechanic repaired the automobile/i], forbidden: [/car stayed parked/i, /think it was/i, /calendar on/i] },
  { name: 'live payer roles', query: 'Alice paid Bob', source: interviewNote, expected: [/Alice sent money to Bob/i], forbidden: [/Bob did not pay Alice/i, /Clara gave Daniel/i] },
  { name: 'live reverse payer absent', query: 'Bob paid Alice', source: interviewNote, empty: true },
  { name: 'live no answer social note', query: 'allergic to peanuts', source: interviewNote, empty: true },
  { name: 'live short security fragment', query: 'private data protection', source: operationsNote, expected: [/Encrypt the confidential records/i], forbidden: [/Private meetings/i, /public data table/i, /describes access/i] },
  { name: 'live late package', query: 'late package', source: operationsNote, expected: [/parcel arrived three days late/i], forbidden: [/predicted a Tuesday/i, /next review/i, /public data table/i] },
  { name: 'live energy phrase', query: 'save electricity', source: operationsNote, expected: [/reduced its power consumption/i], forbidden: [/power outage/i, /heating schedule/i] },
  { name: 'live rejected proposal', query: 'Ada approved Ben', source: operationsNote, empty: true },
  { name: 'live account question', query: 'forgot password', source: operationsNote, expected: [/request a reset link/i], forbidden: [/cannot read the existing password/i, /audit report/i, /next review/i] },
  { name: 'live divine source', query: 'given by god', source: readingNote, expected: [/gift bestowed by the Creator/i, /authority had been granted by God/i], forbidden: [/hands were naked/i, /arms also/i, /figure's appearance/i, /book was given/i, /sketch was dated/i] },
  { name: 'live divine noun phrase', query: 'divine gift', source: readingNote, expected: [/gift bestowed by the Creator/i], ambiguous: [/authority had been granted by God/i], forbidden: [/hands were naked/i, /book was given/i, /sketch was dated/i] },
  { name: 'live no answer reading note', query: 'liked people', source: readingNote, empty: true },
  { name: 'live preference heading cannot supply a claim', query: 'liked people', source: '## Liked people\n\nI think it was in 2014. Martin enjoyed being around other people.', expected: [/^Liked people$/i, /Martin enjoyed/i], forbidden: [/2014/i] },
  { name: 'live allergy heading cannot supply a claim', query: 'allergic to peanuts', source: '## Allergic to peanuts\n\nI think it was in 2014. The calendar had a yellow cover.', expected: [/^Allergic to peanuts$/i], forbidden: [/2014/i, /calendar/i] },
].map(test => ({ required: true, exhaustive: true, ...test }));
