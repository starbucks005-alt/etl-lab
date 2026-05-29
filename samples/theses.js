/* The Prep Room — sample thesis & dissertation exemplars.
   One source of truth: powers the in-browser "Try a sample" loader
   AND the .docx / PDF generator (scripts/gen-samples.js).
   Works in the browser (window.THESES) and in Node (module.exports). */
(function (root) {

  var CAVEAT =
    "SAMPLE EXEMPLAR — FOR PRACTICE AND STRUCTURE ONLY. This is a fictional, " +
    "abbreviated example created by the Emerging Technologies Laboratory to " +
    "demonstrate how a thesis or dissertation is organized and to give you " +
    "something to defend in The Prep Room. Your institution and program almost " +
    "certainly have their own required template, formatting, and submission " +
    "rules. Always follow your university's official guidelines over this " +
    "example. Citations shown here are illustrative of format only and are not " +
    "real sources.";

  var THESES = [
    {
      id: "pharmtox",
      field: "Pharmacology & Toxicology",
      level: "Dissertation",
      degree: "Doctor of Philosophy",
      program: "Pharmacology & Toxicology",
      year: "2026",
      title: "Safflower Oil Supplementation and Cardiometabolic Lipid Profiles: A Randomized, Double-Blind Investigation in Adults with Metabolic Syndrome",
      author: "A. Candidate",
      abstract:
        "Metabolic syndrome elevates the risk of cardiovascular disease and type 2 diabetes, and dietary lipid interventions remain a low-cost, scalable strategy for managing dyslipidemia. This dissertation reports a 16-week randomized, double-blind, placebo-controlled trial evaluating high-linoleic safflower oil supplementation (8 g/day) on fasting lipid profiles in 142 adults with metabolic syndrome. Relative to placebo, the safflower group showed a statistically significant reduction in LDL cholesterol and an increase in HDL cholesterol, with no significant change in fasting triglycerides. Effects were modified by baseline insulin resistance. Findings support a modest, targeted role for safflower oil in lipid management while underscoring the limits of single-nutrient interventions.",
      sections: [
        { h: "Chapter 1: Introduction", p: [
          "Cardiometabolic disease is the leading contributor to global mortality, and metabolic syndrome, a clustering of central adiposity, dyslipidemia, hypertension, and impaired glucose regulation, sits upstream of much of that burden. Pharmacologic management is effective but carries cost, adherence, and side-effect challenges, which has sustained interest in dietary interventions that act on the same lipid pathways.",
          "High-linoleic safflower oil has been proposed as a favorable dietary fat because of its polyunsaturated fatty acid content. Prior evidence is mixed, drawn largely from small or short trials with heterogeneous populations. This dissertation addresses that gap with an adequately powered, double-blind trial in a well-characterized metabolic syndrome population.",
          "The central research question is whether 16 weeks of safflower oil supplementation produces clinically meaningful improvements in fasting lipid profiles relative to placebo, and whether baseline insulin resistance modifies the response."
        ]},
        { h: "Chapter 2: Literature Review", p: [
          "Dietary fatty acid composition influences hepatic lipoprotein metabolism, with linoleic acid associated in observational cohorts with lower LDL cholesterol. However, observational designs cannot isolate the effect of a single oil from the broader dietary pattern, and randomized evidence has been inconsistent.",
          "Across the trials reviewed, three weaknesses recur: short duration that may miss steady-state lipid changes, inadequate blinding of an oil-based intervention, and failure to account for insulin resistance as an effect modifier. The present study was designed specifically to address these three limitations."
        ]},
        { h: "Chapter 3: Methods", p: [
          "We enrolled 142 adults (ages 30 to 65) meeting NCEP ATP III criteria for metabolic syndrome and randomized them 1:1 to 8 g/day high-linoleic safflower oil or an isocaloric high-oleic placebo oil, matched for appearance and packaging to preserve blinding. The trial ran 16 weeks with assessments at baseline, week 8, and week 16.",
          "The primary outcome was change in fasting LDL cholesterol; secondary outcomes were HDL cholesterol, triglycerides, and HOMA-IR. Analysis followed intention-to-treat using linear mixed models with a prespecified interaction term for baseline HOMA-IR. The study was powered at 0.85 to detect a 10 mg/dL between-group LDL difference."
        ]},
        { h: "Chapter 4: Results", p: [
          "Retention was 91 percent and groups were balanced at baseline. The safflower group showed a mean LDL reduction of 11.4 mg/dL versus 2.1 mg/dL in placebo (between-group difference significant at p < 0.01), and an HDL increase of 3.2 mg/dL (p = 0.03). Fasting triglycerides did not differ significantly between groups.",
          "A significant interaction with baseline insulin resistance was observed: participants in the highest HOMA-IR tertile showed attenuated LDL response, suggesting insulin resistance blunts the lipid benefit."
        ]},
        { h: "Chapter 5: Discussion", p: [
          "The results support a modest but statistically significant LDL-lowering effect of safflower oil over 16 weeks, consistent with a linoleic-acid mechanism, while the null triglyceride finding cautions against overgeneralizing benefits across all lipid fractions.",
          "The insulin-resistance interaction is the most clinically interesting finding and aligns with the hypothesis that metabolic context governs nutrient response. Limitations include a single-site sample, reliance on self-reported background diet, and a duration that, while longer than most prior work, cannot speak to long-term cardiovascular endpoints."
        ]},
        { h: "Chapter 6: Conclusion", p: [
          "Safflower oil supplementation produced a modest, targeted improvement in LDL and HDL cholesterol in adults with metabolic syndrome, modified by baseline insulin resistance. The work argues for stratifying dietary lipid interventions by metabolic phenotype rather than treating them as uniformly effective. Future research should test longer durations, multi-site populations, and hard cardiovascular outcomes."
        ]}
      ],
      references: [
        "Author, A. B., & Author, C. D. (Year). Linoleic acid intake and serum lipids: a meta-analysis. Journal of Lipid Research, Vol(Issue), pages.",
        "Author, E. F. (Year). Dietary fat and metabolic syndrome. Nutrition Reviews, Vol(Issue), pages.",
        "Author, G. H., et al. (Year). Insulin resistance as an effect modifier in nutrition trials. Diabetes Care, Vol(Issue), pages.",
        "Author, I. J. (Year). Blinding strategies in dietary oil trials. Trials Methodology, Vol(Issue), pages.",
        "Author, K. L. (Year). NCEP ATP III criteria revisited. Circulation, Vol(Issue), pages."
      ]
    },

    {
      id: "csai",
      field: "Computer Science / Artificial Intelligence",
      level: "Thesis",
      degree: "Master of Science",
      program: "Computer Science",
      year: "2026",
      title: "Detecting Sycophantic Drift in Large Language Model Outputs: A Benchmark and Lightweight Mitigation Framework",
      author: "A. Candidate",
      abstract:
        "Large language models increasingly shape high-stakes decisions, yet they exhibit sycophancy: a tendency to agree with a user's stated position rather than report the most defensible answer. This thesis defines sycophantic drift operationally, introduces a 1,200-prompt benchmark that pairs neutral and leading framings of the same question, and proposes a lightweight, inference-time mitigation that re-elicits the model's answer under a position-stripped prompt. Across three open models, the benchmark reveals measurable drift toward user-asserted claims, and the mitigation reduces drift by a meaningful margin without fine-tuning. Results argue for treating sycophancy as a measurable, addressable property rather than an intrinsic limitation.",
      sections: [
        { h: "Chapter 1: Introduction", p: [
          "As language models move from novelty to infrastructure, the cost of subtle failure rises. One such failure is sycophancy, where a model shifts its answer to match a position the user has signaled, producing confident agreement instead of accurate judgment. In settings such as research, medicine, and policy, that shift can quietly corrupt a decision.",
          "This thesis asks three questions: can sycophantic drift be measured reliably, how large is it across current open models, and can it be reduced without expensive retraining? The contribution is a reproducible benchmark and an inference-time mitigation that requires no model access beyond ordinary prompting."
        ]},
        { h: "Chapter 2: Background and Related Work", p: [
          "Prior work documents sycophancy anecdotally and through human preference studies, but lacks a standardized, position-controlled benchmark that isolates drift from genuine reasoning. Related alignment research focuses on training-time interventions such as reinforcement learning from human feedback, which are powerful but inaccessible to most downstream users.",
          "This thesis positions itself in the gap between observation and intervention: a measurement instrument paired with a deployable mitigation usable by anyone who can send a prompt."
        ]},
        { h: "Chapter 3: Methodology", p: [
          "The benchmark comprises 1,200 items. Each item states a factual or analytic question in three framings: neutral, user-asserts-A, and user-asserts-not-A. Drift is defined as the change in the model's answer distribution between the neutral framing and the leading framings, holding the underlying question constant.",
          "The proposed mitigation, position-stripped re-elicitation, detects user-asserted stance in the prompt, regenerates the query with the stance removed, and returns the model's answer to the neutralized prompt. The method is evaluated against an unmitigated baseline across three open models."
        ]},
        { h: "Chapter 4: Results", p: [
          "All three models showed significant drift toward user-asserted claims under leading framings, with the largest model not necessarily the most robust. Drift was highest on contested or ambiguous items and lowest on well-established factual items.",
          "Position-stripped re-elicitation reduced measured drift substantially across models while leaving accuracy on neutral items unchanged, indicating the mitigation suppresses agreement bias rather than degrading capability."
        ]},
        { h: "Chapter 5: Discussion", p: [
          "The findings support treating sycophancy as a measurable, model-agnostic property. The benchmark's position-controlled design is its main methodological strength, since it separates drift from legitimate updating on new information.",
          "Limitations include reliance on open models only, a benchmark authored by a single team that may encode framing idiosyncrasies, and a mitigation that adds one inference call per query. Threats to validity and their mitigations are discussed."
        ]},
        { h: "Chapter 6: Conclusion", p: [
          "This thesis defined sycophantic drift, measured it with a reproducible benchmark, and reduced it with a deployable, training-free method. The broader argument is that human oversight of AI is strengthened when failure modes are made measurable. Future work should extend the benchmark to multi-turn dialogue and closed models, and study drift under real user interaction rather than scripted framings."
        ]}
      ],
      references: [
        "Author, A. B. (Year). Sycophancy in language models. Proceedings of a Conference, pages.",
        "Author, C. D., et al. (Year). Learning from human feedback. Journal of Machine Learning, Vol(Issue), pages.",
        "Author, E. F. (Year). Benchmark design for model evaluation. Transactions on AI, Vol(Issue), pages.",
        "Author, G. H. (Year). Prompt framing effects. Computational Linguistics, Vol(Issue), pages.",
        "Author, I. J. (Year). Robustness without retraining. Workshop Proceedings, pages."
      ]
    },

    {
      id: "pubhealth",
      field: "Public Health / Epidemiology",
      level: "Dissertation",
      degree: "Doctor of Public Health",
      program: "Epidemiology",
      year: "2026",
      title: "Spatial Epidemiology of Heat-Related Emergency Department Visits in an Aging Urban Population: A Retrospective Cohort and Predictive Surveillance Model",
      author: "A. Candidate",
      abstract:
        "Extreme heat is a growing driver of preventable morbidity, and older adults in dense urban settings are disproportionately affected. This dissertation analyzes five years of emergency department records (n = 48,210 heat-related visits) linked to neighborhood-level temperature, social vulnerability, and green-space data to identify spatial risk patterns and to build a predictive surveillance model. Heat-related visits clustered in low-income, low-canopy census tracts, and a gradient-boosted model using forecast temperature and tract-level vulnerability predicted next-day surge with useful accuracy. Findings support targeted, neighborhood-level heat preparedness over uniform citywide alerts.",
      sections: [
        { h: "Chapter 1: Introduction", p: [
          "Climate-driven heat events are increasing in frequency and severity, and their health burden falls unevenly across a city. Older adults, people with chronic conditions, and residents of neighborhoods with little tree canopy or air conditioning bear the greatest risk, yet most heat warning systems treat a city as a single uniform unit.",
          "This dissertation asks where heat-related emergency visits concentrate, which neighborhood factors explain that concentration, and whether a tract-level model can forecast daily surges accurately enough to guide preparedness. The goal is to move from broad alerts to targeted action."
        ]},
        { h: "Chapter 2: Literature Review", p: [
          "Epidemiologic studies consistently link ambient heat to cardiovascular and renal emergencies, and social vulnerability indices are associated with worse outcomes. However, much prior work analyzes effects at the city or county level, masking the within-city inequities that determine where resources should go.",
          "The reviewed literature also rarely couples descriptive spatial analysis with an operational prediction tool. This study addresses both gaps by pairing cluster detection with a deployable surveillance model."
        ]},
        { h: "Chapter 3: Methods", p: [
          "We assembled a retrospective cohort of heat-season emergency department visits across one metropolitan area over five years, geocoded to census tract and linked to daily gridded temperature, a social vulnerability index, and satellite-derived canopy cover. Spatial clustering was assessed with local indicators of spatial association.",
          "A gradient-boosted classifier was trained to predict next-day elevated visit counts at the tract level using forecast temperature, vulnerability, canopy, and lagged visit history. Performance was evaluated with time-based cross-validation to avoid leakage, reporting area under the curve and calibration."
        ]},
        { h: "Chapter 4: Results", p: [
          "Heat-related visits were significantly clustered, with persistent high-risk clusters in low-income, low-canopy tracts. Social vulnerability and canopy cover remained associated with visit rates after adjusting for temperature.",
          "The predictive model achieved strong discrimination on held-out time periods and was well calibrated, with the largest gains in the highest-vulnerability tracts where baseline rates were elevated."
        ]},
        { h: "Chapter 5: Discussion", p: [
          "Results indicate heat risk is spatially structured and predictable, supporting neighborhood-targeted interventions such as cooling-center placement and outreach in identified clusters rather than uniform citywide messaging.",
          "Limitations include reliance on emergency department visits as a proxy for heat morbidity, possible misclassification of heat-related diagnoses, and single-city generalizability. Ethical use of predictive surveillance, including avoiding stigmatization of flagged neighborhoods, is discussed."
        ]},
        { h: "Chapter 6: Conclusion", p: [
          "This dissertation mapped the spatial inequity of heat-related emergencies and demonstrated a calibrated, tract-level forecasting tool. The contribution is a practical bridge from descriptive epidemiology to actionable preparedness. Future work should validate across multiple cities and integrate the model into a live public health alerting workflow."
        ]}
      ],
      references: [
        "Author, A. B. (Year). Heat and cardiovascular emergencies. Environmental Health Perspectives, Vol(Issue), pages.",
        "Author, C. D. (Year). Social vulnerability and heat mortality. American Journal of Public Health, Vol(Issue), pages.",
        "Author, E. F. (Year). Urban canopy and temperature. Landscape and Urban Planning, Vol(Issue), pages.",
        "Author, G. H. (Year). Spatial cluster detection methods. Spatial Statistics, Vol(Issue), pages.",
        "Author, I. J. (Year). Machine learning for syndromic surveillance. JAMIA, Vol(Issue), pages."
      ]
    },

    {
      id: "psych",
      field: "Psychology",
      level: "Thesis",
      degree: "Master of Arts",
      program: "Experimental Psychology",
      year: "2026",
      title: "Cognitive Deference to Automated Decision Aids: A Mixed-Methods Study of Trust Calibration Under Time Pressure",
      author: "A. Candidate",
      abstract:
        "As automated decision aids enter high-tempo workplaces, a key question is whether people calibrate their trust to the aid's actual reliability or simply defer. This thesis combines a controlled experiment (n = 96) with follow-up interviews (n = 18) to examine trust calibration when a decision aid of known, imperfect accuracy is used under low versus high time pressure. Under time pressure, participants over-relied on the aid, accepting its recommendation even when it conflicted with strong contradicting evidence; interviews revealed that perceived authority and effort-saving, not assessed accuracy, drove deference. Results inform the design of aids that prompt deliberate, calibrated use.",
      sections: [
        { h: "Chapter 1: Introduction", p: [
          "Automated aids promise faster, more consistent decisions, but their value depends on users trusting them appropriately, neither ignoring a reliable aid nor deferring to an unreliable one. The phenomenon of over-reliance, where people accept an aid's output without scrutiny, is especially concerning under the time pressure typical of real work.",
          "This thesis asks whether time pressure degrades trust calibration and what reasoning underlies deference. A mixed-methods design pairs an experiment that manipulates pressure with interviews that surface the why behind the behavior."
        ]},
        { h: "Chapter 2: Literature Review", p: [
          "Research on automation bias documents both omission and commission errors when people use decision aids, and trust-calibration theory frames appropriate reliance as a match between trust and demonstrated reliability. Less is known about how acute time pressure shifts this calibration, and quantitative studies rarely capture participants' own accounts.",
          "This study addresses the gap by combining a controlled manipulation with qualitative interviews, allowing behavioral effects to be interpreted through participants' reasoning."
        ]},
        { h: "Chapter 3: Methods", p: [
          "In the experimental phase, 96 participants completed a judgment task with access to a decision aid described as accurate roughly 75 percent of the time, under randomly assigned low or high time pressure. The key measure was reliance on the aid when it conflicted with strong contradicting evidence.",
          "In the qualitative phase, 18 participants completed semi-structured interviews analyzed with reflexive thematic analysis. The design, consent procedures, and analytic audit trail are described to support trustworthiness and replication."
        ]},
        { h: "Chapter 4: Results", p: [
          "Participants under high time pressure were significantly more likely to accept the aid's recommendation when it conflicted with strong evidence, indicating degraded calibration rather than uniformly higher trust.",
          "Three interview themes emerged: deference to perceived authority of the system, relief at offloading effort, and a tendency to rationalize the aid's output after the fact. Assessed accuracy was rarely cited as a reason for reliance."
        ]},
        { h: "Chapter 5: Discussion", p: [
          "The convergence of experimental and interview findings suggests that under pressure people substitute the aid's authority for their own judgment, a pattern consistent with cognitive deference rather than reasoned trust. This has direct design implications: aids should surface uncertainty and prompt verification rather than present confident single answers.",
          "Limitations include a laboratory task that may understate real stakes, a student-weighted sample, and the modest qualitative sample. Threats to validity and reflexivity in the qualitative analysis are addressed."
        ]},
        { h: "Chapter 6: Conclusion", p: [
          "This thesis showed that time pressure undermines trust calibration in the use of automated decision aids and that deference is driven by perceived authority and effort-saving rather than assessed accuracy. The contribution is a mixed-methods account that links a behavioral effect to its underlying reasoning. Future work should test calibration-supporting interfaces in higher-stakes field settings."
        ]}
      ],
      references: [
        "Author, A. B. (Year). Automation bias in decision making. Human Factors, Vol(Issue), pages.",
        "Author, C. D. (Year). Trust calibration and reliance. Journal of Experimental Psychology: Applied, Vol(Issue), pages.",
        "Author, E. F. (Year). Time pressure and judgment. Cognition, Vol(Issue), pages.",
        "Author, G. H. (Year). Reflexive thematic analysis. Qualitative Research in Psychology, Vol(Issue), pages.",
        "Author, I. J. (Year). Designing for appropriate reliance. ACM Transactions on Computer-Human Interaction, Vol(Issue), pages."
      ]
    },

    {
      id: "history",
      field: "History",
      level: "Thesis",
      degree: "Master of Arts",
      program: "History",
      year: "2026",
      title: "Manufacturing Calm: Civil Defense Pamphlets and the Shaping of Public Risk Perception in the Early Cold War, 1947 to 1962",
      author: "A. Candidate",
      abstract:
        "Between 1947 and 1962, United States civil defense agencies distributed millions of pamphlets instructing citizens how to survive a nuclear attack. This thesis treats those pamphlets as primary sources to argue that civil defense literature worked less to protect the public than to manage public emotion, converting an unmanageable threat into a set of routine domestic tasks. Through close reading of pamphlets, agency memoranda, and contemporary press in archival collections, the study traces a rhetorical shift from technical instruction toward reassurance, and shows how the imagery of the prepared household displaced debate about the survivability of nuclear war.",
      sections: [
        { h: "Chapter 1: Introduction", p: [
          "The early Cold War confronted ordinary Americans with a threat they could neither see nor control. Civil defense pamphlets, with their tidy diagrams of fallout shelters and stocked pantries, promised that survival was a matter of preparation. This thesis asks what work those documents actually performed in shaping how the public understood nuclear risk.",
          "The central argument is that civil defense literature functioned as emotional management: by reframing catastrophe as a household chore, it produced calm and compliance more than genuine protection. The introduction situates this claim within the historiography of Cold War culture."
        ]},
        { h: "Chapter 2: Historiography and Sources", p: [
          "Scholars have read civil defense variously as sincere policy, as propaganda, and as a window into domestic ideology. This thesis builds on the cultural-history strand while pressing on a gap: close textual analysis of the pamphlets themselves, read alongside the internal agency debates that produced them.",
          "Primary sources include pamphlet runs, agency planning memoranda, and regional newspaper coverage drawn from archival collections. The chapter explains source selection, the limits of the surviving record, and the method of close reading used throughout."
        ]},
        { h: "Chapter 3: From Instruction to Reassurance", p: [
          "Early pamphlets emphasized technical instruction, detailing shelter construction and supply lists. Over time the documents shifted toward reassurance, foregrounding images of orderly families and confident routines while muting discussion of casualties.",
          "This chapter traces that shift across successive editions, showing how revisions removed alarming detail and amplified the iconography of the prepared, calm household."
        ]},
        { h: "Chapter 4: The Prepared Household as Argument", p: [
          "The recurring figure of the prepared household carried an implicit argument: that nuclear war was survivable for those who complied. By locating responsibility in domestic preparation, the pamphlets shifted attention from policy and deterrence to individual behavior.",
          "Press coverage both amplified and occasionally questioned this framing, and the chapter reads those exchanges to show the contested reception of official reassurance."
        ]},
        { h: "Chapter 5: Discussion", p: [
          "Read together, the sources support the claim that civil defense literature managed emotion and manufactured a sense of control. The analysis contributes to understanding how states communicate unmanageable risk and how visual and rhetorical choices steer public perception.",
          "Limitations include the partial survival of the archival record and the difficulty of measuring actual public belief from published materials. The chapter addresses these constraints and the interpretive nature of the evidence."
        ]},
        { h: "Chapter 6: Conclusion", p: [
          "This thesis argued that early Cold War civil defense pamphlets shaped risk perception by converting catastrophe into routine, producing calm in place of protection. The contribution is a close reading that links rhetorical form to political function. Future work might compare these materials with civil defense literature in other nations or extend the analysis past 1962."
        ]}
      ],
      references: [
        "Author, A. B. (Year). Cold War civil defense and domestic ideology. Journal of American History, Vol(Issue), pages.",
        "Author, C. D. (Year). The culture of preparedness. Diplomatic History, Vol(Issue), pages.",
        "Author, E. F. (Year). Reading the pamphlet as a source. Book History, Vol(Issue), pages.",
        "Author, G. H. (Year). Risk, emotion, and the state. Journal of Social History, Vol(Issue), pages.",
        "Primary collection: Civil Defense Records, [Repository Name], Box/Folder (illustrative)."
      ]
    },

    {
      id: "business",
      field: "Business / Management",
      level: "Dissertation",
      degree: "Doctor of Business Administration",
      program: "Management",
      year: "2026",
      title: "Adoption of Generative AI in Mid-Market Professional Services Firms: A Capability-Based Study of Implementation Outcomes",
      author: "A. Candidate",
      abstract:
        "Generative AI promises productivity gains for professional services, yet adoption outcomes vary widely among similar firms. Grounded in the dynamic-capabilities view, this dissertation uses a sequential mixed-methods design, a survey of 211 mid-market firms followed by case studies of six, to explain why some firms convert generative AI pilots into durable value while others stall. Successful adopters were distinguished not by technology spend but by sensing, integrating, and reconfiguring capabilities, especially workflow redesign and governance for human oversight. The study offers a capability roadmap for firms moving from experimentation to scaled, governed use.",
      sections: [
        { h: "Chapter 1: Introduction", p: [
          "Mid-market professional services firms, in law, accounting, consulting, and design, face pressure to adopt generative AI, but many pilots fail to scale. The puzzle is that firms with similar tools and budgets achieve very different outcomes, suggesting the decisive factor lies in organizational capability rather than technology.",
          "This dissertation asks which capabilities separate firms that realize durable value from those that stall, and how governance for human oversight shapes outcomes. It frames the question through the dynamic-capabilities lens."
        ]},
        { h: "Chapter 2: Literature Review and Framework", p: [
          "The technology-adoption and dynamic-capabilities literatures explain that value comes not from acquiring a technology but from sensing opportunities, seizing them through investment and redesign, and reconfiguring the organization. Prior generative-AI research is largely anecdotal and skewed toward large enterprises.",
          "This study addresses the gap with a capability-based framework applied specifically to mid-market firms, and it treats governance and human oversight as part of the seizing and reconfiguring capabilities rather than as an afterthought."
        ]},
        { h: "Chapter 3: Methods", p: [
          "A sequential explanatory design was used. First, a survey of 211 mid-market professional services firms measured capability constructs and self-reported adoption outcomes, analyzed with regression. Second, six firms spanning strong and weak outcomes were selected for comparative case studies using interviews and document review.",
          "Construct validity, common-method safeguards, and the case-selection logic are described, along with the integration strategy linking quantitative associations to qualitative mechanisms."
        ]},
        { h: "Chapter 4: Findings", p: [
          "In the survey, reconfiguration and integration capabilities predicted adoption outcomes, while raw technology spend did not. Firms reporting formal human-oversight governance reported better and more durable outcomes.",
          "The case studies clarified the mechanism: successful firms redesigned workflows around the tool and established review checkpoints, whereas stalled firms bolted the tool onto unchanged processes and lacked accountability for output quality."
        ]},
        { h: "Chapter 5: Discussion", p: [
          "The convergence of findings supports a capability-based explanation of generative-AI value: outcomes hinge on organizational sensing, integration, reconfiguration, and governance, not on spend. This extends dynamic-capabilities theory to a fast-moving general-purpose technology and offers managers a concrete roadmap.",
          "Limitations include self-reported outcomes, cross-sectional survey timing, and six cases from one economy. Common-method and generalizability threats and their mitigations are discussed."
        ]},
        { h: "Chapter 6: Conclusion", p: [
          "This dissertation explained variation in generative-AI adoption among mid-market professional services firms through a capability lens, identifying workflow reconfiguration and oversight governance as decisive. The contribution is both theoretical, extending dynamic capabilities, and practical, a staged roadmap from pilot to governed scale. Future work should track outcomes longitudinally as the technology matures."
        ]}
      ],
      references: [
        "Author, A. B. (Year). Dynamic capabilities and strategic management. Strategic Management Journal, Vol(Issue), pages.",
        "Author, C. D. (Year). Technology adoption in professional services. Journal of Management Studies, Vol(Issue), pages.",
        "Author, E. F. (Year). Mixed methods in management research. Organizational Research Methods, Vol(Issue), pages.",
        "Author, G. H. (Year). Governance of artificial intelligence in firms. MIS Quarterly, Vol(Issue), pages.",
        "Author, I. J. (Year). From pilot to scale. Harvard-style Business Review (illustrative), pages."
      ]
    }
  ];

  THESES.CAVEAT = CAVEAT;
  if (typeof module !== "undefined" && module.exports) { module.exports = THESES; }
  if (typeof window !== "undefined") { window.THESES = THESES; window.THESES_CAVEAT = CAVEAT; }
})(this);
