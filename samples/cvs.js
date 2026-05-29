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
    }
  ];

  CVS.CAVEAT = CAVEAT;
  if (typeof module !== "undefined" && module.exports) { module.exports = CVS; }
  if (typeof window !== "undefined") { window.CVS = CVS; window.CVS_CAVEAT = CAVEAT; }
})(this);
