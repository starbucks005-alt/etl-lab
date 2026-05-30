/* The Prep Room — sample CV / resume templates for Interview mode.
   Powers the generated .docx / PDF downloads (scripts/gen-cvs.js).
   Browser (window.CVS) and Node (module.exports). */
(function (root) {

  var CAVEAT =
    "SAMPLE RESUME — FOR STRUCTURE AND INSPIRATION ONLY. This is a fictional " +
    "example from the Emerging Technologies Laboratory to show how a strong, " +
    "early-career resume is organized. Replace every line with your own real, " +
    "verifiable information. Follow any formatting rules required by your " +
    "program, career center, or target employer over this example.";

  var CVS = [
    {
      id: "swe",
      role: "Software Engineer (New Grad)",
      name: "A. Candidate",
      contact: "City, ST  ·  your.email@university.edu  ·  linkedin.com/in/yourname  ·  github.com/yourname",
      summary: "New-grad software engineer with backend internship experience and a focus on reliability and performance. Comfortable owning a feature from design through tested, shipped code.",
      education: [
        "B.S. in Computer Science, State University, 2026. GPA 3.6.",
        "Relevant coursework: Algorithms, Databases, Operating Systems, Distributed Systems."
      ],
      experience: [
        { title: "Software Engineering Intern", org: "Mid-Size SaaS Company", dates: "Summer 2025", bullets: [
          "Built and reviewed REST API endpoints in Python for a customer-facing product.",
          "Raised automated test coverage on the team's core service and reduced regressions.",
          "Designed and shipped a caching layer that cut a slow endpoint from 1.2s to 300ms."
        ]},
        { title: "Teaching Assistant, Data Structures", org: "State University", dates: "2024 to 2026", bullets: [
          "Led weekly lab sections for roughly 40 students and held office hours.",
          "Graded assignments and gave written feedback on code quality and correctness."
        ]}
      ],
      projects: [
        "Capstone: full-stack study-group matching app (React, Node, PostgreSQL) used by 200 classmates.",
        "Open-source: contributor to a CLI tool with 4 merged pull requests."
      ],
      skills: ["Python", "JavaScript", "SQL", "Git", "REST APIs", "Unit testing", "AWS (basic)"]
    },

    {
      id: "crc",
      role: "Clinical Research Coordinator",
      name: "A. Candidate",
      contact: "City, ST  ·  your.email@university.edu  ·  linkedin.com/in/yourname",
      summary: "Detail-driven research professional with two years supporting clinical trials, from informed consent through regulatory documentation and data quality. CITI Human Subjects certified.",
      education: [
        "B.S. in Biology, State University, 2024.",
        "Certifications: CITI Human Subjects Research; Basic phlebotomy."
      ],
      experience: [
        { title: "Research Assistant", org: "University Cardiology Lab", dates: "2022 to 2024", bullets: [
          "Consented participants and maintained regulatory binders for a 120-participant trial.",
          "Entered and quality-checked study data in REDCap and resolved data queries.",
          "Scheduled study visits and coordinated with the PI, study team, and participants."
        ]},
        { title: "Volunteer EMT", org: "Community Ambulance Service", dates: "2021 to 2022", bullets: [
          "Provided basic life support and patient care under protocol.",
          "Documented patient encounters accurately and handed off to receiving staff."
        ]}
      ],
      projects: [],
      skills: ["IRB submissions", "Informed consent", "REDCap", "Regulatory compliance", "Scheduling", "Patient interaction", "Basic phlebotomy"]
    },

    {
      id: "analyst",
      role: "Data Analyst",
      name: "A. Candidate",
      contact: "City, ST  ·  your.email@university.edu  ·  linkedin.com/in/yourname",
      summary: "Early-career data analyst who turns messy data into clear decisions. Strong SQL, comfortable in a BI tool, and able to explain results to non-technical stakeholders.",
      education: [
        "B.A. in Economics, minor in Statistics, State University, 2025.",
        "Relevant coursework: Regression Analysis, Statistics, Database Systems."
      ],
      experience: [
        { title: "Analytics Intern", org: "Retail Company", dates: "2024 to 2025", bullets: [
          "Wrote SQL to pull and clean data for weekly reporting across multiple stores.",
          "Built and maintained sales dashboards in Tableau used by the operations team.",
          "Automated a manual report, saving roughly 5 hours per week."
        ]}
      ],
      projects: [
        "Course project: regression analysis of public-health data, presented to faculty.",
        "Self-study: A/B testing fundamentals and experiment design."
      ],
      skills: ["SQL", "Excel (advanced)", "Tableau", "Python (pandas)", "Statistics", "A/B testing", "Stakeholder communication"]
    },

    {
      id: "pm",
      role: "Senior Program Manager",
      name: "A. Candidate",
      contact: "City, ST  ·  your.email@domain.com  ·  linkedin.com/in/yourname",
      summary: "Senior program manager with seven years leading multi-team programs from concept to launch. Track record of on-time delivery, cycle-time improvement, and vendor consolidation.",
      education: [
        "B.S. in Industrial Engineering, State University, 2017.",
        "Project Management Professional (PMP), 2020."
      ],
      experience: [
        { title: "Senior Program Manager", org: "Mid-Size SaaS Company", dates: "2022 to present", bullets: [
          "Led a cross-functional product launch across four engineering teams, two design teams, and one vendor, delivered on time.",
          "Reduced quarterly program cycle time by 18 percent through staged release and explicit dependency mapping.",
          "Coordinated a weekly VP-level steering committee for the company's largest program.",
          "Mentored three junior program managers and standardized a lightweight risk-register template now used org-wide."
        ]},
        { title: "Program Manager", org: "Growth-Stage Tech Company", dates: "2018 to 2022", bullets: [
          "Drove a vendor consolidation that saved roughly $400K per year.",
          "Ran the annual program portfolio review for twelve initiatives, including budget and dependency review with leadership."
        ]}
      ],
      projects: [],
      skills: ["Program management", "Stakeholder management", "OKRs", "Risk management", "Vendor management", "Jira / Confluence", "Executive communication", "PMP"]
    },

    {
      id: "dirres",
      role: "Director of Faculty Development",
      name: "A. Candidate",
      contact: "City, ST  ·  your.email@university.edu  ·  linkedin.com/in/yourname",
      summary: "Higher-education leader with eight years of progressive responsibility in faculty development. Track record of programs that retain faculty, improve teaching, and serve diverse disciplines.",
      education: [
        "Ed.D. in Higher Education Leadership, State University, 2018.",
        "M.A. in Curriculum and Instruction, 2012."
      ],
      experience: [
        { title: "Director of Faculty Development", org: "Private Liberal Arts College", dates: "2020 to present", bullets: [
          "Designed and launched a new-faculty onboarding program now reaching 100 percent of incoming faculty with 95 percent completion.",
          "Led a cross-college teaching effectiveness initiative associated with a 12 percent improvement in second-year retention.",
          "Co-chaired the campus DEI-in-the-classroom committee and authored new equity-minded pedagogy guidelines.",
          "Steward of a $1.2M annual operating budget; supervised a team of four professional staff."
        ]},
        { title: "Associate Director, Center for Teaching and Learning", org: "Regional State University", dates: "2015 to 2020", bullets: [
          "Built faculty learning communities across STEM, humanities, and professional schools.",
          "Supported a $600K Title III grant focused on student success."
        ]}
      ],
      projects: [
        "Service: faculty senate liaison; presentations at POD Network and AAHE.",
        "Scholarship: peer-reviewed publications in faculty development journals."
      ],
      skills: ["Faculty development", "Program design", "Budget stewardship", "Change leadership", "Assessment", "Relationship-building across academic units", "Equity-minded pedagogy"]
    },

    {
      id: "vpinnov",
      role: "Vice President for Innovation",
      name: "A. Candidate",
      contact: "City, ST  ·  your.email@domain.com  ·  linkedin.com/in/yourname",
      summary: "Cabinet-level executive with fifteen years of senior leadership in mission-driven organizations. Track record of large-scale change through influence, including enterprise AI governance and multi-stakeholder partnerships.",
      education: [
        "Ph.D. in Strategy and Leadership, State University, 2010.",
        "M.B.A., 2004."
      ],
      experience: [
        { title: "Vice President for Innovation", org: "Regional Mission-Driven Nonprofit", dates: "2019 to present", bullets: [
          "Cabinet-level role reporting to the CEO and a regular participant on the Board.",
          "Launched an enterprise AI working group that delivered an organization-wide AI policy and three pilots in nine months.",
          "Co-led a $50M five-year strategic planning process.",
          "Built external partnerships generating $20M in new investment."
        ]},
        { title: "Associate Vice President for Strategy", org: "Mid-Size Healthcare Nonprofit", dates: "2014 to 2019", bullets: [
          "Led a multi-year operational transformation that improved on-mission service delivery while holding costs flat.",
          "Member of the executive team and the AI / data governance committee."
        ]}
      ],
      projects: [
        "Board service: two community-foundation boards.",
        "Selected publications and talks on AI governance in mission-driven institutions."
      ],
      skills: ["Enterprise strategy", "Change leadership", "AI and emerging-technology governance", "Board engagement", "Partnership development", "Fiscal stewardship", "Executive communication"]
    }
  ];

  CVS.CAVEAT = CAVEAT;
  if (typeof module !== "undefined" && module.exports) { module.exports = CVS; }
  if (typeof window !== "undefined") { window.CVS = CVS; window.CVS_CAVEAT = CAVEAT; }
})(this);
