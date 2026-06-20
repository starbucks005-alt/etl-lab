/* gym-im.js — shared IM overlay for The Gym.
   Loaded by gym.html and gym-profile.html.
   Exposes window.openGymChat(charId) and window.closeGymChat().
   Delegated click handler wires any [data-gym-char] button automatically.
   Posts to /.netlify/functions/gym-chat for responses.
*/
(function () {
  'use strict';

  var GYM_CAST = {
    dom: {
      firstName: 'Coach Dom', fullName: 'Coach Dom Castellanos',
      credential: 'CSCS',
      role: 'Strength & Conditioning Coach',
      tagline: 'He believes most people do not need a new program. They need to run the old one for twelve more weeks.',
      bio: 'Anti-hype, pro-consistency, allergic to program-hopping. Former college linebacker who coaches the basics because the basics work. Short sentences. Add five pounds. Come back Thursday.',
      story: 'Dominic Castellanos played linebacker at a Division II program in Ohio and spent his twenties training under a strength coach who ran the same program for twenty years and got results every time. That was the education. He spent the next decade as a collegiate S&C assistant before moving to general-population coaching because, as he puts it, that is where the actual work is.\n\nHe has seen every trending protocol arrive and leave. His training logs go back sixteen years. The only things that show up consistently across all of them are progressive overload, compound movements, and people who came back on schedule. That is the whole philosophy.',
      whatIDo: 'I run the strength floor. You come in with a goal, I give you a program, and then I ask you to be boring with me for three months. The people who stay bored that long are the ones who make progress. I do not endorse trends. I do not pivot to what is popular this week. I check what Sana says about your recovery, I check what Lena says about your movement, and then I add weight to the bar.',
      whereToFind: {
        hosts:    [{ label: 'Workout Library', href: '/workout-library' }],
        coHost:   [],
        guestsOn: [],
        sources:  [],
        atDose:   [],
        atEtl:    [],
      },
      notes: [
        { date: 'June 14, 2026', text: 'Added a tempo protocol to the beginner push program. Three seconds down, one pause, two up. Nobody liked it the first week. Two people sent messages this week saying the shoulder stopped hurting. Tempo is not exciting. Tempo works.' },
        { date: 'May 28, 2026', text: "Someone asked what I think about high-frequency training. I think about it fine. Add weight to the bar on schedule. That is the frequency that matters." },
        { date: 'May 10, 2026', text: "Updated the squat cue language in the library. The old version was technically accurate and practically useless. Push the floor away works better than extend the knees and hips simultaneously. Same movement. Different words." },
      ],
      color: '#e0552e', bg: '#fff3f0',
      portrait: { open: '/agents/Coach_Dom_Eyes_open.png', closed: '/agents/Coach_Dom_Eyes_closed.png' },
      visitHref: '/workout-library', visitLabel: 'Workout Library',
    },
    lena: {
      firstName: 'Dr. Lena', fullName: 'Dr. Lena Brandt, DPT',
      credential: 'DPT, Licensed',
      role: 'Physical Therapist',
      tagline: 'The licensed authority on the floor. The brake on everyone else\'s enthusiasm.',
      bio: 'German-American sports-rehab clinician. Precise, composed, dryly funny. She does not raise her voice because she does not need to. "No. Next question." Then, a beat later, the actual help.',
      story: 'Lena Brandt trained in Germany and did a sports rehabilitation fellowship in the United States, then stayed. She has worked with collegiate athletes, recreational lifters, and people coming back from hip and knee replacements, and she treats all of them the same way: the same questions, the same assessment, and the same willingness to say something they do not want to hear.\n\nShe does not extend her scope and does not apologize for the boundary. When the question is clinical, she says so and routes to the right provider. When it is a movement pattern she can address, she addresses it precisely. The rest of the cast considers her the brake on their enthusiasm, which she takes as a compliment.',
      whatIDo: 'I handle movement assessments and clearances on the floor. You want to lift heavy, I want to make sure the hip hinge is sound first. I do not prescribe treatment. I tell you what to watch, what to stop, and when you need to see an actual provider instead of me. If Dom is about to let you push through something you should not push through, I am the one who says no.',
      whereToFind: {
        hosts:    [],
        coHost:   [{ label: 'Workout Library', href: '/workout-library' }],
        guestsOn: [],
        sources:  [{ label: 'Recovery Dehydrator', href: '/dehydrator' }],
        atDose:   [],
        atEtl:    [],
      },
      notes: [
        { date: 'June 11, 2026', text: 'Three people this week described the same knee pain pattern in different words. All three had the same hip weakness underneath it. The pain is not where the problem is. It rarely is.' },
        { date: 'May 19, 2026', text: 'Updated the hip hinge cues in the movement notes. The old language was technically correct and practically useless. Language is a clinical tool.' },
        { date: 'April 30, 2026', text: 'Asked Dom to pull the overhead press from three programs this week pending assessment findings. He asked if I was certain. I was. He pulled them.' },
      ],
      color: '#3a7fa0', bg: '#eef5fa',
      portrait: { open: '/agents/Dr_Lena_eyes_open.png', closed: '/agents/Dr_Lena_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    noor: {
      firstName: 'Noor', fullName: 'Noor Haddad, RYT-500',
      credential: 'RYT-500',
      role: 'Yoga & Breathwork Instructor',
      tagline: 'The breath-first voice that down-regulates the room without seeming to try.',
      bio: 'Levantine, found movement through her own recovery when breath was the only thing she could train. Leads guided yoga, breathwork audio, and the sleep sessions. Hard to rattle. Leaves silence on purpose.',
      story: 'Noor Haddad is Lebanese-American and found movement through a period she describes only as when breathing was the only thing she could train. She learned to do it well. Five-hundred-hour yoga teacher certification, additional breathwork training, and years of working with people whose nervous systems needed as much attention as their muscles.\n\nShe is the slow part of The Gym, and she knows it. The rest of the cast comes to her when they are injured, burned out, or running at a pace that is not sustainable. She does not rush those conversations.',
      whatIDo: 'I run the yoga sessions, the guided breathwork, and the sleep audio. I am also the one who tells Dom to let someone rest when they need to rest. He does not always listen the first time. He listens more than he used to. The breath-first approach is not a soft option. It is a different kind of work, and it compounds the same way strength work does.',
      whereToFind: {
        hosts:    [{ label: 'Yoga & Breathwork', href: '/gym#breathwork' }, { label: 'Sleep Audio', href: '/gym#sleep' }],
        coHost:   [{ label: 'Recovery Dehydrator', href: '/dehydrator' }],
        guestsOn: [],
        sources:  [],
        atDose:   [],
        atEtl:    [],
      },
      notes: [
        { date: 'June 10, 2026', text: 'Recorded a new eight-minute breathwork session for people who cannot sleep after a hard training week. This is a specific problem that deserves a specific answer.' },
        { date: 'May 22, 2026', text: "Dom asked me to run a breathwork block before the Saturday strength session as an experiment. Nobody fell asleep. That was his main concern." },
        { date: 'May 5, 2026', text: 'Added box breathing cues to the pre-competition protocol. The research on pre-performance activation and parasympathetic regulation is clearer than most people realize.' },
      ],
      color: '#7a6a4a', bg: '#f5f0e8',
      portrait: { open: '/agents/Noor_eyes_open.png', closed: '/agents/Noor_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    sana: {
      firstName: 'Dr. Sana', fullName: 'Dr. Sana Qureshi, PhD',
      credential: 'PhD, Exercise Physiology',
      role: 'Sleep & Recovery Physiologist',
      tagline: 'The evidence-based antidote to overtraining culture. She argues with Dom about rest days, and she wins, because she brings the paper.',
      bio: 'Pakistani-American physiologist. Calm, evidence-first, citation-ready. "Love the effort. Now show me your sleep from this week." Tracks her own HRV for fun. Never smug, always sourced.',
      story: 'Sana Qureshi is Pakistani-American with a PhD in exercise physiology from Penn State and a postdoctoral focus on sleep and performance. She came to the intersection of sleep and athletic training because the field had the tools and was not using them. Training science was focused on what happened during workouts. She wanted to look at what happened between them.\n\nShe tracks her own HRV for fun. She argues with Dom about rest days and wins, because she brings the paper. She is never smug about it. She just brings the paper.',
      whatIDo: 'I run the physiology desk. Sleep, HRV, overtraining indicators, recovery timelines. If the program is not producing expected adaptation, I want to look at sleep data first. I host Longevity Checked, which is the evidence review for lifespan and healthspan claims. I also read the contradicting study, not just the one that confirms what we already think.',
      whereToFind: {
        hosts:    [{ label: 'Longevity Checked', href: '/longevity' }],
        coHost:   [{ label: 'Workout Library', href: '/workout-library' }],
        guestsOn: [],
        sources:  [],
        atDose:   [],
        atEtl:    [],
      },
      notes: [
        { date: 'June 15, 2026', text: 'Two studies published this month on sleep extension and athletic performance. The direction is exactly what the evidence suggested. The effect sizes are larger than expected. Read the original, not the headline.' },
        { date: 'June 2, 2026', text: 'Added a new HRV interpretation guide to Longevity Checked. The question I get most often is what to do when it drops. The answer is not to train harder.' },
        { date: 'May 18, 2026', text: 'Ran a rest-day protocol comparison with Dom. He agreed to a structured deload week for two athletes who were plateaued. Both reported their best lifts the following week. He did not say I was right. He did not have to.' },
      ],
      color: '#2f8f7f', bg: '#eef7f5',
      portrait: { open: '/agents/Sana_eyes_open.png', closed: '/agents/Sana_eyes_closed.png' },
      visitHref: '/longevity', visitLabel: 'Longevity Checked',
    },
    nadia: {
      firstName: 'Nadia', fullName: 'Nadia Hassan, RD',
      credential: 'RD, Registered Dietitian',
      role: 'Recovery Nutritionist',
      tagline: 'Cross-posts evidence-based fuel guidance from The Dose kitchen to the gym floor.',
      bio: 'Nadia brings The Dose\'s nutrition rigor here. Performance fuel, recovery eating, and every supplement label checked against the research before it gets near the floor.',
      story: 'Nadia Hassan is a registered dietitian who started in clinical settings and moved to consumer health because that is where the confusion causing the most harm lives. She runs the performance nutrition desk across two platforms: The Dose for the full nutrition beat, and The Gym for the narrower question of what goes in the body to support training and recovery.\n\nShe has zero patience for supplement marketing and a great deal of patience for the people who got misled by it. Her standard is the same in both places: name the claim, find the study, read the methodology, report what it actually measured.',
      whatIDo: 'I am the nutrition link between The Dose kitchen and the gym floor. Pre-workout fuel, post-workout recovery, supplement labeling, protein timing. Every claim that comes through here gets checked against the research before anyone endorses it. The bench press is Dom\'s problem. The protein shake is mine. I also co-host here with Zara and Reece when the ingredient questions get complicated.',
      whereToFind: {
        hosts:    [],
        coHost:   [{ label: 'Smoothie Bar', href: '/gym#smoothies' }, { label: 'Recovery Dehydrator', href: '/dehydrator' }],
        guestsOn: [{ label: 'Workout Library', href: '/workout-library' }],
        sources:  [],
        atDose:   [{ label: 'Food as Medicine', href: null }, { label: 'Supplement Shelf', href: null }, { label: 'Body Map', href: null }],
        atEtl:    [],
      },
      notes: [
        { date: 'June 12, 2026', text: 'Checked a creatine brand that has been showing up in questions. The monohydrate dose is correct. The proprietary blend surrounding it is not. Creatine monohydrate by itself would be better and cheaper.' },
        { date: 'May 30, 2026', text: 'Updated the protein timing guide on The Dose and cross-posted the relevant parts to the gym floor. The 30-minute window myth is more persistent than the evidence against it.' },
        { date: 'May 12, 2026', text: 'Walked Reece through how I read a nutrition label. I realized my process is faster than I can explain it. That is the problem with expertise. We had a good session.' },
      ],
      color: '#2e7a50', bg: '#eef7f0',
      portrait: { open: '/agents/Nadia_eyes_open.png', closed: '/agents/Nadia_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    wyatt: {
      firstName: 'Wyatt', fullName: 'Wyatt E. Cooper',
      credential: 'Zero-Proof Bar',
      role: 'Recovery Drinks',
      tagline: 'The bar that does not compromise your recovery to taste good.',
      bio: 'Wyatt cross-posts from The Dose. Zero-proof recovery drinks, electrolyte sourcing checked, and recipes built around what the research actually supports. He also believes sparkling water with lime is underrated.',
      story: 'Wyatt E. Cooper spent his twenties in cocktail culture, became genuinely good at it, and then ran the numbers on what alcohol was doing to his sleep architecture and recovery timelines. He went zero-proof not because of a rule but because the data was more interesting than the alternative. He now makes better drinks than he ever did with spirits.\n\nHe cross-posts from The Dose, where he runs the bar full-time. At The Gym, the lens narrows to recovery: electrolyte ratios, post-workout hydration, ingredients the research actually supports. The menu reflects what he checked, not what sounds good.',
      whatIDo: 'I run the bar. Zero-proof, zero compromise on flavor. Every ingredient has a reason: electrolyte ratios, adaptogens that have actually been studied, recovery compounds dosed correctly. If you see it on the menu, I checked it. If I did not check it, it is not on the menu. Reece and I work together when the dehydration bench and the bar overlap, which is more often than you would think.',
      whereToFind: {
        hosts:    [{ label: 'Zero-Proof Bar', href: '/gym#bar' }],
        coHost:   [],
        guestsOn: [{ label: 'Recovery Dehydrator', href: '/dehydrator' }],
        sources:  [],
        atDose:   [{ label: 'The Bar', href: null }, { label: 'Food as Medicine', href: null }],
        atEtl:    [],
      },
      notes: [
        { date: 'June 9, 2026', text: 'Tested a new tart cherry and magnesium glycinate recovery drink. The sleep data from the studies is solid. The flavor needed three iterations. It is on the menu.' },
        { date: 'May 24, 2026', text: "Someone asked why I do not offer a pre-workout with caffeine. I do. It is called espresso. I will make you one." },
        { date: 'May 7, 2026', text: 'Reviewed electrolyte formulas from six commercial products against the research on sweat-rate replacement. Three are under-dosed. One gets it right. Posted the comparison.' },
      ],
      color: '#8a5a1a', bg: '#f7f0e5',
      portrait: { open: '/agents/Wyatt_eyes_open.png', closed: '/agents/Wyatt_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    reece: {
      firstName: 'Reece', fullName: 'Reece Ashford',
      credential: 'Recovery Intern',
      role: 'Dehydrator & Recovery Nutrition',
      tagline: 'Hosts The Recovery Dehydrator. Lives between food science and active recovery.',
      bio: 'Reece bridges the dehydration bench and the gym floor. Checks what the label says against what the study says, and is perpetually in over their head in the best way.',
      story: 'Reece Ashford came in as a Dose intern and ended up at The Gym when the Recovery Dehydrator bench opened and needed someone willing to learn in public. Reece is the first to admit when they are in over their head, which turns out to be a rare quality in health media. They have a food science background and a genuine curiosity about the gap between what labels claim and what studies measure.\n\nThey coordinate with Nadia on the nutrition science side and with Wyatt on the bar, which means they are always in three conversations at once and usually have a spreadsheet open.',
      whatIDo: 'I run the Recovery Dehydrator. I check what the label claims, find the trial design, and tell you what the study actually measured versus what the packaging implies. It is a lot of reading and a lot of spreadsheets. I am good at spreadsheets. I also ask Nadia when I hit the edge of what I know, which is often, and she is patient about it.',
      whereToFind: {
        hosts:    [{ label: 'Recovery Dehydrator', href: '/dehydrator' }],
        coHost:   [{ label: 'Zero-Proof Bar', href: '/gym#bar' }],
        guestsOn: [{ label: 'Workout Library', href: '/workout-library' }],
        sources:  [],
        atDose:   [],
        atEtl:    [],
      },
      notes: [
        { date: 'June 13, 2026', text: 'Ran the numbers on a dehydrated beet product that keeps getting recommended for athletic performance. The nitrate content checks out. The rest of the claims are doing a lot of work with limited evidence. Posted the full breakdown.' },
        { date: 'May 29, 2026', text: 'Nadia walked me through how she reads a nutrition label. I thought I already knew how to do it. I did not.' },
        { date: 'May 14, 2026', text: 'Cross-checked three electrolyte replacement products with Wyatt. We agreed on two of them. The third is still in debate. Will update when we settle it.' },
      ],
      color: '#4a6a80', bg: '#ecf3f8',
      portrait: { open: '/agents/Reece_eyes_open.png', closed: '/agents/Reece_eyes_closed.png' },
      visitHref: '/dehydrator', visitLabel: 'Recovery Dehydrator',
    },
    zara: {
      firstName: 'Zara', fullName: 'Zara Cole',
      credential: 'Smoothie Bar',
      role: 'Smoothies & Recovery Fuel',
      tagline: 'Every blend is built for a purpose. No filler, no mystery powders.',
      bio: 'Zara runs the smoothie bar on the gym floor. Post-lift, pre-run, or just getting through the afternoon. She keeps it simple and checks every ingredient before it goes in the blender.',
      story: 'Zara Cole grew up watching her grandmother make teas and tonics, went the formal route through nutrition coursework and food science, then built the smoothie bar as the place where both of those things meet. She is precise about ingredients and specific about purpose. Every menu item has a job.\n\nShe checks every ingredient before it goes in the blender. She has pulled products from the menu three times because third-party testing did not match the label. She does not announce it as a virtue. She just does not put things in the bar that she cannot stand behind.',
      whatIDo: 'I run the smoothie bar. Post-lift, pre-run, getting through the afternoon, the blend has a purpose and the ingredients earn their place. No filler, no mystery powders. I source simple and I check everything. I also pull things from the menu when the third-party test does not match the label, which has happened more than once. The bar is a kitchen, not a supplement store.',
      whereToFind: {
        hosts:    [{ label: 'Smoothie Bar', href: '/gym#smoothies' }],
        coHost:   [],
        guestsOn: [{ label: 'Recovery Dehydrator', href: '/dehydrator' }, { label: 'Workout Library', href: '/workout-library' }],
        sources:  [],
        atDose:   [],
        atEtl:    [],
      },
      notes: [
        { date: 'June 8, 2026', text: 'Built a new recovery blend around tart cherry, ginger, and coconut water. The research on tart cherry for muscle soreness is solid. Everything else in the blend earns its place.' },
        { date: 'May 25, 2026', text: 'Removed a protein powder from the bar menu. The label said one thing. The third-party test said another. The answer was no.' },
        { date: 'May 3, 2026', text: 'Added a new post-run electrolyte blend to the menu. Coconut water base, correct sodium, correct potassium. Simple formula. The research does not require the complex one.' },
      ],
      color: '#2e7a3a', bg: '#eef7f0',
      portrait: { open: '/agents/Zara_eyes_open.png', closed: '/agents/Zara_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    jax: {
      firstName: 'Jax', fullName: 'Jax Rivera',
      credential: 'SEO Specialist',
      role: 'Trend Verification',
      tagline: 'When a fitness trend starts moving, he maps it. Then he checks it.',
      bio: 'Jax cross-posts from the ETL studio. Tracks what is going viral in fitness, then runs it through the evidence before the crew endorses it. Gen Z with receipts. His cousin Mara is on the Newswire.',
      story: 'Jax Rivera grew up in Los Angeles, learned social media from the inside, and burned out on the hype cycle fast enough that he decided the research side was more interesting. His cousin Mara Rivera is on the ETL Newswire entertainment desk. They are very different people who respect each other a lot.\n\nHe tracks what is moving in fitness before it hits mainstream, then checks it against the evidence so the floor is not endorsing something that falls apart in six months. He maps the trend. Sana and Eli determine whether the evidence supports it. Most things do not make it through.',
      whatIDo: 'I track trends before they arrive. When something starts moving in search and social, I map it. Then I send it to Sana and Eli. If they cannot find a reason to reject it, it comes to the floor. Most things do not make it. That filter is the job. I also run the ETL Founder Studio SEO desk, so I understand how information moves before anyone else has decided whether it is true.',
      whereToFind: {
        hosts:    [{ label: 'Trend Tracker', href: '/gym#trends' }],
        coHost:   [],
        guestsOn: [{ label: 'Workout Library', href: '/workout-library' }, { label: 'Longevity Checked', href: '/longevity' }],
        sources:  [],
        atDose:   [],
        atEtl:    [{ label: 'Founder Studio SEO', href: null }],
      },
      notes: [
        { date: 'June 16, 2026', text: 'Cold plunge is everywhere right now. Mapped the search volume. Sent it to Sana and Eli. Sana has opinions. Eli pulled four papers. We will have something for the floor by next week.' },
        { date: 'June 3, 2026', text: 'Tracked a zone-2 cardio trend cycle that peaked, dipped, then a new meta-analysis came out and it spiked again. That is how it is supposed to work. The research moved first this time.' },
        { date: 'May 20, 2026', text: 'Flagged a breathing-for-performance trend about six weeks out from hitting mainstream. Sent to Noor for domain read. She was not surprised. She has been doing it for years.' },
      ],
      color: '#3a5aaa', bg: '#eef0fa',
      portrait: { open: '/agents/Jax_eyes_open.png', closed: '/agents/Jax_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    eli: {
      firstName: 'Eli', fullName: 'Eli Adler',
      credential: 'Fact-Checker',
      role: 'Fitness Claim Verification',
      tagline: 'The research pass that clears a claim before the crew endorses it.',
      bio: 'Eli runs the evidence check on fitness claims that look credible but need sourcing. Cross-trained from The Dose, where the same standard applies. If Jax finds a trend, Eli is usually the one pulling the paper.',
      story: 'Eli Adler runs the evidence desk at The Dose and cross-trains to The Gym when the fitness claims need the same treatment the health claims get. The process is identical: name the body that said it, find the actual document, read the methodology, report what it measured in plain language.\n\nThe fitness space has the same problem the health space does. Claims circulate without their sources. Studies get paraphrased until the original finding is unrecognizable. Eli brings the source. If Jax finds a trend, Eli is usually the one pulling the paper. If the paper has a flaw, Eli finds that too.',
      whatIDo: 'I run the evidence check. When Jax flags a trend, I find the study. When a supplement makes a claim, I find the trial design. When Dom or Sana endorse something, I confirm the citation is there. Not to undercut them. They know what they are doing. But the citation should be there, and I check that it is. I also cross-post the source review to The Dose so both floors see the same evidence.',
      whereToFind: {
        hosts:    [{ label: 'Evidence Check', href: '/gym#evidence' }],
        coHost:   [],
        guestsOn: [{ label: 'Workout Library', href: '/workout-library' }, { label: 'Longevity Checked', href: '/longevity' }],
        sources:  [{ label: 'Trend Tracker', href: '/gym#trends' }],
        atDose:   [{ label: 'Stoplight Claim Checker', href: null }, { label: 'Ask Eli', href: null }, { label: 'Mythbuster', href: null }],
        atEtl:    [],
      },
      notes: [
        { date: 'June 17, 2026', text: 'Jax flagged a cold plunge study this week. I found the original. Small sample, no control group, industry-funded. Sent back to Sana for her read. The mechanism is plausible. The study does not prove it.' },
        { date: 'June 4, 2026', text: 'Cleared a VO2 max testing protocol Dom wanted to add to the library. Two supporting papers, one contradicting. The contradicting one has better methodology. Added both with notes.' },
        { date: 'May 21, 2026', text: 'Ran the same claim-check process on three trending supplement stacks. One cleared. Two did not. The ones that did not clear have better marketing than the one that did. That is the usual pattern.' },
      ],
      color: '#3a4a5a', bg: '#eceff2',
      portrait: { open: '/agents/Eli_Adler_profile.png', closed: null },
      visitHref: null, visitLabel: null,
    },
  };

  // Expose cast for gym-profile.html to use
  window.GYM_CAST = GYM_CAST;

  // Thread state per character, per page load
  var threads = {};
  var overlayEl = null;
  var activeCharId = null;
  var lastFocused = null;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ensureStyles() {
    if (document.getElementById('gym-chat-styles')) return;
    var s = document.createElement('style');
    s.id = 'gym-chat-styles';
    s.textContent = [
      '.gym-chat-overlay{position:fixed;inset:0;background:rgba(16,26,34,0.62);display:flex;align-items:center;justify-content:center;z-index:9000;padding:1rem;}',
      '.gym-chat-overlay[hidden]{display:none;}',
      '.gym-chat-panel{background:#fff;border-radius:10px;width:100%;max-width:540px;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.32);overflow:hidden;font-family:Inter,system-ui,sans-serif;}',
      '.gym-chat-header{display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1.1rem;border-bottom:1px solid #e4eaee;background:var(--gym-chat-bg,#f4f7f9);}',
      '.gym-chat-av{width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid #fff;}',
      '.gym-chat-av img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.gym-chat-who{flex:1;}',
      '.gym-chat-name{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:1.05rem;color:var(--gym-chat-color,#16212b);line-height:1.2;}',
      '.gym-chat-role-label{font-size:0.8rem;color:#6a7a8a;}',
      '.gym-chat-close{border:none;background:transparent;font-size:1.5rem;color:#5a6a7a;cursor:pointer;padding:0.2rem 0.5rem;line-height:1;}',
      '.gym-chat-close:hover{color:#16212b;}',
      '.gym-chat-thread{flex:1;overflow-y:auto;padding:1rem 1.1rem;background:#fbfcfd;display:flex;flex-direction:column;gap:0.7rem;}',
      '.gym-chat-seed{font-size:0.85rem;color:#6a7a8a;font-style:italic;padding:0.5rem 0.8rem;background:#f0f3f6;border-radius:6px;align-self:center;max-width:90%;text-align:center;}',
      '.gym-chat-msg{max-width:85%;}',
      '.gym-chat-msg-user{align-self:flex-end;background:var(--gym-chat-color,#e0552e);color:#fff;padding:0.6rem 0.9rem;border-radius:14px 14px 4px 14px;font-size:0.95rem;line-height:1.45;}',
      '.gym-chat-msg-char{align-self:flex-start;background:#fff;border:1px solid #e2e7ec;color:#16212b;padding:0.6rem 0.9rem;border-radius:14px 14px 14px 4px;font-size:0.95rem;line-height:1.45;}',
      '.gym-chat-msg-char.routed{border-color:var(--gym-chat-color,#e0552e);background:var(--gym-chat-bg,#fff3f0);}',
      '.gym-chat-msg-tools{display:flex;gap:0.5rem;margin-top:0.4rem;align-items:center;}',
      '.gym-chat-route-btn{border:1px solid #d4dde2;background:#fff;padding:0.3rem 0.6rem;border-radius:4px;cursor:pointer;font-size:0.8rem;color:var(--gym-chat-color,#e0552e);font-family:Inter,sans-serif;}',
      '.gym-chat-route-btn:hover{background:var(--gym-chat-bg,#fff3f0);}',
      '.gym-chat-typing{align-self:flex-start;color:#6a7a8a;font-size:0.85rem;font-style:italic;padding:0.4rem 0.8rem;}',
      '.gym-chat-typing::after{content:"";display:inline-block;width:3ch;text-align:left;animation:gym-dots 1.4s steps(4,end) infinite;}',
      '@keyframes gym-dots{0%,25%{content:""}50%{content:"."}75%{content:".."}100%{content:"..."}}',
      '.gym-chat-err{align-self:stretch;color:#a8526a;font-size:0.85rem;padding:0.5rem 0.8rem;background:#fbeef2;border-radius:6px;}',
      '.gym-chat-form{display:flex;gap:0.5rem;padding:0.8rem 1rem;border-top:1px solid #e4eaee;background:#fff;}',
      '.gym-chat-input{flex:1;padding:0.55rem 0.8rem;font-size:0.95rem;font-family:Inter,sans-serif;border:1px solid #d4dde2;border-radius:4px;color:#16212b;}',
      '.gym-chat-input:focus{outline:2px solid var(--gym-chat-color,#e0552e);outline-offset:1px;}',
      '.gym-chat-send{padding:0.55rem 1.1rem;background:var(--gym-chat-color,#e0552e);color:#fff;border:none;border-radius:4px;font-weight:600;font-size:0.95rem;cursor:pointer;font-family:Inter,sans-serif;}',
      '.gym-chat-send:disabled{background:#b8c5d0;cursor:wait;}',
      '.gym-chat-disc{font-size:0.75rem;color:#8a98a4;text-align:center;padding:0.4rem 1rem 0.7rem;background:#fff;}',
    ].join('');
    document.head.appendChild(s);
  }

  function ensureOverlay() {
    if (overlayEl) return;
    ensureStyles();
    overlayEl = document.createElement('div');
    overlayEl.className = 'gym-chat-overlay';
    overlayEl.setAttribute('hidden', '');
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.innerHTML = '<div class="gym-chat-panel"></div>';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) closeGymChat();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlayEl.hasAttribute('hidden')) closeGymChat();
    });
    document.body.appendChild(overlayEl);
  }

  function renderThread() {
    var ch = GYM_CAST[activeCharId];
    var threadEl = overlayEl.querySelector('.gym-chat-thread');
    var thread = threads[activeCharId] || [];
    if (!thread.length) {
      threadEl.innerHTML = '<div class="gym-chat-seed">You\'re messaging ' + esc(ch.firstName) + '. Say hi, or ask something in their lane.</div>';
      return;
    }
    var html = thread.map(function (m) {
      if (m.role === 'user') {
        return '<div class="gym-chat-msg gym-chat-msg-user">' + esc(m.content) + '</div>';
      }
      var routed = m.kind === 'routed';
      var routeBtn = '';
      if (routed && m.route_to && GYM_CAST[m.route_to]) {
        routeBtn = '<button type="button" class="gym-chat-route-btn" data-route="' + esc(m.route_to) + '">Open chat with ' + esc(GYM_CAST[m.route_to].firstName) + ' →</button>';
      }
      return '<div class="gym-chat-msg gym-chat-msg-char' + (routed ? ' routed' : '') + '">' +
        esc(m.content) +
        (routeBtn ? '<div class="gym-chat-msg-tools">' + routeBtn + '</div>' : '') +
        '</div>';
    }).join('');
    threadEl.innerHTML = html;
    threadEl.scrollTop = threadEl.scrollHeight;
    threadEl.querySelectorAll('.gym-chat-route-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.dataset.route;
        if (next && GYM_CAST[next]) {
          closeGymChat();
          setTimeout(function () { openGymChat(next); }, 120);
        }
      });
    });
  }

  function openGymChat(charId) {
    var ch = GYM_CAST[charId];
    if (!ch) { console.warn('[gym-im] unknown char:', charId); return; }
    ensureOverlay();
    activeCharId = charId;
    var panel = overlayEl.querySelector('.gym-chat-panel');
    panel.style.setProperty('--gym-chat-color', ch.color);
    panel.style.setProperty('--gym-chat-bg', ch.bg);
    panel.innerHTML = [
      '<div class="gym-chat-header">',
      '  <div class="gym-chat-av"><img src="' + esc(ch.portrait.open) + '" alt="' + esc(ch.firstName) + '" loading="eager"></div>',
      '  <div class="gym-chat-who">',
      '    <div class="gym-chat-name">' + esc(ch.firstName) + '</div>',
      '    <div class="gym-chat-role-label">' + esc(ch.role) + '</div>',
      '  </div>',
      '  <button type="button" class="gym-chat-close" aria-label="Close">×</button>',
      '</div>',
      '<div class="gym-chat-thread"></div>',
      '<form class="gym-chat-form" autocomplete="off">',
      '  <input type="text" class="gym-chat-input" placeholder="Type a message..." maxlength="800" aria-label="Your message">',
      '  <button type="submit" class="gym-chat-send">Send</button>',
      '</form>',
      '<div class="gym-chat-disc">The Gym is not medical or clinical advice. For personal health concerns, talk to your doctor or physical therapist.</div>',
    ].join('');

    panel.querySelector('.gym-chat-close').addEventListener('click', closeGymChat);
    panel.querySelector('.gym-chat-form').addEventListener('submit', onSubmit);

    renderThread();
    lastFocused = document.activeElement;
    overlayEl.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    panel.querySelector('.gym-chat-input').focus();
  }

  function closeGymChat() {
    if (!overlayEl) return;
    overlayEl.setAttribute('hidden', '');
    document.body.style.overflow = '';
    activeCharId = null;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  async function onSubmit(e) {
    e.preventDefault();
    var inputEl = overlayEl.querySelector('.gym-chat-input');
    var sendBtn = overlayEl.querySelector('.gym-chat-send');
    var threadEl = overlayEl.querySelector('.gym-chat-thread');
    var text = (inputEl.value || '').trim();
    if (!text) return;

    if (!threads[activeCharId]) threads[activeCharId] = [];
    threads[activeCharId].push({ role: 'user', content: text });
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    renderThread();

    var typingEl = document.createElement('div');
    typingEl.className = 'gym-chat-typing';
    typingEl.textContent = GYM_CAST[activeCharId].firstName + ' is typing';
    threadEl.appendChild(typingEl);
    threadEl.scrollTop = threadEl.scrollHeight;

    var charId = activeCharId;
    try {
      var res = await fetch('/.netlify/functions/gym-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: charId,
          history: threads[charId].map(function (m) { return { role: m.role, content: m.content }; }),
        }),
      });
      typingEl.remove();
      if (!res.ok) {
        var errBody = {}; try { errBody = await res.json(); } catch {}
        throw new Error(errBody.error || 'Server returned ' + res.status);
      }
      var data = await res.json();
      if (data.kind === 'error') throw new Error(data.error || 'Chat failed');
      threads[charId].push({
        role: 'assistant',
        content: data.reply || '(no reply)',
        kind: data.kind || 'answer',
        route_to: data.route_to || null,
      });
      renderThread();
    } catch (err) {
      typingEl.remove();
      var errEl = document.createElement('div');
      errEl.className = 'gym-chat-err';
      errEl.textContent = "Couldn't reach " + GYM_CAST[charId].firstName + '. ' + err.message;
      threadEl.appendChild(errEl);
      threadEl.scrollTop = threadEl.scrollHeight;
    } finally {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  // Expose globally
  window.openGymChat = openGymChat;
  window.closeGymChat = closeGymChat;

  // Delegated click handler for all [data-gym-char] buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-gym-char]');
    if (!btn) return;
    openGymChat(btn.dataset.gymChar);
  });

})();
