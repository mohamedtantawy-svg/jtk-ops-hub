export const CALENDAR_EVENTS=[
  // ── January 2026 ──────────────────────────────────────────────
  {id:'ce-j1', type:'review',   title:'Q4 Compliance Review',              date:'2026-01-08', time:'10:00', description:'Quarterly compliance audit across EMEA entities.', attendees:6},
  {id:'ce-j2', type:'meeting',  title:'Annual Planning Kickoff',           date:'2026-01-12', time:'14:00', description:'Full-team strategy alignment for 2026.', attendees:22},
  {id:'ce-j3', type:'deadline', title:'Benefits Enrollment Deadline — AU', date:'2026-01-20', time:'17:00', description:'4 employees must complete benefit selections.'},
  {id:'ce-j4', type:'leave',    title:'Parental Leave — Aisha Patel',      date:'2026-01-27', description:'Maternity leave start. Cover assigned to James Okafor.'},

  // ── February 2026 ─────────────────────────────────────────────
  {id:'ce-f1', type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-02-03', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},
  {id:'ce-f2', type:'review',   title:'Work Permit Review — APAC',         date:'2026-02-10', time:'11:00', description:'Review of upcoming APAC permit renewals.', attendees:3},
  {id:'ce-f3', type:'meeting',  title:'1:1 — Sarah Chen & Mohamed',        date:'2026-02-17', time:'10:00', description:'Bi-weekly 1:1 check-in.', attendees:2},
  {id:'ce-f4', type:'deadline', title:'February Payroll Cutoff',           date:'2026-02-20', time:'12:00', description:'Final deadline for payroll submissions — all regions.'},
  {id:'ce-f5', type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-02-24', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},

  // ── March 2026 (current month) ────────────────────────────────
  {id:'ce-m1', type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-03-03', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},
  {id:'ce-m2', type:'review',   title:'Onboarding Milestone Check — Q1',   date:'2026-03-05', time:'14:00', description:'Review onboarding progress for Q1 new hires.', attendees:4},
  {id:'ce-m3', type:'deadline', title:'Work Permit Renewal — Lucas Dubois', date:'2026-03-09', time:'17:00', description:'NL permit expires — must file renewal immediately.'},
  {id:'ce-m4', type:'meeting',  title:'1:1 — Elena Petrova & Mohamed',     date:'2026-03-10', time:'10:00', description:'Bi-weekly 1:1 check-in.', attendees:2},
  {id:'ce-m5', type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-03-10', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},
  {id:'ce-m6', type:'leave',    title:'Parental Leave — Thomas Müller',    date:'2026-03-13', description:'Paternity leave begins. DE region backup assigned.'},
  {id:'ce-m7', type:'review',   title:'Probation Review — Lena Fischer',   date:'2026-03-17', time:'11:00', description:'90-day probation review for Lena Fischer (DE).', attendees:3},
  {id:'ce-m8', type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-03-17', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},
  {id:'ce-m9', type:'deadline', title:'Benefits Enrollment — AU (4 ppl)',  date:'2026-03-20', time:'17:00', description:'4 Australian employees must complete benefit selections.'},
  {id:'ce-m10',type:'meeting',  title:'Exit Interview — Alex Rivera',      date:'2026-03-20', time:'15:00', description:'Offboarding exit interview. Managed by Sarah Chen.', attendees:2},
  {id:'ce-m11',type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-03-20', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},
  {id:'ce-m12',type:'deadline', title:'March Payroll Processing Cutoff',   date:'2026-03-22', time:'12:00', description:'Final payroll submission deadline — all regions.'},
  {id:'ce-m13',type:'review',   title:'Probation Review — Marcus Webb',    date:'2026-03-23', time:'11:00', description:'90-day probation review for Marcus Webb (US).', attendees:3},
  {id:'ce-m14',type:'meeting',  title:'1:1 — Sarah Chen & Mohamed',        date:'2026-03-24', time:'10:00', description:'Bi-weekly 1:1 check-in.', attendees:2},
  {id:'ce-m15',type:'meeting',  title:'Exit Interview — Tom Walsh',        date:'2026-03-25', time:'14:00', description:'Offboarding exit interview — FR. Sarah Chen.', attendees:2},
  {id:'ce-m16',type:'meeting',  title:'Payroll Alignment Call — EMEA',     date:'2026-03-25', time:'11:00', description:'EMEA payroll alignment with regional leads.', attendees:5},
  {id:'ce-m17',type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-03-24', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},
  {id:'ce-m18',type:'meeting',  title:'Immigration Review — Q1 Wrap-up',   date:'2026-03-27', time:'10:00', description:'Review all open immigration cases before Q1 close.', attendees:4},
  {id:'ce-m19',type:'review',   title:'Annual Policy Review Deadline',     date:'2026-03-31', time:'17:00', description:'All teams must submit policy acknowledgements.'},

  // ── April 2026 ────────────────────────────────────────────────
  {id:'ce-a1', type:'meeting',  title:'Q2 Kickoff — All Hands',            date:'2026-04-01', time:'10:00', description:'Company-wide Q2 goals and priorities presentation.', attendees:80},
  {id:'ce-a2', type:'review',   title:'Q2 Benefits Review Window Opens',   date:'2026-04-01', time:'09:00', description:'Annual benefits review window opens for all regions.'},
  {id:'ce-a3', type:'meeting',  title:'1:1 — Elena Petrova & Mohamed',     date:'2026-04-07', time:'10:00', description:'Bi-weekly 1:1 check-in.', attendees:2},
  {id:'ce-a4', type:'deadline', title:'Work Permit Renewal — Aisha Mohammed', date:'2026-04-10', time:'17:00', description:'AE permit must be renewed before expiry.'},
  {id:'ce-a5', type:'meeting',  title:'Weekly Sync — HRX Team',            date:'2026-04-14', time:'09:30', description:'Weekly HRX operational standup.', attendees:8},
  {id:'ce-a6', type:'deadline', title:'Work Permit Renewal — María González', date:'2026-04-15', time:'17:00', description:'BR permit renewal — legal filing deadline.'},
  {id:'ce-a7', type:'review',   title:'Onboarding Milestone — Anya Kapoor', date:'2026-04-15', time:'11:00', description:'30-day onboarding milestone review.', attendees:3},
  {id:'ce-a8', type:'leave',    title:'Parental Leave — Maria Garcia',     date:'2026-04-20', description:'Maternity leave begins. ES region coverage activated.'},
  {id:'ce-a9', type:'deadline', title:'April Payroll Cutoff',              date:'2026-04-22', time:'12:00', description:'Final payroll submission deadline — all regions.'},
  {id:'ce-a10',type:'meeting',  title:'Compliance Deep-Dive — APAC',       date:'2026-04-28', time:'14:00', description:'APAC-specific compliance review with regional leads.', attendees:6},

  // ── May 2026 ──────────────────────────────────────────────────
  {id:'ce-my1',type:'review',   title:'Probation Review — Kyle Brandt',    date:'2026-05-04', time:'11:00', description:'90-day probation review for Kyle Brandt (CA).', attendees:3},
  {id:'ce-my2',type:'leave',    title:'Parental Leave — Aisha Patel ends', date:'2026-05-12', description:'Return to work date — cover arrangements to end.'},
  {id:'ce-my3',type:'deadline', title:'May Payroll Cutoff',                date:'2026-05-22', time:'12:00', description:'Final payroll submission deadline — all regions.'},
  {id:'ce-my4',type:'meeting',  title:'Mid-Year Planning — HRX',          date:'2026-05-26', time:'14:00', description:'Half-year review and H2 roadmap planning.', attendees:10},
];

export const START_DATES=[
  {name:'Kyle Brandt',     country:'CA', date:'2026-03-16', status:'started',   role:'Software Engineer'},
  {name:'Talia Moore',     country:'US', date:'2026-03-23', status:'started',   role:'Product Designer'},
  {name:'Anya Kapoor',     country:'IN', date:'2026-04-01', status:'confirmed', role:'Data Analyst'},
  {name:'Lukas Braun',     country:'DE', date:'2026-04-07', status:'confirmed', role:'People Ops Coordinator'},
  {name:'Sofia Reyes',     country:'MX', date:'2026-04-14', status:'pending',   role:'Customer Success Manager'},
  {name:'James Achebe',    country:'NG', date:'2026-05-01', status:'pending',   role:'Backend Engineer'},
];
