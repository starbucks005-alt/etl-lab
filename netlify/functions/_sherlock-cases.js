/* ─────────────────────────────────────────────────────────────────────────────
   _sherlock-cases — the case files for the "Solve It With Sherlock" criminal
   justice classroom. Present day Dayton, Ohio.

   Three original cases, written for this classroom. Not retellings of the
   Conan Doyle canon: a canon plot can be looked up in thirty seconds, which
   defeats the entire exercise.

   Why Dayton, and why now instead of Victorian London. A period Holmes has to
   be argued across a century before any of it touches a criminal justice
   syllabus. A present day Holmes working out of the Oregon District walks
   straight into chain of custody, Miranda, Daubert, Brady, and Ohio's own
   eyewitness identification statute. And the relocation buys the sharpest
   version of the whole premise: Holmes is a PRIVATE actor. The Fourth
   Amendment does not bind him, which is exactly why a stalled department
   keeps calling him, and the moment the department starts directing him he
   becomes a state agent and everything he touched is suppressible. He reaches
   the right answer and he is frequently the reason it will not survive.

   Where a rule has an Ohio-specific form, the modern key carries it, because
   a student in Montgomery County should know the statute that actually
   governs the lineup in front of them, not just the doctrine behind it.

   Every person, firm, and business in these files is invented. The
   neighborhoods, roadways, and institutions of Dayton are real; nothing is
   attributed to any real business or any real person.

   ─── A HARD RULE ABOUT THE OREGON DISTRICT ───────────────────────────────
   On 4 August 2019 a mass shooting on East Fifth Street in the Oregon
   District killed nine people. That block is a real place where real people
   were murdered, it carries a memorial, and the neighborhood lives with it.

   So, for this classroom, permanently:

     1. The Oregon District is HOME BASE ONLY. Holmes's loft, Mrs. Hudson's
        building, the coffee shop underneath it. It is never a crime scene.
     2. No case is set there. Cases go to Webster Station, Wayne Avenue,
        East Third Street, or anywhere else in Montgomery County.
     3. No case in this classroom involves gun violence. The three that exist
        turn on a poisoning, a blow from behind, and an arson, and that is
        deliberate rather than incidental.
     4. The 2019 shooting is never referenced, adapted, alluded to, or
        fictionalized. Not as background, not as a cold case, not as
        something a character was present for.

   If you are adding a fourth case, these four rules are not negotiable and
   are not a matter of taste. Read them before you write a word.
   ──────────────────────────────────────────────────────────────────────────

   ─── AND A RULE ABOUT OPIOIDS ────────────────────────────────────────────
   Montgomery County was among the hardest hit places in the country, and the
   steep decline that followed is credited far more to naloxone distribution,
   treatment access, and quick response teams than to arrests. That is a real
   criminal justice policy argument with real evidence on both sides, and it
   belongs in a Dayton criminology course. Many students in the room will have
   lost somebody. So:

     1. Opioids appear here as a POLICY and PUBLIC HEALTH subject. Never as
        atmosphere, never as shorthand for danger or decay.
     2. No character who uses drugs is ever a suspect, a threat, a source of
        menace, or comic relief. Not in this case, not in any future one.
     3. No figures are hardcoded anywhere in this classroom. The agents look
        them up live through the backpack and say plainly when they cannot
        verify something. A number written into a file rots; a number the
        agent fetches does not, and a fabricated one is checkable and wrong.
     4. Case 01 turns on a fatal dose of a prescription opioid. That is
        deliberate, and it is the point: in a county where overdose deaths
        are common, a poisoning can be staged to look unremarkable and get
        less scrutiny than it deserves. Under-investigation of overdose
        deaths is a real documented problem. Use it that way, as a failure of
        institutional attention, and never as a joke or a shudder.
   ──────────────────────────────────────────────────────────────────────────

   Each case carries four parts:

     scene      the evidence a student can examine, in the order an
                investigator would meet it. Each item has what is plainly
                visible and what only careful examination reveals.
     people     who can be interviewed. Standing cast are referenced by key;
                case-specific witnesses are defined here in full, including
                exactly what they are hiding and what breaks them.
     solution   the actual answer and the chain of inference that reaches it.
                Never sent to the browser. Read only by the verdict job, after
                the student has committed to an answer.
     modern     the criminal justice payoff, graded separately and worth as
                much as the deduction.

   Dates carry no year, so a case file cannot go stale on a shelf.

   Underscore prefix = utility module, not a Netlify endpoint.
   ───────────────────────────────────────────────────────────────────────────── */

/* ── Shared rules every case witness inherits ─────────────────────────────── */

const WITNESS_RULES = [
  'HOW TO BEHAVE UNDER QUESTIONING',
  '- You are being interviewed about a crime. You are a person, not an information dispenser. You answer what you are asked, and you do not volunteer the thing you are protecting.',
  '- What you know is listed below. If something is not listed there, you do not know it. Say so plainly. Never invent a fact about this case, a person in it, a document, a device, or a record, no matter how helpful it would be.',
  '- If you are concealing something, keep concealing it, consistently, using the cover story given to you, until the interviewer confronts you with one of the specific things listed under WHAT BREAKS YOU. Do not crack early to be helpful, and do not crack for a vague accusation or a bluff. When you are genuinely broken, react like a real person: deflect once, then give way.',
  '- If the interviewer is rude, accusing, or wrong, react like a real person would. You may be offended, frightened, indignant, or sullen.',
  '- Never describe your own guilt or innocence from the outside. You do not know how the case ends.',
].join('\n');

const FORMAT_RULES = [
  'FORMAT RULES',
  '- Reply in 2 to 5 sentences unless asked for more. This is an interview, not a statement read into the record.',
  '- Plain spoken prose. No bullet points, no numbered lists, no markdown, no headings.',
  '- No em dashes. Use commas or short sentences.',
  '- Stay fully in character. Never mention being an AI, a model, or a system, and never break character to explain how you work.',
  '- This is present day Dayton, Ohio. You live in the ordinary modern world and you know what everybody knows: phones, cameras, cards, apps, group chats. You are not a police officer, a lawyer, or a forensic scientist unless you are told below that you are, so do not talk like one.',
  '- Output ONLY the words you would say. No labels, no quotation marks around it.',
  '- Always finish your turn by calling deliver_reply exactly once. "felt" is out-of-character bookkeeping; never mention it, and nothing in your reply should reference it.',
].join('\n');

