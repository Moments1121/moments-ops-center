/**
 * Moments Hospice — Zendesk Keyword Intelligence Scanner
 * GitHub: github.com/Moments1121/moments-ops-center
 *
 * Scans Subject, Tags, Description (body), Message Details, and Dialpad AI fields.
 * Filters to open/pending/new/hold ONLY (closed & solved excluded).
 * Detects repeat callers by phone number AND repeat issues by patient/subject.
 * Live data via Anthropic API + CData MCP; falls back to demo snapshot.
 */

import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD RULES  (subject + tags + body all scanned)
// Built from real ticket bodies pulled March 10 2026
// ─────────────────────────────────────────────────────────────────────────────
export const KEYWORD_RULES = [
  // ── SAFETY / QI ─────────────────────────────────────────────────────────
  {
    category: "Safety — Fall",
    severity: "critical",
    color: "#FF3B3B",
    bg: "#2A0808",
    icon: "⚠️",
    bodyKeys: ["fall with injury", "fall report", "a fall report was entered", "patient has had", "fallen"],
    patterns: [/\bfall\b/i, /\bfallen\b/i, /fall with injury/i, /fall report/i],
    tag: "occurrence_clarification",
    clinical_action: "Physician orders, family update, care plan revision, ICC tracking",
  },
  {
    category: "Safety — Seizure/Emergency",
    severity: "critical",
    color: "#FF3B3B",
    bg: "#2A0808",
    icon: "🚨",
    bodyKeys: ["seizure", "911", "called 911", "emergency", "unresponsive", "seizure like activity"],
    patterns: [/seizure/i, /called 911/i, /911 before calling/i, /unresponsive/i],
    tag: "occurrence_clarification",
    clinical_action: "Immediate RN assessment, physician notification, family update",
  },
  {
    category: "Safety — Infection",
    severity: "critical",
    color: "#FF3B3B",
    bg: "#2A0808",
    icon: "🦠",
    bodyKeys: ["infection report", "wound", "sepsis", "pressure ulcer", "pressure injury", "skin concern"],
    patterns: [/infection report/i, /\bwound\b/i, /sepsis/i, /pressure ulcer/i, /skin concern/i],
    tag: "infection_report_clarification",
    clinical_action: "Wound care orders, HOPE documentation, care plan update",
  },
  {
    category: "Safety — Patient Injured",
    severity: "critical",
    color: "#FF3B3B",
    bg: "#2A0808",
    icon: "🩹",
    bodyKeys: ["was patient injured", "injury", "fall with injury", "not safe"],
    patterns: [/patient injured/i, /fall with injury/i, /not safe/i],
    tag: "occurrence_clarification",
    clinical_action: "Occurrence report, physician orders for injury",
  },

  // ── VISIT COMPLIANCE ─────────────────────────────────────────────────────
  {
    category: "Late / Unverified Visit",
    severity: "critical",
    color: "#FF6B2B",
    bg: "#2A1008",
    icon: "⏰",
    bodyKeys: ["late visits", "unverified", "floating around the system", "not on your device", "late/incomplete", "please address asap", "holding up billing"],
    patterns: [/late visit/i, /unverified visit/i, /floating.*system/i, /not on your device/i, /please address asap/i, /holding up billing/i, /late.*incomplete/i],
    tag: "_unverified_visit_request",
    clinical_action: "Complete documentation or notify TC to add back to device",
  },
  {
    category: "Declined Visit",
    severity: "high",
    color: "#FF8C3B",
    bg: "#251508",
    icon: "🚫",
    bodyKeys: ["declined visit", "visit declined", "sent back a declined"],
    patterns: [/declined visit/i, /sent back a declined/i, /visit.*declined/i],
    tag: "_declined_visit",
    clinical_action: "Reassign visit, document reason, follow proper process",
  },
  {
    category: "HUV — Documentation Needed",
    severity: "high",
    color: "#FF8C3B",
    bg: "#251508",
    icon: "📋",
    bodyKeys: ["huv", "hope manual", "medication start dates", "addendum", "symptom scoring", "hope scoring", "skin concerns", "in an addendum please add"],
    patterns: [/\bhuv\b/i, /hope manual/i, /addendum.*correct/i, /symptom.*scoring/i, /skin concern/i, /hope scoring/i],
    tag: "huv_follow_up",
    clinical_action: "Place addendum with correct dates, symptom scoring, wound details",
  },
  {
    category: "Reschedule / Reassign Visit",
    severity: "medium",
    color: "#FFB830",
    bg: "#221A00",
    icon: "🔄",
    bodyKeys: ["reschedule", "reassign", "move pt", "please move", "coverage needed", "on pto"],
    patterns: [/reschedul/i, /reassign/i, /please move.*device/i, /coverage.*pts/i],
    tag: "reschedule_visit",
    clinical_action: "Manager approval required for reschedule, assign coverage",
  },

  // ── MEDICATIONS / ORDERS ─────────────────────────────────────────────────
  {
    category: "Unsigned Orders / CTI / POC",
    severity: "critical",
    color: "#FF3B3B",
    bg: "#2A0808",
    icon: "📝",
    bodyKeys: ["unsigned cti", "unsigned poc", "bill hold", "holding up billing", "orders needed", "unsigned", "cti and poc", "recert order", "unsigned ctis and pocs"],
    patterns: [/unsigned cti/i, /unsigned poc/i, /bill.?hold/i, /orders needed.*asap/i, /cti and poc/i, /recert order/i],
    tag: "order_tracking",
    clinical_action: "Sign CTI/POC immediately — billing blocked until complete",
  },
  {
    category: "Medication Issue",
    severity: "high",
    color: "#E05CFF",
    bg: "#1A0825",
    icon: "💊",
    bodyKeys: ["medication clarification", "medication refill", "running low", "out of medication", "medication management", "prior authorization", "medication question", "script", "declined meds", "declined orders"],
    patterns: [/medicat/i, /running low/i, /out of.*med/i, /prior auth/i, /\bscript\b/i, /declined.*orders/i, /pharmacy.*calling/i],
    tag: "declined_meds",
    clinical_action: "RN to call pharmacy, place orders, confirm with MD",
  },
  {
    category: "Allergy / Medication Update",
    severity: "medium",
    color: "#C084FC",
    bg: "#160820",
    icon: "⚗️",
    bodyKeys: ["add an allergy", "allergy", "lorazepam", "allergy please"],
    patterns: [/allerg/i, /add.*allergy/i],
    tag: "order_tracking",
    clinical_action: "Update allergy record in HCHB",
  },

  // ── DME ──────────────────────────────────────────────────────────────────
  {
    category: "DME — Urgent / Not Ordered",
    severity: "critical",
    color: "#FF6B2B",
    bg: "#2A1008",
    icon: "🛏️",
    bodyKeys: ["dme not ordered", "lost dme", "cannot locate", "dme need", "dme reason", "hospital bed", "bariatric", "wheelchair", "oxygen tank", "shower chair", "electric lift recliner", "broda scoot"],
    patterns: [/lost dme/i, /cannot locate/i, /dme.*need/i, /dme.*reason/i, /bariatric.*bed/i, /oxygen tank/i, /broda scoot/i],
    tag: "dme_not_ordered",
    clinical_action: "Order DME immediately, confirm delivery ETA with patient/family",
  },
  {
    category: "DME — Pickup / Return",
    severity: "medium",
    color: "#FF8C3B",
    bg: "#251508",
    icon: "📦",
    bodyKeys: ["dme pick up", "dme pickup", "picking up", "remove the", "expired last night", "family purchased"],
    patterns: [/dme.*pick.?up/i, /picking up.*dme/i, /remove the.*chair/i, /expired.*dme/i],
    tag: "dme_orderpickup",
    clinical_action: "Coordinate pickup with DME company",
  },

  // ── CLINICAL QUALITY ─────────────────────────────────────────────────────
  {
    category: "Comfort Cares / Active Dying",
    severity: "critical",
    color: "#FF3B3B",
    bg: "#2A0808",
    icon: "🕊️",
    bodyKeys: ["comfort cares", "comfort measures", "on comfort cares", "actively dying"],
    patterns: [/comfort care/i, /actively dying/i, /comfort measure/i],
    tag: "patient_care",
    clinical_action: "Ensure RN visit scheduled, family notified, MD updated",
  },
  {
    category: "Death / Bereavement",
    severity: "high",
    color: "#888888",
    bg: "#111111",
    icon: "🕯️",
    bodyKeys: ["expired last night", "death report", "death visit", "death certification", "passed", "funeral home", "cremation", "final arrangements"],
    patterns: [/\bdeath\b/i, /expired.*night/i, /death report/i, /funeral home/i, /final arrangements/i, /cremation/i],
    tag: "death",
    clinical_action: "Death certification, DME pickup, bereavement follow-up",
  },
  {
    category: "Complaint",
    severity: "high",
    color: "#FF3B3B",
    bg: "#2A0808",
    icon: "📣",
    bodyKeys: ["complaint", "requesting call back regarding", "facility called"],
    patterns: [/\bcomplaint\b/i, /facility complaint/i, /requesting call back regarding/i],
    tag: "complaint",
    clinical_action: "Document complaint, escalate to clinical manager",
  },

  // ── INTAKE / ADMISSIONS ──────────────────────────────────────────────────
  {
    category: "New Referral",
    severity: "info",
    color: "#00D4AA",
    bg: "#001A14",
    icon: "🆕",
    bodyKeys: ["referral", "new referral", "dx end stage", "discharge pending placement", "consult", "family wants consult", "referral source"],
    patterns: [/\breferral\b/i, /new referral/i, /dx.*end stage/i, /discharge.*placement/i, /family wants consult/i],
    tag: "referral_intake",
    clinical_action: "HCC follow-up, schedule informational visit",
  },
  {
    category: "Pre-Registration / Admit",
    severity: "medium",
    color: "#3BAAFF",
    bg: "#081525",
    icon: "📄",
    bodyKeys: ["pre-reg", "preregistration", "prereg", "patient is admitted", "please add nurse as assignee", "enter team members", "care team members needed"],
    patterns: [/pre.?reg/i, /patient is admitted/i, /enter team members/i, /care team.*needed/i],
    tag: "pre-registration",
    clinical_action: "Upload to HCHB, assign RN case manager, enter team members",
  },
  {
    category: "F2F Required",
    severity: "high",
    color: "#FFB830",
    bg: "#221A00",
    icon: "👥",
    bodyKeys: ["f2f required", "f2f needed", "add on f2f", "schedule a ftf", "face-to-face"],
    patterns: [/f2f required/i, /f2f needed/i, /\bf2f\b/i, /face.to.face/i, /schedule a ftf/i],
    tag: "order_tracking",
    clinical_action: "Schedule F2F visit, confirm in HCHB",
  },

  // ── BILLING / RECORDS ────────────────────────────────────────────────────
  {
    category: "Billing Issue",
    severity: "medium",
    color: "#FFB830",
    bg: "#221A00",
    icon: "💰",
    bodyKeys: ["bill hold", "holding up billing", "billing", "unpaid", "remittance", "claim status", "payment"],
    patterns: [/bill.?hold/i, /holding up billing/i, /\bbilling\b/i, /unpaid.*bill/i, /claim status/i],
    tag: "billing",
    clinical_action: "Clear bill hold, sign outstanding orders",
  },
  {
    category: "Medical Records Request",
    severity: "low",
    color: "#3BAAFF",
    bg: "#081525",
    icon: "📁",
    bodyKeys: ["request to update records", "update records", "funeral home", "medical record", "polst"],
    patterns: [/update.*records/i, /medical record/i, /\bpolst\b/i],
    tag: "medical_records",
    clinical_action: "Process within 24 hours",
  },

  // ── CALLBACK / PHONE ─────────────────────────────────────────────────────
  {
    category: "Call Back Request",
    severity: "medium",
    color: "#3BAAFF",
    bg: "#081525",
    icon: "📞",
    bodyKeys: ["call back", "requesting call back", "please call back", "call back asap", "return call", "call me back", "callback"],
    patterns: [/call.?back.*asap/i, /requesting.*call.?back/i, /please call.*back/i, /return call/i],
    tag: "call_back",
    clinical_action: "Return call within 30 minutes",
  },
  {
    category: "Nurse Visit Request",
    severity: "high",
    color: "#FF8C3B",
    bg: "#251508",
    icon: "🏥",
    bodyKeys: ["nurse request", "call for the nurse", "rn requested", "rn88", "visit request", "call transferred to rn", "requesting to speak to a nurse", "requesting nurse visit"],
    patterns: [/nurse request/i, /call for the nurse/i, /transferred to.*rn/i, /speak.*nurse/i, /requesting nurse/i, /\brn88\b/i],
    tag: "patient_care",
    clinical_action: "Transfer to RN case manager, document in HCHB",
  },

  // ── HR / IT ──────────────────────────────────────────────────────────────
  {
    category: "New Hire / Onboarding",
    severity: "info",
    color: "#00D4AA",
    bg: "#001A14",
    icon: "👤",
    bodyKeys: ["new hire", "onboard", "offboard", "no show offboard", "termination", "resignation"],
    patterns: [/new hire/i, /onboard/i, /offboard/i, /termination/i, /resignation/i],
    tag: "new_hire_request",
    clinical_action: "Process in Workbright, set up HCHB access",
  },
  {
    category: "IT Issue",
    severity: "low",
    color: "#2A4A5A",
    bg: "#08141A",
    icon: "💻",
    bodyKeys: ["contacts not syncing", "pointcare", "voice to text", "nvoq", "tablet", "software", "not syncing", "fleet car"],
    patterns: [/not syncing/i, /pointcare/i, /voice to text/i, /\bnvoq\b/i, /fleet car/i],
    tag: "helpdesk",
    clinical_action: "Submit IT helpdesk ticket",
  },

  // ── AUTO-GENERATED (low noise) ────────────────────────────────────────────
  {
    category: "Fax / Auto-Email",
    severity: "low",
    color: "#1A3A4A",
    bg: "#06101A",
    icon: "📠",
    bodyKeys: ["new fax message", "fax message", "ringcentral", "warning: this email originated"],
    patterns: [/new fax message/i, /ringcentral/i, /warning.*outside.*organization/i],
    tag: "efax",
    clinical_action: "Route to appropriate team",
  },
  {
    category: "Dialpad Call",
    severity: "low",
    color: "#1A3A4A",
    bg: "#06101A",
    icon: "📱",
    bodyKeys: ["dialpad call with", "direction: inbound", "direction: outbound", "active call"],
    patterns: [/dialpad call with/i, /direction: inbound/i, /direction: outbound/i],
    tag: "dialpad_call",
    clinical_action: "Review Dialpad AI recap for action items",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH MAP
// ─────────────────────────────────────────────────────────────────────────────
const BRANCH = {
  eau_claire: "Eau Claire", duluth: "Duluth",
  "firekeepers_-_wi": "GRB Firekeepers", firekeepers___wi: "GRB Firekeepers",
  "lightkeepers_-_wi": "GRB Light", lightkeepers___wi: "GRB Light",
  "mountain_movers_-_wi": "GRB Mountain", mountain_movers___wi: "GRB Mountain",
  milwaukee: "Milwaukee", sheboygan__wi: "Sheboygan", rochester: "Rochester",
  miami_fl_leon: "MIA Leon N", miami_fl_leon_south: "MIA Leon S",
  chicago_s: "Chicago S", springfield_il: "Springfield IL",
  la_crosse: "La Crosse", stevens_point: "Stevens Point",
  hiawatha__ia: "Hiawatha IA", hudson: "Hudson WI",
  st_cloud_mn_blue_team: "St Cloud Blue", st_cloud: "St Cloud",
  golden_valley: "Golden Valley", golden_valley_mn_purple: "GV Purple",
  madison: "Madison", mankato: "Mankato", brainerd: "Brainerd",
  rhinelander_wi: "Rhinelander", alexandria: "Alexandria",
  fort_wayne__in: "Fort Wayne IN",
};

function getBranch(tags = "") {
  for (const part of tags.split(",")) {
    const k = part.trim();
    if (BRANCH[k]) return BRANCH[k];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFY — scans ALL text fields
// ─────────────────────────────────────────────────────────────────────────────
function classifyTicket(t) {
  const fullText = [
    t.Subject, t.Tags, t.Description, t["Message Details"],
    t["Dialpad Ai Recap"], t["Dialpad Ai Call Purpose"], t["Dialpad Ai Action Items"],
    t["On Call - Action's Taken"], t["Was Patient Injured?"],
  ].filter(Boolean).join(" ");

  const matches = [];
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(fullText))) {
      matches.push(rule);
    }
  }
  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAME EXTRACTION from subject (multiple formats)
// ─────────────────────────────────────────────────────────────────────────────
function extractName(subject = "") {
  if (!subject) return null;
  const s = subject.trim();

  // "D. Perry // call back // EAU"
  const m1 = s.match(/^([A-Z][a-z]?\.\s+[A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)?)\s*\/\//);
  if (m1) return m1[1].trim();

  // "FIREKPRS- M. STADLER- FALL"
  const m2 = s.match(/^[A-Z]{2,8}[-\s]+([A-Z][a-z]?\.\s+[A-Z][A-Z\-']+)\s*-/);
  if (m2) return m2[1].trim();

  // "EAU Harold Olson HUV"
  const m3 = s.match(/^[A-Z]{2,4}\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  if (m3) return m3[1].trim();

  // "BETTY J LANGE // firekeepers"
  const m4 = s.match(/^([A-Z][A-Z\s]+[A-Z])\s*\/\//);
  if (m4 && m4[1].trim().split(" ").length >= 2) return m4[1].trim();

  // "GRB Craig Patterson HUV"
  const m5 = s.match(/^[A-Z]{2,4}\s+([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(HUV|FALL|DME)/i);
  if (m5) return m5[1].trim();

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO DATA (real tickets from March 10 2026, status: open/pending/new/hold)
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_TICKETS = [
  { Id: 776433, Subject: "Unverified Visits - Please address!", Tags: "daily_audit_for_unverified_visit,sheboygan__wi,no_response_start", Status: "pending", Description: "The visits below are unverified. NOT ON YOUR DEVICE but are floating around the system. Please address: complete documentation, complete as missed visit, or have leadership void.", CreatedAt: "2026-03-10T17:06:51Z", "Dialpad - Called from": null },
  { Id: 776428, Subject: "ATW Marietta Noceda HUV", Tags: "firekeepers_-_wi,huv_follow_up,qa_bump_start", Status: "pending", Description: "We reviewed the HUV visit for this patient and need clarification. Skin: you marked no for skin concerns however per ICC charting there is/are skin concerns. In an addendum please add in the current wounds and all treatments.", CreatedAt: "2026-03-10T17:01:01Z", "Dialpad - Called from": null },
  { Id: 776431, Subject: "K.P. oxygen tanks", Tags: "appleton,central_support,dme", Status: "new", Description: "I need 6 large oxygen tanks delivered for Kay Petersen at Silverstone assisted living. Room 27.", CreatedAt: "2026-03-10T17:06:22Z", "Dialpad - Called from": null },
  { Id: 776413, Subject: "Mittie Davidson", Tags: "chicago_s,dme,dme_orderpickup", Status: "hold", Description: "Can you follow up with integra about picking up Mittie Davidson's DME she expired last night and facility is looking for the dme to be picked up asap.", "Message Details": "Patient expired last night. Facility needs DME picked up asap.", CreatedAt: "2026-03-10T16:52:16Z", "Dialpad - Called from": null },
  { Id: 776427, Subject: "Move pt", Tags: "brainerd,scheduling,move", Status: "new", Description: "Please move Arnold Johnson to my device from tomorrow to today.", CreatedAt: "2026-03-10T17:00:50Z", "Dialpad - Called from": null },
  { Id: 776404, Subject: "M.S. broda scoot", Tags: "appleton,dme,firekeepers_-_wi", Status: "hold", Description: "Can I order a broda scoot for Marilyn Stadler at Silverstone assisted living for increased weakness. Room #19.", "Message Details": "Order a broda scoot for Marilyn Stadler, increased weakness.", CreatedAt: "2026-03-10T16:48:07Z", "Dialpad - Called from": null },
  { Id: 776403, Subject: "BETTY J LANGE // firekeepers_-_wi -- Enter Team Members", Tags: "firekeepers_-_wi,team_members_update,no_response_start", Status: "pending", Description: "Patient is admitted. Work with the local teams to enter in full team member list into HCHB case manager section.", CreatedAt: "2026-03-10T16:47:36Z", "Dialpad - Called from": null },
  { Id: 776402, Subject: "reschedule", Tags: "reschedule_visit,sheboygan__wi", Status: "pending", Description: "I received your request to reschedule visit for Pt sheila reimer from 3/10 to 3/18. Please provide an explanation for the reschedule, or manager approval before sending back to scheduling.", CreatedAt: "2026-03-10T16:47:07Z", "Dialpad - Called from": null },
  { Id: 776401, Subject: "DOYLE WILLIAMS CALL BACK", Tags: "golden_valley", Status: "open", Description: "FACILITY CHARLES 763-971-6300 REQUESTING CALL BACK REGARDING DOYLE WILLIAMS", CreatedAt: "2026-03-10T16:46:09Z", "Dialpad - Called from": null },
  { Id: 776392, Subject: "CAn we add an allergy please", Tags: "central_support,cloud", Status: "new", Description: "Can we add Lorazepam as an allergy to Jerome Theimann please.", CreatedAt: "2026-03-10T16:42:12Z", "Dialpad - Called from": null },
  { Id: 776387, Subject: "Readmit GRB MOUNTAIN MOVERS **F2F REQUIRED 3RD BP** Marilyn Schaetz", Tags: "mountain_movers_-_wi,referral_intake,intake_cc", Status: "pending", Description: "CALL FROM SW LEXI - patient admitted to hospital. They are hoping to discharge her back to the AL by Friday. Patient still current in HCHB.", CreatedAt: "2026-03-10T16:40:05Z", "Dialpad - Called from": null },
  { Id: 776384, Subject: "Re: MIA LEON SOUTH/ KENDALL **F2F REQUIRED 8TH BP** JOSE ALVARADO", Tags: "miami_fl_leon,referral_intake,intake_cc", Status: "open", Description: "Received a call from Sonny at West Kendall Baptist hospital stating patient is currently in the ER. Requesting to speak to a nurse. Please call back ASAP 786-467-8710.", CreatedAt: "2026-03-10T16:38:20Z", "Dialpad - Called from": null },
  { Id: 776381, Subject: "HHA coverage 3/11-3/13", Tags: "brainerd,weekly_schedules", Status: "pending", Description: "Heather is on PTO the rest of the week needing coverage for pts listed above.", CreatedAt: "2026-03-10T16:36:18Z", "Dialpad - Called from": null },
  { Id: 776380, Subject: "PALLIATIVE CARE//CALL BACK", Tags: "moments_hospice_cc,no_response_start", Status: "open", Description: "PALLIATIVE CARE CALL BACK REQUEST", CreatedAt: "2026-03-10T16:35:45Z", "Dialpad - Called from": null },
  { Id: 776374, Subject: "Late Visit - Please address ASAP!", Tags: "_unverified_visit_request,eau_claire,no_response_start", Status: "pending", Description: "Hello Penny Hanson, We noticed that you have the following late visits that need to be completed so that our patients receive the care we have committed to.", CreatedAt: "2026-03-10T16:31:11Z", "Dialpad - Called from": null },
  { Id: 776362, Subject: "Late Visit - Please address ASAP!", Tags: "_unverified_visit_request,eau_claire,no_response_start", Status: "pending", Description: "Hello Tina Adams, We noticed that you have the following late visits that need to be completed.", CreatedAt: "2026-03-10T16:28:01Z", "Dialpad - Called from": null },
  { Id: 776360, Subject: "Late Visit - Please address ASAP!", Tags: "_unverified_visit_request,duluth,no_response_start", Status: "pending", Description: "Hello Courtney Cuff, We noticed that you have the following late visits that need to be completed.", CreatedAt: "2026-03-10T16:26:32Z", "Dialpad - Called from": null },
  { Id: 776356, Subject: "Late Visit - Please address ASAP!", Tags: "_unverified_visit_request,duluth,no_response_start", Status: "pending", Description: "Hello Brook Payne, We noticed that you have the following late visits that need to be completed.", CreatedAt: "2026-03-10T16:22:36Z", "Dialpad - Called from": null },
  { Id: 776366, Subject: "FIREKPRS- M. STADLER- FALL", Tags: "firekeepers_-_wi,occurrence_clarification,qa_bump_end", Status: "open", Description: "Patient: M. STADLER. A fall report was entered. physician orders for injury, ICC tracking, Update MD's (Medical director and PCP), Update Family, New interventions required.", CreatedAt: "2026-03-10T16:28:55Z", "Dialpad - Called from": null },
  { Id: 776363, Subject: "FIREKPRS- M. STADLER- FALL", Tags: "firekeepers_-_wi,occurrence_clarification,qa_bump_start", Status: "pending", Description: "Please follow up at a branch level with reporting to State agencies as needed, review of charting and updates per moments processes. fall with injury.", CreatedAt: "2026-03-10T16:28:01Z", "Dialpad - Called from": null },
  { Id: 776188, Subject: "BRD- M. MARTINEZ- FALL", Tags: "brainerd,occurrence_clarification,qa_bump_start", Status: "open", Description: "A fall report was entered. physician orders for injury, ICC tracking. fall with injury. Update MD's, family, new interventions.", CreatedAt: "2026-03-10T15:18:05Z", "Dialpad - Called from": null },
  { Id: 776349, Subject: "MKE- S. ZEMBRZUSKI- FALL", Tags: "milwaukee,occurrence_clarification,qa_bump_start", Status: "pending", Description: "A fall report was entered. fall with injury. physician orders for injury, ICC tracking, Update MD's, family, new interventions.", CreatedAt: "2026-03-10T16:19:56Z", "Dialpad - Called from": null },
  { Id: 776348, Subject: "MKE- S. ZEMBRZUSKI- FALL", Tags: "milwaukee,occurrence_clarification,qa_bump_start", Status: "pending", Description: "Please follow up at branch level. fall with injury.", CreatedAt: "2026-03-10T16:19:19Z", "Dialpad - Called from": null },
  { Id: 776345, Subject: "MKE- K. MACAULAY- FALL", Tags: "milwaukee,occurrence_clarification,qa_bump_start", Status: "pending", Description: "A fall report was entered. Update MD's, family, new interventions.", CreatedAt: "2026-03-10T16:17:41Z", "Dialpad - Called from": null },
  { Id: 776354, Subject: "HUD- D. OLIVER- FALL", Tags: "hudson,occurrence_clarification,qa_bump_start", Status: "pending", Description: "fall with injury. Please follow up at branch level, report to State agencies.", CreatedAt: "2026-03-10T16:21:45Z", "Dialpad - Called from": null },
  { Id: 776338, Subject: "BRD- R. CHRISTOPHERS- FALL", Tags: "brainerd,occurrence_clarification,qa_bump_start", Status: "pending", Description: "We reviewed charting and noted there is not a fall coordination note type entered. please fill out this template.", CreatedAt: "2026-03-10T16:15:01Z", "Dialpad - Called from": null },
  { Id: 776293, Subject: "sbm- s. mcintosh- fall", Tags: "sheboygan__wi,occurrence_clarification,qa_bump_start", Status: "pending", Description: "A fall report was entered. physician orders for injury, ICC tracking, Update MD's, family.", CreatedAt: "2026-03-10T15:58:07Z", "Dialpad - Called from": null },
  { Id: 776290, Subject: "sbm- s. mcintosh- fall", Tags: "sheboygan__wi,occurrence_clarification,qa_bump_start", Status: "pending", Description: "fall with injury. Please follow up at branch level.", CreatedAt: "2026-03-10T15:56:52Z", "Dialpad - Called from": null },
  { Id: 776322, Subject: "AXN- D. HAGEL- FALL", Tags: "alexandria,occurrence_clarification,qa_bump_end", Status: "open", Description: "fall with injury. Please follow up at branch level.", CreatedAt: "2026-03-10T16:09:39Z", "Dialpad - Called from": null },
  { Id: 776318, Subject: "EAU- M. OBRIEN- OTHER QI REPORT", Tags: "eau_claire,occurrence_clarification,qa_bump_start", Status: "pending", Description: "FACILITY CALLED TO STATE PATIENT HAD SEIZURE LIKE ACTIVITY. THEY CALLED 911 BEFORE CALLING HOSPICE. RN VISIT NOTED PATIENT BACK TO BASELINE.", CreatedAt: "2026-03-10T16:08:00Z", "Dialpad - Called from": null },
  { Id: 776369, Subject: "LOST DME", Tags: "dme,st_cloud_mn_blue_team,dme_not_ordered,no_response_start", Status: "pending", Description: "We had a pick up order for Genevieve Sand at Edenbrook St. Cloud and the staff could not locate a Tilt shower chair. Please assist us in locating this shower chair.", "Message Details": "DME cannot be located. Tilt shower chair missing.", CreatedAt: "2026-03-10T16:30:01Z", "Dialpad - Called from": null },
  { Id: 776346, Subject: "DME", Tags: "dme,mankato,dme_not_ordered,no_response_start", Status: "pending", Description: "Bruce Howard - DOB 4/25/1950. DME NEED: Bariatric Hospital Bed. DME REASON: Patient's current regular size hospital bed not big enough.", "Message Details": "Bariatric Hospital Bed needed for Bruce Howard.", CreatedAt: "2026-03-10T16:18:57Z", "Dialpad - Called from": null },
  { Id: 776311, Subject: "dme", Tags: "eau_claire,dme", Status: "pending", Description: "ARBADELLA A NANDORY. Please order: Hospital bed, Tripod lift bar, Bed side table. PLEASE CALL HEIDI with eta.", CreatedAt: "2026-03-10T16:06:51Z", "Dialpad - Called from": null },
  { Id: 776286, Subject: "J.S", Tags: "firekeepers_-_wi,dme,patient", Status: "pending", Description: "JAMES F STEARLE. Patient would like electric lift recliner.", CreatedAt: "2026-03-10T16:39:59Z", "Dialpad - Called from": null },
  { Id: 776333, Subject: "Re: Unsigned CTIs and POCs", Tags: "alexandria,order_tracking,no_response_start", Status: "open", Description: "Please see the below CTI and POC bill holds. These are outstanding for a while. Unsigned CTIs and POCs from November, December, January still outstanding. bill hold blocking billing.", CreatedAt: "2026-03-10T16:12:54Z", "Dialpad - Called from": null },
  { Id: 776316, Subject: "ATW and GRB Unverified Visits- Orders Needed ASAP", Tags: "daily_audit_for_unverified_visit,firekeepers_-_wi,no_response_start", Status: "pending", Description: "The following visits are holding up billing and needs orders to remove.", CreatedAt: "2026-03-10T16:07:26Z", "Dialpad - Called from": null },
  { Id: 776314, Subject: "GRB Unverified Visits- Orders Needed ASAP", Tags: "daily_audit_for_unverified_visit,lightkeepers_-_wi,no_response_start", Status: "pending", Description: "The following visits are holding up billing and needs orders to remove.", CreatedAt: "2026-03-10T16:07:18Z", "Dialpad - Called from": null },
  { Id: 776313, Subject: "GRB Unverified Visits- Orders Needed ASAP", Tags: "daily_audit_for_unverified_visit,lightkeepers_-_wi,no_response_start", Status: "pending", Description: "The following visits are holding up billing and needs orders to remove.", CreatedAt: "2026-03-10T16:07:11Z", "Dialpad - Called from": null },
  { Id: 776151, Subject: "LSE Late/Incomplete Visit", Tags: "la_crosse,daily_audit_for_unverified_visit,no_response_start", Status: "open", Description: "Late/incomplete visit. Needs to be addressed immediately.", CreatedAt: "2026-03-10T14:52:08Z", "Dialpad - Called from": null },
  { Id: 776153, Subject: "Medication Orders Needing Approval", Tags: "st_cloud,qa,no_response_start", Status: "open", Description: "Medication orders needing approval. Please review and sign.", CreatedAt: "2026-03-10T14:52:14Z", "Dialpad - Called from": null },
  { Id: 776296, Subject: "RHI Gale Rachuy HUV", Tags: "rhinelander_wi,huv_follow_up,qa_bump_start", Status: "open", Description: "Medication start dates: you indicated start/continue dates are today however not consistent with record review. please place an addendum with the correct order date.", CreatedAt: "2026-03-10T16:00:04Z", "Dialpad - Called from": null },
  { Id: 776270, Subject: "DLH Gale Rachuy HUV", Tags: "duluth,huv_follow_up,qa_bump_start", Status: "pending", Description: "Medication start dates inconsistent. please place an addendum with correct order date.", CreatedAt: "2026-03-10T15:44:14Z", "Dialpad - Called from": null },
  { Id: 776364, Subject: "EAU Harold Olson HUV", Tags: "eau_claire,huv_follow_up,qa_bump_end", Status: "open", Description: "Medication start dates incorrect. Symptom scoring missing: Pain, SOB, Anxiety, nausea, constipation, agitation. Please add addendum.", CreatedAt: "2026-03-10T16:28:16Z", "Dialpad - Called from": null },
  { Id: 776352, Subject: "GRB Craig Patterson HUV", Tags: "firekeepers_-_wi,huv_follow_up,qa_bump_start", Status: "open", Description: "Medication start dates: not consistent with record review. Please place addendum with correct order date.", CreatedAt: "2026-03-10T16:21:10Z", "Dialpad - Called from": null },
  { Id: 776317, Subject: "Declined Visit", Tags: "_declined_visit,golden_valley,no_response_start", Status: "pending", Description: "You sent back a Declined visit, for Gayle Crow, Audrey Mainquist and Elaine Mueller for today. Who should this visit be assigned to?", CreatedAt: "2026-03-10T16:07:55Z", "Dialpad - Called from": null },
  { Id: 776405, Subject: "Declined Visit", Tags: "_declined_visit,miami_fl_leon,no_response_start", Status: "pending", Description: "You sent back a Declined visit, for BARBARA ROIG HERNANDEZ on 2026-03-10. Who should this visit be assigned to?", CreatedAt: "2026-03-10T16:48:46Z", "Dialpad - Called from": null },
  { Id: 776334, Subject: "Dialpad call with Morton Ltc, Transferred / 3 min", Tags: "dialpad_call,firekeepers_-_wi,patient_care,no_response_start", Status: "pending", Description: "Dialpad call with Morton Ltc. Direction: inbound. Phone: +19208862908", "Message Details": "Pharmacy calling for medication clarification please call back asap", "Dialpad Ai Recap": "Shannon receives call from Morton of Martin Pharmacy regarding medication C. Code. Nurse unavailable. Callback number provided.", "Dialpad Ai Call Purpose": "Callback", "Dialpad - Called from": "+19208862908", "Dialpad Ai Action Items": "Shannon to send message to nurse to call Morton back.", CreatedAt: "2026-03-10T16:13:16Z" },
  { Id: 776415, Subject: "Dialpad call with Jessica Hagman, Outbound / 1 min", Tags: "dialpad_call,patient_care", Status: "open", Description: "Dialpad call outbound. Phone: +17153889245", "Dialpad Ai Recap": "Summaries are currently not generated for short calls.", "Dialpad - Called from": "+17153889245", CreatedAt: "2026-03-10T16:53:10Z" },
  { Id: 776421, Subject: "Dialpad call with (319) 893-2387, Active call", Tags: "dialpad_call", Status: "open", Description: "Direction: inbound. Phone: +13198932387", "Dialpad - Called from": "+13198932387", CreatedAt: "2026-03-10T16:58:37Z" },
  { Id: 776416, Subject: "MKM REFERRAL JAMES PETERSON MAYO MANKATO D/C PENDING PLACEMENT", Tags: "mankato,referral_intake,intake_cc", Status: "pending", Description: "Patient is on comfort cares here at the hospital. The Beacon in Mapleton will be assessing today for placement. Family would like Moments to follow.", CreatedAt: "2026-03-10T16:53:43Z", "Dialpad - Called from": null },
  { Id: 776408, Subject: "MSP PURPLE REFERRAL: MICHAEL SIMON, TERRACE OF CRYSTAL", Tags: "golden_valley_mn_purple,referral_intake,intake_cc", Status: "open", Description: "FAMILY WANTS CONSULT. DX END STAGE PARKINSON'S. Patient: MICHAEL SIMON. SNF: TERRACE OF CRYSTAL. Referral Contact: CHARLES 763-971-6300.", CreatedAt: "2026-03-10T16:50:12Z", "Dialpad - Called from": null },
  { Id: 776253, Subject: "STE REFERRAL WINIFRED KAISER CAREVIEW TRANSITIONAL", Tags: "referral_intake,stevens_point", Status: "pending", Description: "New referral - Winifred Kaiser. Careview Transitional Care.", CreatedAt: "2026-03-10T15:39:30Z", "Dialpad - Called from": null },
  { Id: 776435, Subject: "Final arrangements", Tags: "chicago_s,medical_records,patient", Status: "new", Description: "Please add the following arrangements into patient records. MAURO MARTINEZ. Blake Lamb Funeral Home 708-636-1193.", CreatedAt: "2026-03-10T17:07:20Z", "Dialpad - Called from": null },
  { Id: 776418, Subject: "Workflow task question", Tags: "golden_valley,intake,qa_rn", Status: "open", Description: "I am attempting to schedule a FTF visit for Martinez, Doxie and nothing is coming up. Can you please let me know if there are tasks outstanding with either Intake?", CreatedAt: "2026-03-10T16:56:14Z", "Dialpad - Called from": null },
  { Id: 776283, Subject: "RHI Referral- Ronald Prince- Aspirus Rhinelander hospital", Tags: "rhinelander_wi,referral_intake,new_referral_being_worked_on", Status: "open", Description: "New referral fax received from Aspirus Rhinelander hospital. Ronald Prince.", CreatedAt: "2026-03-10T15:52:53Z", "Dialpad - Called from": null },
  { Id: 776275, Subject: "MKM: J. Koller Infection Report", Tags: "mankato,infection_report_clarification,qa_bump_start", Status: "pending", Description: "Infection report filed. J. Koller needs clarification on infection report.", CreatedAt: "2026-03-10T15:47:02Z", "Dialpad - Called from": null },
  { Id: 776255, Subject: "Today's Visit", Tags: "miami_fl_leon,scheduling,no_response_start", Status: "open", Description: "Visit scheduling issue. No response from clinician.", CreatedAt: "2026-03-10T15:40:22Z", "Dialpad - Called from": null },
];

// ─────────────────────────────────────────────────────────────────────────────
// LIVE FETCH  (Anthropic API + CData MCP)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchLiveTickets() {
  const sql = `
    SELECT [Id],[Subject],[Tags],[Status],[Description],[Message Details],
           [On Call - Action's Taken],[Dialpad Ai Recap],[Dialpad Ai Call Purpose],
           [Dialpad - Called from],[Dialpad Ai Action Items],[Was Patient Injured?],[CreatedAt]
    FROM [Zendesk1].[Zendesk].[Tickets]
    WHERE [Status] IN ('new','open','pending','hold')
    ORDER BY [CreatedAt] DESC
    LIMIT 200`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `You are a data retrieval assistant. Execute this SQL against the CData Zendesk connection and return ONLY a valid JSON array. No markdown, no explanation, no code fences. Each row as an object with keys matching column names.
SQL: ${sql}`,
      messages: [{ role: "user", content: "Execute the SQL and return JSON array now." }],
      mcp_servers: [{ type: "url", url: "https://mcp.cloud.cdata.com/mcp", name: "cdata" }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).find((b) => b.type === "text")?.text || "[]";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEVERITY ORDER
// ─────────────────────────────────────────────────────────────────────────────
const SEV_ORDER = { critical: 0, high: 1, medium: 2, info: 3, low: 4 };

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ZendeskScanner() {
  const [tickets, setTickets] = useState(DEMO_TICKETS);
  const [loading, setLoading] = useState(false);
  const [liveError, setLiveError] = useState(null);
  const [view, setView] = useState("clusters"); // clusters | repeats | dialpad | feed
  const [selectedCat, setSelectedCat] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [hideNoise, setHideNoise] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLiveError(null);
    try {
      const live = await fetchLiveTickets();
      if (Array.isArray(live) && live.length > 5) {
        setTickets(live);
        setLiveError(null);
      } else {
        setLiveError("Live query returned no data — showing last snapshot");
      }
    } catch (e) {
      setLiveError(`Live query error: ${e.message} — showing snapshot`);
    }
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  // ── CLUSTERS ─────────────────────────────────────────────────────────────
  const clusters = (() => {
    const map = {};
    for (const rule of KEYWORD_RULES) {
      if (hideNoise && rule.severity === "low") continue;
      map[rule.category] = { ...rule, tickets: [], names: new Set(), branches: new Set() };
    }
    for (const t of tickets) {
      const matches = classifyTicket(t);
      for (const rule of matches) {
        if (!map[rule.category]) continue;
        map[rule.category].tickets.push(t);
        const name = extractName(t.Subject);
        if (name) map[rule.category].names.add(name);
        const branch = getBranch(t.Tags);
        if (branch) map[rule.category].branches.add(branch);
      }
    }
    return Object.values(map)
      .map((c) => ({ ...c, names: [...c.names], branches: [...c.branches] }))
      .filter((c) => c.tickets.length > 0)
      .sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (b.tickets.length - a.tickets.length));
  })();

  // ── REPEAT PATTERNS (name + subject clustering) ───────────────────────────
  const repeats = (() => {
    const nameMap = {};
    const subjectMap = {};
    for (const t of tickets) {
      const name = extractName(t.Subject);
      if (name) {
        const key = name.toUpperCase().replace(/\s+/g, " ").trim();
        if (!nameMap[key]) nameMap[key] = [];
        nameMap[key].push(t);
      }
      const normSub = (t.Subject || "").replace(/re:\s*/i, "").trim().toLowerCase().slice(0, 70);
      if (normSub.length > 10 && !/dialpad call/i.test(normSub) && !/new fax/i.test(normSub)) {
        if (!subjectMap[normSub]) subjectMap[normSub] = [];
        subjectMap[normSub].push(t);
      }
    }
    const results = [];
    for (const [key, tix] of Object.entries(nameMap)) {
      if (tix.length < 2) continue;
      const branches = [...new Set(tix.map((t) => getBranch(t.Tags)).filter(Boolean))];
      const cats = [...new Set(tix.flatMap((t) => classifyTicket(t).map((r) => r.category)))];
      const isCritical = cats.some((c) => /fall|safety|late|unsigned|comfort/i.test(c));
      results.push({ type: "name", key, count: tix.length, tickets: tix, branches, cats, severity: isCritical ? "critical" : "high" });
    }
    for (const [sub, tix] of Object.entries(subjectMap)) {
      if (tix.length < 3) continue;
      const alreadyInNames = results.find((r) => r.type === "name" && tix.some((t) => extractName(t.Subject)?.toUpperCase() === r.key));
      if (alreadyInNames) continue;
      const branches = [...new Set(tix.map((t) => getBranch(t.Tags)).filter(Boolean))];
      const cats = [...new Set(tix.flatMap((t) => classifyTicket(t).map((r) => r.category)))];
      results.push({ type: "subject", key: sub, count: tix.length, tickets: tix, branches, cats, severity: "high" });
    }
    return results.sort((a, b) => b.count - a.count);
  })();

  // ── DIALPAD REPEAT CALLERS ────────────────────────────────────────────────
  const dialpadRepeats = (() => {
    const phoneMap = {};
    for (const t of tickets) {
      const phone = t["Dialpad - Called from"];
      if (!phone || phone.trim() === "") continue;
      const key = phone.trim();
      if (!phoneMap[key]) phoneMap[key] = [];
      phoneMap[key].push(t);
    }
    return Object.entries(phoneMap)
      .filter(([, tix]) => tix.length >= 2)
      .map(([phone, tix]) => ({
        phone,
        count: tix.length,
        tickets: tix,
        subjects: tix.map((t) => t.Subject || "").filter(Boolean),
        branches: [...new Set(tix.map((t) => getBranch(t.Tags)).filter(Boolean))],
        recaps: tix.map((t) => t["Dialpad Ai Recap"]).filter(Boolean),
        purposes: [...new Set(tix.map((t) => t["Dialpad Ai Call Purpose"]).filter(Boolean))],
        actionItems: tix.map((t) => t["Dialpad Ai Action Items"]).filter(Boolean),
      }))
      .sort((a, b) => b.count - a.count);
  })();

  // ── FILTERED FEED ─────────────────────────────────────────────────────────
  const filteredTickets = tickets.filter((t) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return [t.Subject, t.Tags, t.Description, t["Message Details"], t["Dialpad Ai Recap"]]
      .filter(Boolean).some((f) => f.toLowerCase().includes(q));
  });

  // ── COLORS ────────────────────────────────────────────────────────────────
  const sc = { critical: "#FF3B3B", high: "#FF8C3B", medium: "#FFB830", info: "#00D4AA", low: "#2A4A5A" };

  return (
    <div style={{ minHeight: "100vh", background: "#060C18", fontFamily: "'IBM Plex Mono',monospace", color: "#C8D8E8" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Sora:wght@600;700&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-thumb{background:#1a3050;border-radius:2px}
        .card{background:rgba(8,14,28,.9);border:1px solid rgba(255,255,255,.06);border-radius:9px;transition:border-color .2s}
        .card:hover{border-color:rgba(0,200,160,.18)}
        .tabBtn{background:none;border:none;cursor:pointer;padding:7px 14px;border-radius:6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;transition:all .2s;font-family:'IBM Plex Mono',monospace}
        .clusterRow{cursor:pointer;border-left:3px solid transparent;transition:all .18s;padding:10px 14px;border-radius:0}
        .clusterRow:hover{background:rgba(255,255,255,.03)!important}
        .noiseToggle{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:5px;color:#7ABBC8;padding:5px 10px;font-size:10px;cursor:pointer;font-family:'IBM Plex Mono',monospace}
        input{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;color:#C8D8E8;padding:8px 12px;font-family:'IBM Plex Mono',monospace;font-size:11px;outline:none;width:100%}
        input:focus{border-color:rgba(0,200,160,.4)}
        input::placeholder{color:#2A4A5A}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background: "rgba(6,12,24,.97)", borderBottom: "1px solid rgba(0,200,160,.14)", padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: "linear-gradient(135deg,#FF6B2B,#FF3B3B)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⌖</div>
          <div>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 12, color: "#F0E0D8", letterSpacing: ".06em" }}>ZENDESK KEYWORD SCANNER</div>
            <div style={{ fontSize: 9, color: "#3A4A5A", letterSpacing: ".15em", textTransform: "uppercase" }}>
              {tickets.length} tickets · {clusters.length} clusters · {repeats.length} repeats · {dialpadRepeats.length} repeat callers
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 2 }}>
          {[["clusters", "Issue Clusters"], ["repeats", "Repeat Patterns"], ["dialpad", "Repeat Callers"], ["feed", "Ticket Feed"]].map(([id, label]) => (
            <button key={id} className="tabBtn"
              style={{ color: view === id ? "#FF8C3B" : "#3A5A6A", background: view === id ? "rgba(255,140,59,.12)" : "none" }}
              onClick={() => { setView(id); setSelectedCat(null); }}>{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {liveError && <span style={{ fontSize: 9, color: "#FF8C3B", maxWidth: 200 }}>{liveError}</span>}
          {loading && <span style={{ width: 14, height: 14, border: "2px solid rgba(255,140,59,.2)", borderTop: "2px solid #FF8C3B", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />}
          <span style={{ fontSize: 9, color: "#1A3A4A" }}>{lastRefresh.toLocaleTimeString()}</span>
          <button onClick={refresh} disabled={loading} style={{ background: "rgba(255,140,59,.1)", border: "1px solid rgba(255,140,59,.3)", borderRadius: 6, color: "#FF8C3B", fontSize: 10, padding: "6px 12px", cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace" }}>↻ Scan Live</button>
        </div>
      </div>

      {/* ── CLUSTERS VIEW ── */}
      {view === "clusters" && (
        <div style={{ display: "grid", gridTemplateColumns: selectedCat ? "320px 1fr" : "1fr", height: "calc(100vh - 52px)", overflow: "hidden" }}>

          {/* Cluster list */}
          <div style={{ overflowY: "auto", borderRight: "1px solid rgba(255,255,255,.05)", padding: "10px 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 6px 8px" }}>
              <span style={{ fontSize: 9, color: "#3A5A6A", letterSpacing: ".1em", textTransform: "uppercase" }}>{clusters.length} active clusters</span>
              <button className="noiseToggle" onClick={() => setHideNoise(!hideNoise)}>
                {hideNoise ? "Show All" : "Hide Low-Signal"}
              </button>
            </div>
            {clusters.map((c, i) => (
              <div key={c.category} className="clusterRow"
                style={{ marginBottom: 3, background: selectedCat?.category === c.category ? `${c.bg}CC` : "transparent", borderLeftColor: selectedCat?.category === c.category ? c.color : "transparent", animation: `slideIn .25s ease ${i * .025}s both` }}
                onClick={() => setSelectedCat(selectedCat?.category === c.category ? null : c)}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 13 }}>{c.icon}</span>
                    <span style={{ fontSize: 11, color: c.color, fontWeight: 600 }}>{c.category}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: c.color, fontFamily: "'Sora',sans-serif", lineHeight: 1 }}>{c.tickets.length}</span>
                    <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 8, fontWeight: 700, background: `${c.color}20`, color: c.color, letterSpacing: ".06em" }}>{c.severity.toUpperCase()}</span>
                  </div>
                </div>
                {c.branches.length > 0 && (
                  <div style={{ fontSize: 9, color: "#3A5A6A", marginTop: 3 }}>
                    {c.branches.slice(0, 4).join(" · ")}{c.branches.length > 4 ? ` +${c.branches.length - 4}` : ""}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Cluster detail */}
          {selectedCat && (
            <div style={{ overflowY: "auto", padding: "14px 16px" }}>
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>{selectedCat.icon}</span>
                <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 16, color: selectedCat.color }}>{selectedCat.category}</span>
                <span style={{ fontSize: 11, color: "#4A6A7A" }}>{selectedCat.tickets.length} tickets</span>
              </div>

              {selectedCat.clinical_action && (
                <div style={{ padding: "8px 12px", borderRadius: 7, marginBottom: 10, background: `${selectedCat.color}10`, border: `1px solid ${selectedCat.color}28` }}>
                  <div style={{ fontSize: 9, color: selectedCat.color, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>Required Action</div>
                  <div style={{ fontSize: 11, color: "#D0E0EC" }}>{selectedCat.clinical_action}</div>
                </div>
              )}

              {selectedCat.names.length > 0 && (
                <div style={{ padding: "8px 12px", borderRadius: 7, marginBottom: 10, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)" }}>
                  <div style={{ fontSize: 9, color: "#4A6A7A", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>Patients / Names Identified</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {selectedCat.names.map((n, i) => (
                      <span key={i} style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, background: `${selectedCat.color}18`, color: selectedCat.color, border: `1px solid ${selectedCat.color}28` }}>{n}</span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selectedCat.tickets.map((t, i) => {
                  const branch = getBranch(t.Tags);
                  const name = extractName(t.Subject);
                  const bodySnippet = (t.Description || t["Message Details"] || "").slice(0, 180).replace(/!\[.*?\]\(.*?\)/g, "").replace(/\n+/g, " ").trim();
                  const dialpadRecap = t["Dialpad Ai Recap"] && !/not generated/i.test(t["Dialpad Ai Recap"]) ? t["Dialpad Ai Recap"].slice(0, 200) : null;
                  return (
                    <div key={t.Id} className="card" style={{ padding: "10px 13px", borderLeft: `3px solid ${selectedCat.color}55`, animation: `fadeUp .2s ease ${i * .04}s both` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          {name && <div style={{ fontSize: 10, color: selectedCat.color, fontWeight: 600, marginBottom: 2 }}>👤 {name}</div>}
                          <div style={{ fontSize: 12, color: "#D0E0EC", lineHeight: 1.4, marginBottom: bodySnippet ? 5 : 0 }}>{t.Subject}</div>
                          {bodySnippet && <div style={{ fontSize: 10, color: "#5A7A8A", lineHeight: 1.5 }}>{bodySnippet}{bodySnippet.length >= 180 ? "…" : ""}</div>}
                          {dialpadRecap && (
                            <div style={{ marginTop: 6, padding: "5px 8px", borderRadius: 5, background: "rgba(0,200,160,.06)", border: "1px solid rgba(0,200,160,.15)", fontSize: 10, color: "#6AAAA0" }}>
                              🤖 AI Recap: {dialpadRecap}
                            </div>
                          )}
                          {t["Dialpad Ai Action Items"] && (
                            <div style={{ marginTop: 4, fontSize: 10, color: "#FFB830" }}>⚡ {t["Dialpad Ai Action Items"]}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                          {branch && <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, background: "rgba(0,200,160,.09)", color: "#00C8A0", border: "1px solid rgba(0,200,160,.2)" }}>{branch}</span>}
                          <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, background: t.Status === "pending" ? "rgba(255,140,59,.12)" : t.Status === "new" ? "rgba(255,59,59,.12)" : t.Status === "hold" ? "rgba(200,180,0,.1)" : "rgba(59,170,255,.08)", color: t.Status === "pending" ? "#FF8C3B" : t.Status === "new" ? "#FF3B3B" : t.Status === "hold" ? "#C8B400" : "#3BAAFF" }}>{t.Status}</span>
                          <span style={{ fontSize: 9, color: "#1A3A4A" }}>#{t.Id}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── REPEAT PATTERNS VIEW ── */}
      {view === "repeats" && (
        <div style={{ padding: "14px 18px", overflowY: "auto", height: "calc(100vh - 52px)" }}>
          <div style={{ padding: "8px 12px", borderRadius: 7, marginBottom: 12, background: "rgba(255,59,59,.05)", border: "1px solid rgba(255,59,59,.14)", fontSize: 11, color: "#FFAAAA" }}>
            🔁 <strong>{repeats.length} repeat patterns</strong> detected — same patient name or near-identical subject appearing across multiple open tickets. These indicate escalation failures or system gaps.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {repeats.map((r, i) => (
              <div key={r.key} className="card" style={{ padding: "12px 14px", borderLeft: `3px solid ${r.severity === "critical" ? "#FF3B3B" : "#FF8C3B"}`, animation: `fadeUp .3s ease ${i * .05}s both` }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#4A6A7A", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 2 }}>
                      {r.type === "name" ? "👤 Same Patient / Name" : "🔁 Same Issue Repeating"}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: r.severity === "critical" ? "#FF8A8A" : "#FFB870", fontFamily: "'Sora',sans-serif" }}>{r.key}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: r.severity === "critical" ? "#FF3B3B" : "#FF8C3B", fontFamily: "'Sora',sans-serif", lineHeight: 1 }}>{r.count}</div>
                    <div style={{ fontSize: 9, color: "#4A6A7A" }}>open tickets</div>
                  </div>
                </div>
                {r.branches.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 7 }}>
                    {r.branches.map((b, j) => (
                      <span key={j} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, background: "rgba(0,200,160,.09)", color: "#00C8A0", border: "1px solid rgba(0,200,160,.18)" }}>{b}</span>
                    ))}
                  </div>
                )}
                {r.cats.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {r.cats.slice(0, 3).map((c, j) => {
                      const rule = KEYWORD_RULES.find((kr) => kr.category === c);
                      return <span key={j} style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, background: rule ? `${rule.color}18` : "rgba(255,255,255,.05)", color: rule ? rule.color : "#7ABBC8", border: `1px solid ${rule ? rule.color + "30" : "rgba(255,255,255,.07)"}` }}>{c}</span>;
                    })}
                  </div>
                )}
                <div style={{ borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 7 }}>
                  {r.tickets.slice(0, 3).map((t, j) => (
                    <div key={t.Id} style={{ fontSize: 10, color: "#5A8A9A", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#2A4A5A", flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.Subject}</span>
                      <span style={{ fontSize: 9, color: "#2A4A5A", flexShrink: 0 }}>#{t.Id}</span>
                    </div>
                  ))}
                  {r.tickets.length > 3 && <div style={{ fontSize: 9, color: "#2A4A5A", marginTop: 3 }}>+{r.tickets.length - 3} more tickets</div>}
                </div>
              </div>
            ))}
            {repeats.length === 0 && <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", color: "#3A5A6A", fontSize: 12 }}>No repeat patterns detected in current ticket snapshot.</div>}
          </div>
        </div>
      )}

      {/* ── DIALPAD REPEAT CALLERS VIEW ── */}
      {view === "dialpad" && (
        <div style={{ padding: "14px 18px", overflowY: "auto", height: "calc(100vh - 52px)" }}>
          <div style={{ padding: "8px 12px", borderRadius: 7, marginBottom: 12, background: "rgba(224,92,255,.05)", border: "1px solid rgba(224,92,255,.14)", fontSize: 11, color: "#DDAAFF" }}>
            📱 <strong>{dialpadRepeats.length} repeat callers</strong> detected — same phone number generated multiple open tickets. These may indicate unresolved issues, failed callbacks, or patients/facilities that need priority escalation.
          </div>
          {dialpadRepeats.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#3A5A6A", fontSize: 12 }}>
              No repeat callers detected. Dialpad tickets in current snapshot may not have phone data populated yet.<br />
              <span style={{ fontSize: 10, color: "#2A4A5A" }}>Live data pull will populate this from the "Dialpad - Called from" field.</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dialpadRepeats.map((r, i) => (
              <div key={r.phone} className="card" style={{ padding: "12px 16px", borderLeft: "3px solid #E05CFF", animation: `fadeUp .3s ease ${i * .08}s both` }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#9A4ABB", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 3 }}>📞 Repeat Caller</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#E05CFF", fontFamily: "'Sora',sans-serif" }}>{r.phone}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#E05CFF", fontFamily: "'Sora',sans-serif", lineHeight: 1 }}>{r.count}</div>
                    <div style={{ fontSize: 9, color: "#4A6A7A" }}>calls / tickets</div>
                  </div>
                </div>
                {r.purposes.length > 0 && (
                  <div style={{ fontSize: 10, color: "#C084FC", marginBottom: 6 }}>Call purpose: {r.purposes.join(", ")}</div>
                )}
                {r.branches.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 7 }}>
                    {r.branches.map((b, j) => <span key={j} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, background: "rgba(0,200,160,.09)", color: "#00C8A0", border: "1px solid rgba(0,200,160,.18)" }}>{b}</span>)}
                  </div>
                )}
                {r.recaps.length > 0 && (
                  <div style={{ padding: "7px 10px", borderRadius: 6, background: "rgba(224,92,255,.06)", border: "1px solid rgba(224,92,255,.15)", marginBottom: 8 }}>
                    <div style={{ fontSize: 9, color: "#9A4ABB", letterSpacing: ".08em", marginBottom: 4 }}>AI RECAP</div>
                    <div style={{ fontSize: 10, color: "#C8A8D8" }}>{r.recaps[0].slice(0, 250)}</div>
                  </div>
                )}
                {r.actionItems.length > 0 && (
                  <div style={{ fontSize: 10, color: "#FFB830", marginBottom: 7 }}>⚡ {r.actionItems[0]}</div>
                )}
                <div style={{ borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 7 }}>
                  {r.tickets.map((t, j) => (
                    <div key={t.Id} style={{ fontSize: 10, color: "#5A7A8A", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#2A4A5A", flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.Subject}</span>
                      <span style={{ fontSize: 9, color: "#2A4A5A", flexShrink: 0 }}>{new Date(t.CreatedAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TICKET FEED VIEW ── */}
      {view === "feed" && (
        <div style={{ padding: "14px 18px", overflowY: "auto", height: "calc(100vh - 52px)" }}>
          <div style={{ marginBottom: 10 }}>
            <input placeholder="Search subjects, body text, tags, Dialpad recaps, patient names…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <div style={{ fontSize: 10, color: "#2A4A5A", marginBottom: 10 }}>
            {filteredTickets.length} tickets {searchTerm ? `matching "${searchTerm}"` : "(all open/pending/new/hold)"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {filteredTickets.map((t, i) => {
              const cats = classifyTicket(t);
              const primaryCat = cats[0];
              const name = extractName(t.Subject);
              const branch = getBranch(t.Tags);
              const bodySnippet = (t.Description || t["Message Details"] || "").slice(0, 140).replace(/!\[.*?\]\(.*?\)/g, "").replace(/\n+/g, " ").trim();
              return (
                <div key={t.Id} className="card" style={{ padding: "9px 13px", borderLeft: `3px solid ${primaryCat?.color || "#2A4A5A"}`, animation: i < 30 ? `fadeUp .2s ease ${Math.min(i, 15) * .02}s both` : undefined }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      {name && <span style={{ fontSize: 10, color: primaryCat?.color || "#4A6A7A", fontWeight: 600, marginRight: 8 }}>👤 {name}</span>}
                      <span style={{ fontSize: 12, color: "#D0E0EC" }}>{t.Subject || "(no subject)"}</span>
                      {bodySnippet && bodySnippet.length > 20 && (
                        <div style={{ fontSize: 10, color: "#4A6A7A", marginTop: 4, lineHeight: 1.4 }}>{bodySnippet}{bodySnippet.length >= 140 ? "…" : ""}</div>
                      )}
                      {cats.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                          {cats.slice(0, 4).map((c, j) => (
                            <span key={j} style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, background: `${c.color}16`, color: c.color, border: `1px solid ${c.color}28` }}>{c.icon} {c.category}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                      {branch && <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, background: "rgba(0,200,160,.08)", color: "#00C8A0", border: "1px solid rgba(0,200,160,.16)" }}>{branch}</span>}
                      <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, background: t.Status === "pending" ? "rgba(255,140,59,.12)" : t.Status === "new" ? "rgba(255,59,59,.12)" : t.Status === "hold" ? "rgba(200,180,0,.1)" : "rgba(59,170,255,.08)", color: t.Status === "pending" ? "#FF8C3B" : t.Status === "new" ? "#FF3B3B" : t.Status === "hold" ? "#C8B400" : "#3BAAFF" }}>{t.Status}</span>
                      <span style={{ fontSize: 9, color: "#1A3A4A" }}>#{t.Id}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