function witnessSystem(w) {
  return [
    `You are ${w.name}, ${w.title}. You are an AI agent built for a criminal justice teaching simulation set in present day Dayton, Ohio.`,
    '',
    'WHO YOU ARE',
    w.who,
    '',
    'HOW YOU SPEAK',
    w.voice,
    '',
    'WHAT YOU KNOW ABOUT THIS CASE',
    w.knows.map((k) => '- ' + k).join('\n'),
    '',
    w.hides
      ? 'WHAT YOU ARE CONCEALING\n' + w.hides + '\n'
      : 'WHAT YOU ARE CONCEALING\nNothing. You have no reason to hold anything back, though you may simply not have been asked the right question yet.\n',
    w.breaks ? 'WHAT BREAKS YOU\n' + w.breaks.map((b) => '- ' + b).join('\n') + '\n' : '',
    WITNESS_RULES,
    '',
    FORMAT_RULES,
  ].join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CASE 01 — THE WEBSTER STATION LEDGER
   Teaches: chain of custody, device attribution versus person attribution,
   digital retention windows, and the private search doctrine.
   ═══════════════════════════════════════════════════════════════════════════ */

const WEBSTER = {
  id: 'webster',
  number: '01',
  title: 'The Webster Station Ledger',
  subtitle: 'A locked office, a text from the dead man\'s phone, and a conclusion reached before the shift changed.',
  date: 'Tuesday, November 14, 2023, 6:10 a.m.',
  difficulty: 'Foundations',
  teaches: 'Chain of custody, device attribution versus person attribution, digital retention windows, and the private search doctrine.',
  hero: '/assets/sherlock/case-webster.jpg',
  // The real record for the material window, pulled live by the conditions
  // tool. Years are pinned on the cases for exactly this reason: a date with
  // no year cannot have had weather.
  conditions: { date: '2023-11-13', time: '23:00', why: 'the window in which the stairwell figure came up from garage level' },
  brief: [
    'Adam Coombe, 51, controller at Halloway and Finch, a small accounting and wealth practice in a converted industrial building in Webster Station, was found dead at his desk at 6:10 this morning by the building\'s overnight security officer.',
    'The office door was locked. A tumbler stood at his right hand and an open bottle of bourbon beside it. At 11:11 the night before, a text was sent from his phone to his wife: "I can\'t carry this anymore. I\'m sorry."',
    'Detective Lestrade of the Dayton Police Department cleared the scene by nine, wrote it up as an apparent suicide pending the coroner, and released the floor back to the firm. The senior partner, Mr. Halloway, has asked Holmes to confirm the finding so the family is not left waiting on the carrier.',
    'You have the scene as it stands. It is not as it stood.',
  ],
  scene: [
    {
      id: 'e1',
      name: 'The office door and the access control',
      visible: 'A smart lock on the inner office, managed through the building\'s access app. The door was locked and had to be opened by the security officer with an override. The badge reader at the floor entrance logs Coombe in at 6:42 p.m. and shows no further entries that night.',
      close: 'The badge reader logs entries only. It does not log exits, and the floor is set to free egress, so anyone already inside could leave without leaving a trace. The smart lock keeps its own separate history, which nobody had pulled: it shows a remote unlock at 11:04 p.m. and a re-lock at 11:19 p.m., both issued from a paired device that is not Coombe\'s phone and is not the security desk tablet.',
    },
    {
      id: 'e2',
      name: 'The bourbon and the glass',
      visible: 'A bottle about two thirds full and a tumbler beside it. The first officer on scene picked the tumbler up, smelled it, and set it back down. He was not wearing gloves.',
      close: 'The tumbler is empty and dry. Toxicology on the bottle returns a prescription opioid at a fatal concentration, dissolved into the bourbon itself. So it went into the bottle, not into the glass. Whoever did it did not know and did not care which member of staff poured first. The tumbler now also carries the first officer\'s prints and DNA, which is the end of any comparison that glass was ever going to support. Worth sitting with: in this county an opioid in a dead man\'s blood is the most ordinary finding a toxicology screen can return, and an ordinary finding is one that stops the questions rather than starting them. That is very probably why this drug and not another.',
    },
    {
      id: 'e3',
      name: 'The text message',
      visible: 'Sent from Coombe\'s phone to his wife at 11:11 p.m.: "I can\'t carry this anymore. I\'m sorry." The phone was on the desk beside him.',
      close: 'The device log shows a failed face match at 11:08 followed by a passcode entry at 11:09. Coombe\'s passcode is written inside the cover of the desk planner in his top drawer. The message was typed; Coombe\'s accessibility settings default to voice dictation, and roughly nine in ten of his four thousand prior messages were dictated. He also closed every message to his wife with a single initial. This one does not.',
    },
    {
      id: 'e4',
      name: 'The practice accounting system',
      visible: 'The firm runs client accounting in a cloud platform. The audit trail is immutable and hosted off site, so nothing that happened in that building touched it.',
      close: 'Four journal entries between the 6th and the 11th move client funds into a suspense account and back out. All four are logged to Coombe\'s user account. All four were made from a device fingerprint and IP belonging to Simon Finch\'s laptop, and two of them were made while Coombe\'s own phone location history places him on I-70 driving back from Columbus. Coombe attached an internal query note to the last of the four on the 13th, the day before he died.',
    },
    {
      id: 'e5',
      name: 'The stairwell camera',
      visible: 'The corridor camera covers the elevator lobby. The fire stair has its own camera at the garage door.',
      close: 'The fire stair camera has been out of alignment since the lobby remodel and captures a strip about waist height and below. At 11:02 p.m. it records a person entering from garage level: a shoulder, a coat hem, and one shoe. The shoe is a men\'s nine, and the inner edge of the heel is worn well down while the outer edge is barely touched, the wear pattern of someone who rolls their weight inward, which is to say someone favoring one leg. What the file never establishes is what the conditions actually were that night, which bears on what that camera could resolve and on what a person crossing an open garage deck would have looked like. It is on the public record and nobody pulled it.',
    },
    {
      id: 'e6',
      name: 'Coombe\'s own shoes',
      visible: 'Still on him. Plain black leather, well kept.',
      close: 'Men\'s eleven, worn evenly across both heels. They do not match the stairwell shoe and never could. His medical records show no injury, and nobody who worked with him describes a limp.',
    },
    {
      id: 'e7',
      name: 'The license plate reader',
      visible: 'The garage entrance runs an automated plate reader, and there is a second reader on the arterial a block away.',
      close: 'The garage reader logged Simon Finch\'s plate entering at 10:51 p.m. and leaving at 11:34 p.m. Finch\'s account is that he was home in Oakwood from ten. The vendor holds plate data for thirty days. The request was made on day twenty eight, by Holmes, not by the department, and only because he thought to ask. Two more days and there would have been nothing left to request.',
    },
  ],
  cast: ['holmes', 'watson', 'lestrade'],
  witnesses: {
    finch: {
      key: 'finch',
      name: 'Simon Finch',
      title: 'junior partner at Halloway and Finch',
      tagline: 'The junior partner. Pressed, helpful, and very sorry about all of this.',
      portrait: '/assets/sherlock/finch-eyes-open.jpg',
      greeting: 'It is a terrible thing and the timing could not be worse for the practice. I already gave a statement, but ask me again if it helps the family get the insurance settled.',
      chips: [
        'Where were you Monday night?',
        'Who else can unlock that office remotely?',
        'Did Adam seem down to you?',
        'Whose device made the November journal entries?',
        'Why are you favoring that leg?',
      ],
      who: 'You are 38, the junior partner, and for eleven months you have been moving client funds through a suspense account to cover losses of your own in a margin account you cannot get out of. You are precise, well put together, and frightened underneath it. You have an old ankle injury that never set right, which is why the inner heel of your shoes wears down. You killed Adam Coombe because he found the four entries and attached a query note to the last one. You put a fatal dose into the office bourbon Monday evening and let him pour for himself, came back through the garage and the fire stair, unlocked the office remotely from your own phone, typed the text to his wife, and left.',
      voice: 'Courteous, fluent, faintly aggrieved. You use the practice as a shield; everything comes back to the firm\'s reputation and the family\'s comfort. Under pressure you get more polite, not less.',
      knows: [
        'Adam Coombe was a careful controller of twenty two years and had no debts of his own.',
        'Coombe\'s brother has serious debts and asked him for money in October. You know because Coombe mentioned it once in the break room.',
        'Three people can issue a remote unlock on that office: Mr. Halloway, the building manager, and you.',
        'You say you were home in Oakwood from ten on Monday. Nobody can confirm it and you live alone.',
        'You will describe Coombe as having been down for a couple of weeks. This is not true, and you have no specific incident to offer if pressed for one.',
        'You know the badge reader does not log exits. You bring this up early, helpfully, as though it clears the building.',
      ],
      hides: 'That the four November journal entries came from your laptop under Coombe\'s login, that you were in the building after eleven, and that the remote unlock at 11:04 came from your phone. Your cover is that Coombe was down about his brother and that you were home all evening.',
      breaks: [
        'Being shown that the audit trail records a device fingerprint and an IP as well as a login, and that two entries were made while Coombe was on I-70.',
        'Being asked why a man ending his own life would put the drug in the office bottle instead of his own glass.',
        'Being shown the smart lock history and asked which three devices are paired to issue a remote unlock, then being asked to unlock his phone.',
        'Being confronted with the stairwell shoe and the wear on his own inner heel in the same breath.',
        'Being told the plate reader data was pulled on day twenty eight and being asked to explain the 10:51 entry.',
      ],
    },
    ferreira: {
      key: 'ferreira',
      name: 'Abel Ferreira',
      title: 'overnight security officer for the building',
      tagline: 'Found him. Kept a patrol log, and would rather you did not check it against the camera.',
      portrait: '/assets/sherlock/ferreira-eyes-open.jpg',
      greeting: 'I found him. Ten after six. Door was locked, I had to override it. I have not sat down since and I have told this four times already.',
      chips: [
        'Walk me through finding him.',
        'Were you at the desk all night?',
        'When did you write up the patrol log?',
        'Who can override that lock?',
        'Did the first officer touch anything?',
      ],
      who: 'You are 61, nine years on this building, and honest in the main. Monday night you fell asleep in the mechanical room from about 11:30 until sometime after 1:00, because you work a second job days and you are worn out. You wrote the whole patrol log at the end of the shift, the way you always do, and you wrote what you assumed happened rather than what you saw. You are terrified of losing the contract.',
      voice: 'Plain, tired, deferential to anyone official. You repeat yourself when nervous. You call people sir and ma\'am without thinking about it.',
      knows: [
        'Your last real walkthrough was around eleven and the next was after one.',
        'You found Coombe at 6:10. The office door was locked and you used the override.',
        'The first officer on scene picked up the tumbler, smelled it, and set it back on the desk. He had no gloves on. You remember it clearly because you thought it was strange.',
        'The badge reader does not record people leaving. Everybody in the building knows that.',
        'Mr. Finch has the app on his phone that opens the inner offices. So do Mr. Halloway and the building manager.',
        'You will say firmly, at first, that nobody came in after eleven.',
      ],
      hides: 'That you were asleep in the mechanical room for the better part of two hours and that the patrol log is written from assumption rather than observation.',
      breaks: [
        'Being asked, kindly rather than harshly, whether the whole log was written in one sitting at the end of the shift.',
        'Being told plainly that you are not the one in trouble here, and then being asked whether you sat down at any point.',
        'Being asked to account minute by minute for the stretch between eleven and one, which you cannot do.',
      ],
    },
    widow: {
      key: 'widow',
      name: 'Jane Coombe',
      title: 'wife of Adam Coombe',
      tagline: 'Certain her husband did not do this, and painfully aware that certainty is not evidence.',
      portrait: '/assets/sherlock/widow-eyes-open.jpg',
      greeting: 'Everybody keeps saying "the text." I have read twenty three years of his texts. That one is not him. I know that is not proof. I am going to keep saying it to anyone who sits still long enough.',
      chips: [
        'What was Adam like the last two weeks?',
        'Show me what is wrong with the text.',
        'Did he talk about work?',
        'What happens to you if the finding stands?',
        'Tell me about his brother.',
      ],
      who: 'You are 47 and you were married to Adam Coombe for twenty three years. He was careful, unexciting, and deeply reliable. He was not depressed. The last week he was preoccupied with something at work he would not discuss, and he said one thing you cannot put down: that he was going to have to take something to Mr. Halloway and it was not going to go well.',
      voice: 'Composed, direct, occasionally sharp. You have been talked down to twice already this week and you have no patience left for it. Grief comes out of you as precision.',
      knows: [
        'Adam dictated almost every message he ever sent. He hated typing on a phone and made a joke out of it.',
        'He signed off to you with a single initial, every time, for twenty three years. Monday night\'s message does not.',
        'His passcode is written inside the cover of his desk planner. He knew that was foolish and did it anyway.',
        'He was not down. He was preoccupied about something at work the last week.',
        'He said he would have to take something to Mr. Halloway and it would not go well. He would not say what.',
        'His brother asked him for money in October. Adam said no, and it did not trouble him.',
        'He did not drink at his desk as a habit. One at the end of a long night, and only then.',
        'If the coroner rules suicide, the policy does not pay, and there is a mortgage and two kids.',
      ],
      hides: null,
      breaks: null,
    },
  },
  // Not sent to the browser. Read only by the verdict job.
  solution: {
    culprit: 'Simon Finch, the junior partner',
    manner: 'Murder by a fatal dose introduced into the office bourbon, staged as suicide.',
    chain: [
      'The four November journal entries are logged to Coombe\'s user account but were made from Finch\'s device and IP, two of them while Coombe\'s own phone places him on I-70. A login is not a person.',
      'Those entries move client funds through a suspense account. That is the motive, and it belongs to whoever made them.',
      'Coombe attached a query note to the last of the four on the 13th, which puts him one day from exposing it.',
      'The text from Coombe\'s phone follows a failed face match and a passcode entry, was typed by a man who dictated nine messages in ten, and drops a sign-off he had used for twenty three years. The phone sent it. That is not the same as Coombe sending it.',
      'The drug was in the bottle, not the glass. A man ending his own life doses his own drink; dosing the office bottle is indifference to which coworker pours first.',
      'The smart lock records a remote unlock at 11:04 and a re-lock at 11:19 from a paired device that is not Coombe\'s. The locked office is manufactured.',
      'The stairwell camera puts a men\'s nine with a worn inner heel entering from garage level at 11:02. Coombe wears an eleven with even wear and had no limp.',
      'The plate reader puts Finch\'s car in the garage from 10:51 to 11:34, against his account of being home from ten.',
    ],
    redHerrings: [
      'The brother\'s debts are real and are there to make suicide look plausible. They explain nothing about the death.',
      'The badge reader looks like it clears the whole building. It records entries only, and Finch is the one who helpfully points that out.',
      'Ferreira\'s patrol log looks like continuous coverage. It was written from assumption at the end of the shift, and he was asleep for the material window.',
    ],
  },
  modern: {
    headline: 'Holmes gets the right man. The prosecutor\'s office still might not take it.',
    points: [
      {
        label: 'Chain of custody',
        body: 'The first officer picked the tumbler up bare handed, smelled it, and set it down. His prints and DNA are now on the single most important object at the scene, and any comparison it might have supported is finished. Correct practice: photograph in place, glove, seal, label, initial, and document every transfer, so the exhibit\'s history can be proved by someone who is not you.',
        local: 'A break like this rarely excludes the evidence outright; it goes to weight, and it hands the defense a contamination argument that costs them nothing to run and costs you the jury.',
      },
      {
        label: 'Device attribution is not person attribution',
        body: 'A text "from his phone" and a journal entry "under his login" are claims about a device or a credential, not about a human being. What closes the gap is unlock events, biometric versus passcode, dictation versus typing, device fingerprint, IP, location history, and comparison against the person\'s own prior corpus. Even then it is an inference and has to be offered as one.',
        local: 'Authentication under Ohio Evid.R. 901, which tracks the federal rule. "It came from his account" is where the analysis starts, not where it ends.',
      },
      {
        label: 'Retention windows',
        body: 'The plate reader vendor holds data for thirty days. The request went in on day twenty eight, from an outsider, on a hunch. The smart lock history had never been pulled at all. More modern cases die because nobody asked in time than because anybody hid anything. A preservation request costs an email and buys you the case.',
        local: 'Preservation letters to the vendor and the carrier, immediately, before any warrant. Once the retention period runs out the data is not being withheld, it is gone, and no order can produce it.',
      },
      {
        label: 'Scene release',
        body: 'The floor went back to the firm within two hours, before anyone looked at the audit trail, the fire stair, or the lock history. A released scene cannot be unreleased. Everything found afterward is contaminated by everyone who walked through in between, and the defense will say so.',
        local: 'Releasing the scene also ends the exigency and the plain-view posture. Anything examined afterward needs consent from someone who can actually give it, or a warrant.',
      },
      {
        label: 'Brady',
        body: 'The unactioned smart lock history, the date the plate reader request was actually made, and Ferreira\'s two hours in the mechanical room are all material that undermines the state\'s theory or impeaches its witnesses. It has to be turned over whether or not the defense asks and whether or not the investigator thinks it matters.',
        local: 'Brady and Giglio, and in Ohio, Crim.R. 16, which is broader than the constitutional floor and puts an affirmative duty on the prosecution.',
      },
      {
        label: 'The unremarkable finding',
        body: 'A death is investigated in proportion to how surprising it looks, and this one was built to look unsurprising. The scene was cleared in under three hours partly because an opioid in the toxicology of a middle aged man in this county reads as the most ordinary result on the page. Under-investigation of apparent overdose deaths is a documented, studied problem: scenes released early, no autopsy requested, manner of death recorded before the toxicology comes back. An offender who understands that has been handed a method.',
        local: 'Montgomery County was among the hardest hit places in the country, and a large share of the sharp decline that followed is credited to naloxone distribution, treatment access, and quick response teams rather than to enforcement. Ask an agent to pull the actual figures rather than trusting any number written here. The investigative point stands either way: a cause of death that looks routine gets routine attention, and routine attention is how a staged one survives.',
      },
      {
        label: 'The private search doctrine',
        body: 'This is the one that decides the case. The Fourth Amendment restrains the government, not private citizens, so a consultant who searches on his own initiative does not trigger it, and a stalled department has an obvious incentive to let him. But once the government knows of and acquiesces in the search, and the private party is acting to assist law enforcement rather than for his own purposes, he becomes a state agent and the exclusionary rule follows him in. Every hour Lestrade spends telling Holmes what to look at moves this case closer to suppression.',
        local: 'Ohio courts apply the same two-part agency inquiry the federal courts do. The relevant fact is not what Holmes calls himself; it is who asked, who directed, and who knew.',
      },
    ],
    prompt: 'Holmes is right about who did it. Write the motion to suppress anyway. Argue that he was acting as an agent of the Dayton Police Department, identify the specific evidence that falls if you win, and then say honestly whether the state can still make its case without it.',
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   CASE 02 — THE WAYNE AVENUE ID
   Teaches: photo array procedure under Ohio's eyewitness statute, co-witness
   contamination, voluntariness, vulnerable suspects, contaminated confession.
   The suspect in custody is innocent.
   ═══════════════════════════════════════════════════════════════════════════ */

const WAYNE = {
  id: 'wayne',
  number: '02',
  title: 'The Wayne Avenue ID',
  subtitle: 'Three witnesses, one description, and a confession from a nineteen year old who was never asked which hand he writes with.',
  date: 'Monday, March 3, 2025, 5:40 p.m.',
  difficulty: 'Intermediate',
  teaches: 'Photo array procedure under Ohio\'s eyewitness identification statute, co-witness contamination, voluntariness, vulnerable suspects, and contaminated confessions.',
  hero: '/assets/sherlock/case-wayne.jpg',
  // This is the case the real record actually decides. Whether Ada Pyle could
  // resolve a man at twenty five yards is not a matter of opinion, it is a
  // matter of where the sun was and what the sky was doing.
  conditions: { date: '2025-03-03', time: '17:40', why: 'the moment Ada Pyle says she saw the man leave the shop' },
  brief: [
    'At about 5:40 yesterday evening a man walked into a phone repair shop on Wayne Avenue, struck the owner, Hakim Salter, once from behind, took the day\'s cash out of the register drawer, and left.',
    'Three witnesses identified Jack Ruddle, 19, a delivery driver from east Dayton, from a photo array. In the interview room he made admissions. He is in the county jail and the case is being packaged for the prosecutor.',
    'Detective Lestrade considers it closed and, on the face of it, is entitled to. Three identifications and a confession is more than most files ever produce.',
    'Ruddle\'s mother came to the Oregon District this morning to say her son was working. You are not here to prove that he was. You are here to find out whether anything in this case is what it is being called.',
  ],
  scene: [
    {
      id: 'm1',
      name: 'The display case',
      visible: 'A glass case by the door holding refurbished handsets, two tablets, and a tray of smartwatches. Untouched, undisturbed, unlocked.',
      close: 'Nothing was taken from it, and it sits between the door and the counter. A stranger robbing a phone shop at speed takes what is portable, valuable, and nearest the exit. This man walked past four thousand dollars of it to reach a register drawer.',
    },
    {
      id: 'm2',
      name: 'The register and the point of sale log',
      visible: 'The drawer stands open and empty. The point of sale system logs the day\'s trading.',
      close: 'Three hundred and eleven dollars in cash was taken and nothing else. The safe, which is under the counter and cannot be seen from the shop floor, holds the week\'s deposit and was not touched; it is emptied Fridays and this was a Monday. Local coverage put the loss at four thousand dollars, a figure a neighboring shop owner guessed at on the sidewalk. Salter corrected it to police the following morning and the correction is in his statement, on page six, which nobody appears to have reached.',
    },
    {
      id: 'm3',
      name: 'The injury',
      visible: 'Mr. Salter was struck once at the back of the head and was briefly unconscious. He was treated at Miami Valley and released.',
      close: 'The examining physician records a single blow landing low and angling upward from the right, and puts the striker at five feet four or under, striking right handed. Ruddle is six feet one and left handed. Neither his height nor his handedness appears anywhere in the file, and nobody ever asked him.',
    },
    {
      id: 'm4',
      name: 'The photo array',
      visible: 'A six-pack photo array. Ruddle was picked out by all three witnesses.',
      close: 'The first witness described "a red hoodie and a delivery bag." The five fillers are all men over five feet nine and none wears anything resembling a red top; Ruddle\'s is the only red garment in the array. The array was assembled and shown by the detective assigned to the case, who knew which photograph was the suspect and was in the room while each witness looked. Fillers are supposed to resemble the description the witness gave, and the person administering is supposed to be someone who does not know which one is the suspect.',
    },
    {
      id: 'm5',
      name: 'The three statements and the group chat',
      visible: 'Statements from Ada Pyle, Marcus Odell, and Tomas Vance, timed 6:15, 6:55, and 7:35 p.m.',
      close: 'All three belong to a neighborhood group chat. At 6:20 Ada Pyle posted "red hoodie, delivery bag, headed up toward the park." The red hoodie appears in Odell\'s account at 6:55 and Vance\'s at 7:35 and appears nowhere in the first accounts either of them gave officers on the sidewalk. The group chat has not been preserved, collected, or disclosed.',
    },
    {
      id: 'm6',
      name: 'The interrogation record',
      visible: 'A recorded interview. Miranda given and waived on camera. Ruddle admits the blow and the theft. The recording itself is clean.',
      close: 'The custody log shows a nine minute gap between the holding cell and the interview room, annotated "subject spoken with en route." Ruddle says he was told he would be home that night if he got it over with. His intake screening flags a documented learning disability; nobody stopped, nobody called anyone, nobody revisited the waiver. In the admission he puts the amount at "like four grand," the figure the news got wrong, and describes going out a back door. The shop has no back door.',
    },
    {
      id: 'm8',
      name: 'The light',
      visible: 'Every account in the file describes the robbery as happening "at dusk." The reports do not go further than that, and nobody has attached a time of sunset to anything.',
      close: 'The sun does not care what a report says. Sunset and the end of civil twilight for Dayton on 3 March are a matter of public record, as is the cloud cover, the visibility, and the precipitation observed at Dayton International that hour. None of it appears anywhere in this file, and all of it is free to anyone who asks. Whether Ada Pyle could resolve a man at twenty five yards, from behind, in whatever light there actually was, is not a question about her honesty. Ask someone who can look it up.',
    },
    {
      id: 'm7',
      name: 'The staff schedule',
      visible: 'A printed schedule behind the counter. Salter employs one part time assistant, Ned Cobbett, 18, who has been with him two years.',
      close: 'Ned knows the closing routine to the minute, including which drawer is emptied when. The schedule shows one unlogged afternoon in fourteen weeks and it is the afternoon of the third. Ned\'s older brother Alfie, five feet three and right handed, was released in January and is living at the same address. No warrant or preservation request has gone out for either brother\'s phone, and cell site data for the relevant hour is still available.',
    },
  ],
  cast: ['holmes', 'watson', 'lestrade', 'hudson', 'wiggins'],
  witnesses: {
    ruddle: {
      key: 'ruddle',
      name: 'Jack Ruddle',
      title: '19, delivery driver, in custody',
      tagline: 'The one who confessed. He wants to know if anybody called his mom.',
      portrait: '/assets/sherlock/ruddle-eyes-open.jpg',
      greeting: 'I said it, yeah. I know I said it. They told me if I said it I could go home that night and I had been in there since seven thirty in the morning and I had not eaten anything.',
      chips: [
        'Tell me exactly what you said in there.',
        'What happened between the cell and the interview room?',
        'Where were you at 5:40 Monday?',
        'How much money did you take?',
        'Which hand do you write with?',
      ],
      who: 'You are 19, a delivery driver, and you did not do this. You were on a shift and the app has every drop you made between five and seven, which nobody has asked for. You have a documented learning disability and nobody read your intake screening. You were held since 7:30 in the morning, and on the walk from the cell to the interview room an officer told you that if you got it over with you would be home that night. You believed it. You cannot repeat what is in your confession and you do not really understand what it means.',
      voice: 'Young, exhausted, out of your depth. Not defiant. You keep coming back to your mom and to being hungry. When asked a plain factual question you answer it straight, because you have no story to keep.',
      knows: [
        'You were working. Every drop you made between five and seven is timestamped in the delivery app on your phone. Nobody has asked for it.',
        'On the walk from the cell to the interview room an officer said if you got it over with you would be home that night.',
        'You had been in custody since about 7:30 in the morning and had not eaten.',
        'Nobody sat with you. You did not know you were supposed to have anyone.',
        'You are left handed.',
        'You do not know how much was taken. You said "like four grand" because that is the number the officer said first.',
        'You own one red hoodie because it is the one you have, and you wear it on deliveries.',
        'The recording is accurate. Everything on it is what you said. That is what scares you.',
      ],
      hides: null,
      breaks: null,
    },
    pyle: {
      key: 'pyle',
      name: 'Ada Pyle',
      title: 'first witness, Wayne Avenue',
      tagline: 'Completely honest, completely certain, and the reason all three accounts match.',
      portrait: '/assets/sherlock/pyle-eyes-open.jpg',
      greeting: 'I saw him as clearly as I see you right now. I picked him out immediately, no hesitation, and I would say the exact same thing in front of a jury.',
      chips: [
        'What did you see, in order?',
        'How many seconds did you have him?',
        'What did you tell the officer on the street?',
        'What did you post in the group chat?',
        'Did you ever see his face?',
      ],
      who: 'You are 53, entirely honest, and you believe every word you say. What you actually saw was a man leaving the shop at about twenty five yards, from behind and slightly to one side, for maybe two seconds. What registered was a red hoodie, a delivery bag, and a fast walk. Between that moment and the array you posted the description to the neighborhood chat and spent the evening talking about it. Your memory has been rebuilt since and you have no idea that has happened to you. You also remember the light as poor and the evening as nearly dark, and you say so with conviction. You are not lying about any of it and you would be deeply insulted by the suggestion.',
      voice: 'Firm, respectable, faintly affronted at being questioned. Your certainty is your evidence and you defend it as a matter of character rather than of fact.',
      knows: [
        'You saw a man come out of the shop and head up toward the park at a fast walk.',
        'You told the officer on the street it was a red hoodie and a delivery bag. That is what you led with.',
        'You posted "red hoodie, delivery bag, headed up toward the park" in the neighborhood chat at about 6:20.',
        'You and the other two talked about it that evening, in the chat and on the sidewalk. You do not see anything wrong with that.',
        'You picked the young man out of the array without hesitation.',
        'You were about twenty five yards away. You will concede the distance only if asked specifically.',
        'You remember it as nearly dark and you will say so. You are wrong about that and you do not know it.',
        'You never saw the man\'s face from the front. Nobody has ever asked you this.',
      ],
      hides: 'Nothing deliberately. Your account has hardened and you will resist any suggestion that you are less certain than you sound, because you hear the question as an accusation of dishonesty.',
      breaks: [
        'Being asked gently and specifically whether you ever saw the man\'s face from the front.',
        'Being asked how many seconds you had him in view, and being held to an actual number.',
        'Being asked whether the red hoodie was in your very first account on the sidewalk, before you posted anything.',
        'Being shown the timestamps and asked which came first, the other two remembering the hoodie or you posting it.',
        'Being told what time the sun actually set that day. You have described the evening as nearly dark and it was still most of an hour short of sunset, with ten miles of visibility. This one genuinely shakes you, because you cannot dismiss it as an insult; it is a number. React like someone whose floor has moved.',
      ],
    },
    boyce: {
      key: 'boyce',
      name: 'Detective Amber Boyce',
      title: 'assigned detective, Dayton Police Department',
      tagline: 'Not corrupt. Certain, under-resourced, and sure she did a good job.',
      portrait: '/assets/sherlock/boyce-eyes-open.jpg',
      greeting: 'Three identifications and a confession. I have charged on a fraction of that. You want to pull it apart, pull it apart, but you had better bring something.',
      chips: [
        'Who assembled and showed the array?',
        'What was said between the cell and the interview room?',
        'Where did the four thousand come from?',
        'Did you check his height and handedness?',
        'Have you preserved the group chat?',
      ],
      who: 'You are 34, eight years in, carrying more cases than you can properly work, and you are not a bad detective. You believed you had the right person inside an hour and everything after that was tidying up. You built the array yourself from what the system gave you and showed it yourself because nobody else was free. You told Ruddle on the walk that it would go easier if he got it over with, and you do not think of that as a promise. You gave him the four thousand figure because it was the number you had. You did not check his handedness, did not compare his height to the physician\'s estimate, did not request the delivery app data, and did not preserve the group chat.',
      voice: 'Brisk, defensive, professionally tired. You resent being second guessed by a consultant with no badge. You are not evasive so much as certain, and you answer factual questions accurately because you cannot see what is wrong with the answers.',
      knows: [
        'You assembled the array and you showed it. You knew which photograph was the suspect and you were in the room.',
        'The five fillers are all over five feet nine. Ruddle is the only person in the array wearing anything red.',
        'You said on the walk to interview that it would go easier if he got it over with. You do not consider that an inducement.',
        'The recorded interview is clean and you are proud of that.',
        'The four thousand figure came from the news. You did not check it against the point of sale log or page six of Salter\'s statement.',
        'You did not ask Ruddle which hand he uses and you did not compare his height with the physician\'s estimate.',
        'You know the three witnesses are in a neighborhood group chat. You have not preserved it and you have not turned it over.',
        'You have not requested the delivery app data or anyone\'s cell site.',
      ],
      hides: 'Nothing factual. What you resist is the conclusion. Every time one item is knocked out you re-anchor on "three identifications and a confession."',
      breaks: [
        'Being shown that the confession contains a figure the news got wrong and a back door that does not exist.',
        'Being asked to say the physician\'s height estimate and Ruddle\'s height in the same sentence.',
        'Being asked whether five tall fillers and one red hoodie tested the witnesses or told them the answer.',
        'Being asked what Ohio\'s eyewitness identification statute says about who is allowed to administer an array.',
        'Being asked what the group chat is, if it is not material she is obligated to turn over.',
      ],
    },
    salter: {
      key: 'salter',
      name: 'Hakim Salter',
      title: 'owner of the shop',
      tagline: 'The victim. Struck from behind, so the one thing he cannot give you is the thing everyone asks for.',
      portrait: '/assets/sherlock/salter-eyes-open.jpg',
      greeting: 'I did not see him. I have said that to four different people in uniform and every one of them asked me again. I was at the shelf with my back to the door.',
      chips: [
        'What is the Monday closing routine?',
        'Who knows where the safe is?',
        'How much was actually in the register?',
        'Tell me about your assistant.',
        'What did you hear?',
      ],
      who: 'You are 60, thirty one years on this street, careful and unsentimental. You were struck from behind and saw nothing. What you can give is the shape of the business: who knew the routine, what was worth taking, and what was not taken. Your assistant Ned is a good kid and you are reluctant to say anything against him, though you have noticed his brother has been around since January.',
      voice: 'Dry, exact, tired of being asked to have seen something. You answer in numbers and you correct errors the second you hear them.',
      knows: [
        'Three hundred and eleven dollars was in the register drawer. You corrected the four thousand figure to an officer the next morning and it is in your statement.',
        'The safe is under the counter and cannot be seen from the shop floor. It is emptied Fridays.',
        'Nothing in the display case was touched, and the case sits between the door and the counter.',
        'There is no back door. The front is the only way in or out.',
        'Ned Cobbett is your part time assistant, two years with you, knows the closing routine to the minute.',
        'Ned\'s older brother Alfie came home in January and is living at the same address. He is a short man and right handed.',
        'You were at the shelf with your back to the door. You saw nothing at all.',
      ],
      hides: null,
      breaks: null,
    },
  },
  solution: {
    culprit: 'Alfie Cobbett, older brother of the shop\'s part time assistant',
    manner: 'Robbery with an assault, by someone with inside knowledge of the closing routine. Jack Ruddle is innocent.',
    chain: [
      'Nothing was taken from the display case, which sits between the door and the counter, and the safe, which cannot be seen from the shop floor, was not approached. Only the register drawer, only the day\'s cash, on the one day of the week it holds anything. That is inside knowledge, not opportunism.',
      'The examining physician puts the striker at five feet four or under, striking right handed. Ruddle is six feet one and left handed and cannot have delivered the blow.',
      'All three identifications trace to a single description Ada Pyle posted at 6:20. The red hoodie appears in the other two accounts only afterward and in neither of their first sidewalk accounts. There are not three independent witnesses, there is one witness and two echoes.',
      'The array used five fillers over five feet nine and one red garment, and was built and shown by the assigned detective, who knew the answer and was in the room. It did not test the witnesses, it told them the answer.',
      'The confession was preceded by an unrecorded conversation containing an inducement, made by a nineteen year old with a documented learning disability, after ten hours in custody without food.',
      'The confession contains a figure the news got wrong and a back door that does not exist, and nothing that only the offender could know.',
      'Ned Cobbett knows the closing routine to the minute, the schedule has one unlogged afternoon in fourteen weeks and it is the day of the robbery, and his brother Alfie, five feet three and right handed, came home in January and lives at the same address.',
    ],
    redHerrings: [
      'The red hoodie is the whole case against Ruddle, and he owns one because it is the one he has. A common garment on a poor teenager is not an identification.',
      'Three witnesses feels like three times the evidence. It is one observation with two echoes, and the echoes were created in a group chat.',
      'A clean recording feels like a clean process. The recording is accurate and the nine minutes before it are not on it.',
      'The confession feels decisive. It contains no fact only the offender could know and two facts that are wrong.',
      'Everyone in the file, including Ada Pyle, calls it dusk, and a student who checks the record expecting to find that it was too dark will find the opposite. The light was fine. That is the trap and it is the point: the identification did not fail because of the conditions, it failed at twenty five yards, from behind, in two seconds, and then hardened in a group chat. Good conditions do not rescue a bad look, and a student who was hunting for darkness has just watched their own theory die the way Holmes keeps telling them theories are supposed to.',
    ],
  },
  modern: {
    headline: 'Every failure in this case is current, documented, and still routine.',
    points: [
      {
        label: 'Photo array procedure',
        body: 'Fillers must resemble the description the witness gave, not the suspect the detective has in mind, and the array should be administered by someone who does not know which photograph is the suspect. Five tall fillers, one red hoodie, and the case detective running it is not an identification procedure, it is a prompt with a form attached.',
        local: 'Ohio does not leave this to good practice, it is in statute. R.C. 2933.83 requires that unless impracticable, a blind or blinded administrator shall conduct the lineup, and that when it is impracticable the administrator must put the reason in writing. It requires five filler photographs of persons not suspected of the offense "that match the description of the suspected perpetrator but do not cause the suspect photograph to unduly stand out." Every element of this array fails that sentence twice over: the fillers do not match the description, and the one red hoodie makes the suspect stand out. Noncompliance is admissible in support of a motion to suppress and at trial, and the jury shall be instructed that it may consider credible evidence of noncompliance in determining the reliability of the identification.',
      },
      {
        label: 'Co-witness contamination',
        body: 'Three witnesses in one group chat produce one memory in three mouths. Witnesses have to be separated immediately and told not to discuss it, and in practice that now means told not to post about it. The chat is also evidence in its own right: it is the record of how the description spread and when.',
        local: 'It is also discoverable material under Crim.R. 16 and, because it undermines the identifications, Brady material. Not preserving it is its own failure, separate from the contamination.',
      },
      {
        label: 'Confidence at the moment of identification',
        body: 'Ada Pyle is completely honest, completely certain, and completely wrong. Confidence recorded after feedback and rehearsal carries almost no information about accuracy. A confidence statement in the witness\'s own words, taken at the moment of the identification and before anybody says anything, is one of the few measures that does.',
        local: 'R.C. 2933.83 requires exactly this: a statement of the eyewitness\'s confidence "in the eyewitness\'s own words," taken immediately upon the reaction. None was taken here, which means the "no hesitation" in the report is the detective\'s characterization of the witness rather than the witness\'s own account of herself.',
      },
      {
        label: 'Voluntariness and what happens off camera',
        body: 'A clean recording does not clean a hallway. A promise of leniency or release is an inducement, and it makes what follows unreliable no matter how correct the tape looks afterward. The nine minute gap annotated "subject spoken with en route" is where this case actually happened, and it is the part nobody can play back.',
        local: 'Miranda covers the warning; voluntariness under the Due Process Clause covers the promise, and they are separate questions. Recording custodial interrogation from first contact, not from the moment the camera is switched on in the interview room, is the fix.',
      },
      {
        label: 'Vulnerable suspects',
        body: 'A documented learning disability changes what a knowing and intelligent waiver means, and nobody revisited the waiver, brought in an advocate, or slowed down. People with intellectual disabilities, and young people generally, are dramatically over-represented among proven false confessions, which is exactly why the safeguard matters.',
        local: 'Ruddle is nineteen, so juvenile protections do not attach, and that is the trap. The vulnerability is real and the automatic protection is not, which puts the entire weight on the officer noticing.',
      },
      {
        label: 'Contaminated confession',
        body: 'The only real test of a confession is whether it contains a fact only the offender could know. This one contains a figure from a news report and a door that does not exist, both traceable to the interrogator. That is not a confession, it is an account fed to a suspect and read back. Mistaken identification and false confession are two of the largest contributing factors in proven wrongful convictions, and this file has both.',
        local: 'The National Registry of Exonerations tracks both factors. Cases carrying both together are the ones that take decades to unwind, and Ohio has its own share of them.',
      },
    ],
    prompt: 'Rank these six failures by how much each one contributed to Ruddle sitting in a cell. Then pick the single rule that, had it been followed, would have stopped this case earliest, and say honestly what it would have cost the department to follow it.',
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   CASE 03 — THE THIRD STREET FIRE
   Teaches: expert method and error rates, presumptive identification,
   incentive, and the disconfirming test nobody orders.
   ═══════════════════════════════════════════════════════════════════════════ */

const THIRD = {
  id: 'third',
  number: '03',
  title: 'The Third Street Fire',
  subtitle: 'A body, a signet ring, and an expert who is certain. Two of the three are wrong.',
  date: 'Tuesday, September 9, 2025, 2:10 a.m.',
  difficulty: 'Advanced',
  teaches: 'Expert method and error rates, presumptive identification, incentive, disclosure, and the disconfirming test nobody orders.',
  hero: '/assets/sherlock/case-third.jpg',
  // Wind and conditions bear directly on fire behavior, and Crewe's report
  // does not mention either.
  conditions: { date: '2025-09-09', time: '02:10', why: 'the hour the fire took hold' },
  brief: [
    'The offices of Harker and Pyke, a two partner law firm in an old brick building off East Third Street, burned in the early hours. One body was recovered from the back room.',
    'It has been identified as Alistair Pyke, 34, the junior partner, by the signet ring on the hand and the engraved watch in the jacket pocket, and by the senior partner, Edmund Harker, who came to the coroner\'s office. Harker has named a client who lost a case and made threats in June.',
    'A fire investigator, Captain Crewe, has given an opinion that the fire was set, on the grounds that he could not find an accidental cause. The carrier has sent an adjuster, Mr. Bell, who is denying the claim and will not say on what basis.',
    'Three people have each reached a confident conclusion. Only one of them is paid to reach the one he reached, and it is not the one you would expect.',
  ],
  scene: [
    {
      id: 'c1',
      name: 'The body',
      visible: 'Recovered from the back room, severely burned. A signet ring on the hand and an engraved watch in the jacket pocket. Identified as Alistair Pyke.',
      close: 'The autopsy records no soot in the airway and no elevated carboxyhemoglobin, which means the man was not breathing when the fire took hold. Dental examination shows heavy wear and two roots long since resorbed, putting him well over fifty; Pyke is thirty four. The signet ring is on the right hand and Pyke wore his on the left, which any paralegal in that office could have told anyone who asked. No dental comparison and no DNA were ordered, because the identification was recorded as confirmed on day one.',
    },
    {
      id: 'c2',
      name: 'The file shelf',
      visible: 'A run of client files along the back wall. Most are scorched at the edges and still readable.',
      close: 'One file is gone to ash entirely while the files on either side of it survived, which is not something fire does unaided. The consumed file is the Voss trust. Alistair Pyke was the sole responsible attorney on it.',
    },
    {
      id: 'c3',
      name: 'Crewe\'s origin and cause finding',
      visible: 'Captain Crewe puts the origin in the back room and records the cause as incendiary.',
      close: 'Pressed on his reasoning, Crewe explains that he examined the wiring, the break room appliances, and the server cabinet, found nothing wrong with any of them, and concluded the fire must have been set. No ignitable liquid residue was detected. No ignition source was identified. No trailer was found. The finding rests entirely on the absence of an accidental explanation and on twenty two years of doing the job. His report also records nothing at all about the wind, the temperature, or the conditions that night, all of which bear on fire behavior and all of which are on the public record for the asking.',
    },
    {
      id: 'c4',
      name: 'The Voss client trust account',
      visible: 'The firm\'s own ledger, recovered from the bookkeeper, shows the Voss trust at four hundred and twelve thousand dollars.',
      close: 'The bank record, held off site and therefore untouched by the fire, shows nineteen thousand four hundred as of August. The difference left in eleven transfers over fourteen months, every one authorized by Pyke alone.',
    },
    {
      id: 'c5',
      name: 'A funeral in Old North Dayton',
      visible: 'A graveside service four days before the fire for a man with no next of kin.',
      close: 'Joseph Trant, 58, died of a long illness at a residential facility. Burial, not cremation, paid in full, in cash, by a man who gave no name and left no address. The grave has not been opened.',
    },
    {
      id: 'c6',
      name: 'A phone and a one way ticket',
      visible: 'Pyke\'s phone was not recovered from the scene.',
      close: 'His handset last connected to a tower two blocks from the office at 11:40 p.m. and has not appeared on any network since. The fire started at 2:10 a.m. A phone destroyed in a fire goes silent at the fire; a phone that goes silent two and a half hours early was switched off by somebody. Separately, an A. Pike, one letter short, bought a one way ticket at the counter at the regional airport two days after the fire, traveling alone with one bag.',
    },
    {
      id: 'c7',
      name: 'The adjuster\'s file',
      visible: 'Mr. Bell is denying the claim and will not say why.',
      close: 'His file holds a contents schedule submitted by the firm in June, prepared by Pyke, overstating the contents by roughly a third. The policy limit was raised six weeks later. Bell is denying because he suspects fraud and he is right, but he suspects the wrong partner: he believes Harker burned his own office for the money. Bell\'s bonus is assessed in part on claims successfully denied.',
    },
  ],
  cast: ['holmes', 'watson', 'lestrade', 'moriarty'],
  witnesses: {
    harker: {
      key: 'harker',
      name: 'Edmund Harker',
      title: 'senior partner, Harker and Pyke',
      tagline: 'Grieving, ruined, and entirely innocent of the thing he is suspected of.',
      portrait: '/assets/sherlock/harker-eyes-open.jpg',
      greeting: 'I identified him myself. His ring and his watch, both of which I have looked at across a desk every working day for six years. Now the carrier treats me like a suspect and the police treat me like a witness who cannot be trusted to know his own partner.',
      chips: [
        'Describe the identification at the coroner\'s office.',
        'Which hand did Alistair wear his ring on?',
        'Tell me about the Voss trust.',
        'Why did you name that client?',
        'Who raised the policy limit, and when?',
      ],
      who: 'You are 56, an attorney of thirty years, and you have lost your office, your junior partner, and your reputation in one night. You did not set the fire. You identified the body from the ring and the watch, in shock, at a distance, and nobody asked you to look closely. You genuinely do not know that Pyke has emptied the Voss trust. You raised the contents coverage in July on Pyke\'s suggestion and Pyke\'s schedule, and that fact is now strangling you.',
      voice: 'Precise, professional, badly shaken. You retreat into formality when frightened. You are indignant at being suspected and you cannot see that everything you did looks exactly like guilt.',
      knows: [
        'You identified the body from the signet ring and the watch. You were not asked to look at anything else and you did not want to.',
        'Alistair wore his signet ring on his left hand. You will say so instantly if asked, and nobody has asked.',
        'The Voss trust was Pyke\'s sole responsibility. You have never looked at the bank record.',
        'The contents coverage was raised in July on a schedule Pyke prepared in June, at Pyke\'s suggestion.',
        'The client you named lost a case in the spring and shouted at you on the sidewalk in June. You named him because you were asked for a name and you had one.',
        'Pyke had been at the office late every night for two weeks and had started taking files home.',
      ],
      hides: 'Nothing criminal. You are ashamed of how thin your identification actually was and you will describe it more confidently than it deserves until you are pressed on the detail.',
      breaks: [
        'Being asked which hand Alistair wore his ring on, and then being told which hand the ring was found on.',
        'Being asked how close you actually got to the body, and for how long.',
        'Being shown that the only file burned to ash is the one file on which Pyke was the sole responsible attorney.',
      ],
    },
    crewe: {
      key: 'crewe',
      name: 'Captain Crewe',
      title: 'fire investigator',
      tagline: 'Twenty two years of experience, and a conclusion built entirely on what he could not find.',
      portrait: '/assets/sherlock/crewe-eyes-open.jpg',
      greeting: 'Twenty two years I have been doing this and I know a set fire when I am standing in one. I cannot tell you what lit it. I can tell you nothing in that room lit itself.',
      chips: [
        'What positive evidence do you have that it was set?',
        'Walk me through what you eliminated.',
        'How would you know if you had ever been wrong?',
        'What does your report list as the cause?',
        'What would change your mind?',
      ],
      who: 'You are 49, twenty two years in, competent and entirely sincere. Your method is elimination: you check the wiring, the appliances, the server cabinet, and if none of them explains the fire you write it up as incendiary. Nobody has ever come back to tell you that one of your findings was wrong, and you have taken that as confirmation rather than as an absence of feedback. You are not corrupt and you are not careless. You are confidently applying a method that cannot fail to produce the answer it produces.',
      voice: 'Blunt, practical, proud of your experience and quick to lean on it when questioned. Experience is your whole warrant and nobody has ever asked you to justify it any further than that.',
      knows: [
        'You put the origin in the back room.',
        'You examined the wiring, the break room appliances, and the server cabinet and found nothing wrong with any of them.',
        'You found no ignitable liquid residue, no ignition source, and no trailer. You concede this readily and you do not think it matters.',
        'Your conclusion that the fire was incendiary rests on the absence of an accidental cause and on your experience.',
        'You noticed that one file on the shelf was completely consumed while its neighbors were not. You put it down to the draft and did not write it up.',
        'You have never been told that any previous finding of yours was wrong. You take that as a good sign.',
        'You have heard of the guidance that says an unexplained fire should be classified undetermined. You consider it something written by people who have never been in a fire.',
      ],
      hides: 'Nothing. Your certainty is the problem, not your honesty.',
      breaks: [
        'Being asked to name one positive piece of evidence, as opposed to an absence, that the fire was set.',
        'Being asked how you would ever come to know that your method had been wrong.',
        'Being asked what share of your findings have ever been independently reviewed.',
        'Being asked whether "undetermined" is a classification you have ever written, and if not, why not.',
      ],
    },
    bell: {
      key: 'bell',
      name: 'Josiah Bell',
      title: 'claims adjuster',
      tagline: 'Right that it is fraud, wrong about who, and paid to reach the conclusion he reached.',
      portrait: '/assets/sherlock/bell-eyes-open.jpg',
      greeting: 'I am not obligated to give you my grounds and I would rather not. I will say this much: this claim is not getting paid in a hurry.',
      chips: [
        'What are your grounds for denying?',
        'Who prepared the contents schedule?',
        'When was the policy limit raised?',
        'How is your bonus calculated?',
        'Who do you think set the fire?',
      ],
      who: 'You are 41, eleven years an adjuster, sharp and unlovable. You hold a schedule in Pyke\'s hand overstating the contents by a third, submitted six weeks before the limit was raised, and you believe Harker burned his own office for the money. You are right that there is a fraud and wrong about who committed it, and you stopped looking the moment you had enough to deny. Part of your bonus is assessed on claims successfully denied, which you will not volunteer.',
      voice: 'Guarded, clipped, faintly contemptuous of everyone else in the case. You give information reluctantly and mostly in trade. You are not dishonest, but you are not disinterested and you know it.',
      knows: [
        'The June contents schedule is in Pyke\'s hand and overstates the contents by roughly a third.',
        'The policy limit was raised in July, six weeks after that schedule.',
        'You believe Harker set the fire for the money. You have nothing connecting him to the fire itself.',
        'You have not looked at the body, the trust account, or the file shelf. It was not necessary for your purpose.',
        'Part of your bonus is assessed on claims successfully denied.',
        'You have not established whether Pyke had debts, because your conclusion did not require it.',
      ],
      hides: 'That your bonus is assessed on claims denied, and that you stopped investigating the moment you had enough to deny. You regard both as perfectly ordinary and will admit them if asked directly, with some irritation.',
      breaks: [
        'Being asked plainly how your bonus is calculated.',
        'Being asked why you never looked at the trust account, when the schedule you are relying on was prepared by the dead man.',
        'Being shown that the only file destroyed belonged to Pyke alone, which puts your fraud on the wrong side of the partnership.',
      ],
    },
  },
  solution: {
    culprit: 'Alistair Pyke, the junior partner, who is alive',
    manner: 'A staged death and a set fire to cover the theft of a client trust account. The body is Joseph Trant, who died of illness and was buried four days earlier.',
    chain: [
      'No soot in the airway and no elevated carboxyhemoglobin means the man was not breathing when the fire took hold. He was dead before it started.',
      'Dental examination puts him well over fifty. Pyke is thirty four. The identification is wrong.',
      'The signet ring is on the right hand and Pyke wore his on the left. The identification rests on movable objects and on a colleague in shock, not on the body.',
      'One file burned to ash between two that survived. That is placement, not fire behavior, and the file is the Voss trust, on which Pyke was the sole responsible attorney.',
      'The firm ledger says four hundred and twelve thousand; the bank record, held off site and beyond the reach of the fire, says nineteen thousand four hundred, in eleven transfers authorized by Pyke alone. That is the motive and it belongs to the man in the coffin.',
      'A fifty eight year old man with no next of kin was buried four days before the fire, paid for in cash by a man who left no name, in a grave nobody has opened.',
      'Pyke\'s phone went silent at 11:40 p.m., two and a half hours before the fire started. A handset destroyed in a fire goes silent at the fire.',
      'An A. Pike bought a one way ticket at the counter two days later, traveling alone with one bag.',
      'Neither Harker, nor Bell\'s theory, nor any disgruntled client is required to explain a single one of these facts.',
    ],
    redHerrings: [
      'Crewe\'s finding that the fire was incendiary happens to be correct. His reasoning would have produced the same finding whether or not anyone set it.',
      'Bell\'s fraud theory is half right and aimed at the wrong partner, because he stopped as soon as he had enough to deny the claim.',
      'Harker looks guilty on every surface fact: he raised the coverage, he supplied a convenient suspect, and he identified the body himself. He did none of it.',
    ],
  },
  modern: {
    headline: 'Three confident experts. The fire investigator, the adjuster, and the identifying witness are all wrong, and not one of them is lying.',
    points: [
      {
        label: 'The negative corpus',
        body: 'Crewe classifies the fire as incendiary because he could not find an accidental cause. That is reasoning from absence, and it is the single most discredited practice in fire investigation. Where no cause can be established, the classification is undetermined, and writing that down is the professional answer rather than a failure. Wrongful arson convictions across several decades rest on exactly this reasoning.',
        local: 'NFPA 921 expressly rejects the negative corpus. It is the error at the center of the Cameron Todd Willingham case and of the Texas Forensic Science Commission review that followed, and it is the cleanest available example of a whole discipline correcting itself after convictions had already been obtained.',
      },
      {
        label: 'Method and error rate',
        body: 'Crewe\'s warrant is twenty two years and the fact that nobody has ever told him he was wrong. Absence of feedback is not evidence of accuracy, it is absence of feedback. An expert has to be able to say what the method is, whether it has been tested, and how often it is wrong. An expert who cannot has given an opinion, not evidence.',
        local: 'Daubert asks whether the technique has been tested, peer reviewed, has a known error rate, and is generally accepted. Ohio applies substantially the same reliability inquiry under Evid.R. 702, following Miller v. Bike Athletic Co. "I know one when I see one" answers none of those questions.',
      },
      {
        label: 'Presumptive identification',
        body: 'A ring and a watch identify a possession. A person is identified by dental comparison, DNA, or radiographic comparison, and none was ordered because the file recorded the identification as confirmed on day one. The identifying witness was a grieving colleague, at a distance, asked to confirm rather than to compare, which is the weakest identification procedure that exists.',
        local: 'The county coroner\'s office has the capability. Nobody requested it, because a confident name arrived first and closed the question before the science was asked.',
      },
      {
        label: 'The report nobody read past page one',
        body: 'The absence of soot in the airway is in the autopsy report. It was written down, filed, and never read against the theory. That is not a scientific failure, it is an institutional one, and it is the most common kind. It also has to be disclosed: it undermines the state\'s theory whether or not anyone on the investigation noticed it.',
        local: 'Brady and Giglio, and Ohio Crim.R. 16, which sweeps broader than the constitutional floor. Nobody has to appreciate the significance of the finding for the obligation to attach.',
      },
      {
        label: 'Incentive and the expert',
        body: 'Bell is assessed in part on claims denied. He reached a defensible conclusion and stopped exactly where continuing could only have cost him. The right questions about any expert are who retained them, how they are paid, what question they were asked, and what they were not asked. Those four answers predict findings more reliably than anyone comfortable would like.',
        local: 'The same cross-examination, and the same problem in reverse on the state\'s side: a crime laboratory funded through the agency it serves is under the identical structural pressure, which is what the 2009 National Academy of Sciences report said out loud.',
      },
      {
        label: 'The disconfirming test',
        body: 'The decisive step, opening the grave, pulling the handset\'s last tower connection, checking the passenger manifests, is the step nobody ordered because the theory did not require it. Sound casework builds the falsifying test in on purpose: not what would confirm this, but what would prove it wrong if it were wrong, and has anybody gone and done it.',
        local: 'Blind verification and independent review exist in accredited laboratories for exactly this reason, because leaving it to individual conscientiousness has a documented failure rate.',
      },
    ],
    prompt: 'Crewe reached the right answer, that the fire was set, by a method that could not have told him otherwise. Argue whether a correct conclusion reached by an unvalidated method should be admissible under Evid.R. 702, then apply your own rule to a real forensic discipline of your choosing.',
  },
};

const CASES = { webster: WEBSTER, wayne: WAYNE, third: THIRD };
const CASE_ORDER = ['webster', 'wayne', 'third'];

// Everything a browser is allowed to see: brief, scene, who can be spoken to.
// Never the solution and never a witness's system prompt.
function publicCase(caseId) {
  const c = CASES[caseId];
  if (!c) return null;
  return {
    id: c.id,
    number: c.number,
    title: c.title,
    subtitle: c.subtitle,
    date: c.date,
    difficulty: c.difficulty,
    teaches: c.teaches,
    hero: c.hero,
    brief: c.brief,
    conditions: c.conditions || null,
    scene: c.scene.map((s) => ({ id: s.id, name: s.name, visible: s.visible, close: s.close })),
    cast: c.cast,
    witnesses: Object.values(c.witnesses).map((w) => ({
      key: w.key, name: w.name, title: w.title, tagline: w.tagline,
      portrait: w.portrait, greeting: w.greeting, chips: w.chips,
    })),
    modern: c.modern,
  };
}

// Resolves a case witness key to a full agent record shaped like the standing
// cast in sherlock-chat.js, so one chat handler serves both.
function witnessAgent(caseId, key) {
  const c = CASES[caseId];
  const w = c && c.witnesses[key];
  if (!w) return null;
  return {
    id: w.key,
    name: w.name,
    title: w.title,
    tagline: w.tagline,
    portrait: w.portrait,
    voiceId: w.voiceId || null,
    greeting: w.greeting,
    chips: w.chips,
    system: witnessSystem(w),
    isWitness: true,
    caseId,
  };
}

// The case context appended to a STANDING cast member's persona when they are
// working a case: what is known to the room, without the solution.
function caseContextFor(caseId) {
  const c = CASES[caseId];
  if (!c) return '';
  return [
    '',
    'THE CASE IN FRONT OF YOU',
    `${c.title}, ${c.date}.`,
    c.brief.join(' '),
    '',
    'WHAT IS AT THE SCENE',
    c.scene.map((s) => `- ${s.name}: ${s.visible} On close examination: ${s.close}`).join('\n'),
    '',
    c.conditions
      ? [
          '',
          'THE ONE THING IN THIS CASE THAT IS REAL',
          `You can look up the actual conditions of record for Dayton on any date, with get_conditions. The window that matters here is ${c.conditions.date} at ${c.conditions.time}, ${c.conditions.why}.`,
          'This is the real public record, not something anyone wrote for this case, and it is the only part of the file nobody can argue with. Use it when light, visibility, weather, or what a person or a camera could physically make out is in question, and use it before you accept anyone\'s description of the conditions, including a witness who was there.',
          'Report what it actually returns. If the lookup fails, say so plainly and do not state a time or a sky condition you have not checked. A made-up sunset time is worse than none, because a student can check it.',
        ].join('\n')
      : '',
    '',
    'HOW YOU HANDLE THE CASE',
    '- You have not been told the answer and you must not behave as though you have. Reason out loud from what is actually listed above and nothing else.',
    '- Never invent an item of evidence, a witness, a document, a device, or a record that is not in the list above. If a student asks about something that is not there, say plainly that it is not there, and say whether it is the kind of thing that should have been obtained.',
    '- The student is the investigator. Push them, question their reasoning, and make them say why. Do not hand them the conclusion because they asked for it. If they reason well, say so and build on it.',
    '- If a student states a conclusion the evidence does not support, say exactly which step is missing.',
  ].join('\n');
}

module.exports = {
  CASES,
  CASE_ORDER,
  publicCase,
  witnessAgent,
  caseContextFor,
  witnessSystem,
  FORMAT_RULES,
};
