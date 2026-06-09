# Open Grace CFS — Service Map

**Scope:** End-to-end service delivery from referral to quarterly reporting
**Org:** Open Grace LLC · IRC Vendor PJ6208 · Subcode 076
**Last updated:** 2026-06-09

---

## How to read this document

Each flow below traces what happens, who does it, what tool or document is used, and where the handoff or gap is. Pain points are marked **⚠** and automation opportunities are marked **⚡**.

---

## 1. Referral Flow

A referral is the first signal that a family needs CFS services. IRC initiates it; Open Grace responds.

```
IRC Service Coordinator
        │
        │  Referral (phone call or email)
        ▼
Director (J. Kennedy)
        │
        ├─► Receives referral details verbally or via email
        │   ⚠ No structured intake form — details captured in email/notes
        │
        ├─► Reviews current caseload capacity
        │   ⚠ Capacity check is manual — no dashboard view of open slots
        │
        ├─► Accepts or declines referral
        │
        └─► If accepted: sends Welcome Packet to family
            Tool: staff-portal.html → "Quick Send to Families" → Client Welcome Packet
            ⚡ Opportunity: Power Automate trigger on referral acceptance to auto-send packet
```

**Inputs:** IRC verbal/email referral
**Outputs:** Family receives Welcome Packet; Director confirms acceptance with IRC
**Current tool:** Email + staff-portal.html (manual send buttons)
**Gap:** No referral tracking — accepted referrals are not recorded in any system until intake is complete

---

## 2. Intake Flow

Intake converts an accepted referral into an active client record with signed documentation.

```
Family / Guardian
        │
        │  First meeting (in-person or virtual)
        ▼
Family Coordinator
        │
        ├─► Opens client-forms.html (Client Acknowledgment Forms)
        │   Three tabs must be completed in order:
        │   1. Consent to Services & Release of Information
        │   2. Client Rights & Confidentiality
        │   3. Emergency Contact & Authorization
        │
        ├─► Family and staff sign all three forms (touchscreen signature pads)
        │
        ├─► Clicks "Submit All Forms & Send to Family"
        │   ├─► PDF generated via jsPDF (CDN — ⚠ requires internet)
        │   ├─► PDF downloaded to device
        │   ├─► Power Automate flow triggered (if URL configured):
        │   │       → PDF emailed to family
        │   │       → PDF emailed to director (joshua.kennedy@opengrace.org)
        │   │       → Logged to Open Grace Client Logs (SharePoint/OneDrive)
        │   └─► Microsoft Form opens (prefilled) for backup record
        │
        ├─► Director adds client to Client Roster in Excel
        │   (OpenGrace_CFS_System_v4.xlsx — Contact Log or Client Roster tab)
        │   ⚠ Manual step — not triggered by the forms submission
        │
        └─► Director imports updated roster into CFS Staff App
            ⚠ Another manual step — staff must re-import CSV after each roster change
```

**Inputs:** Accepted referral, family present for signing
**Outputs:** Signed PDF packet on file, client in roster, Power Automate log entry
**Current tools:** `client-forms.html`, `OpenGrace_CFS_System_v4.xlsx`, Power Automate
**Gaps:**
- jsPDF is loaded from a CDN — form fails offline (⚠ breaks the offline-first design)
- Roster is maintained separately in Excel and must be manually re-imported into the Staff App after every change
- No referral-to-intake status tracking — no way to see which referrals are pending intake

---

## 3. Status Change Flow

A client's status changes as they move through the service lifecycle.

```
Statuses: Assessment Phase → Active → On Hold → Exited

Assessment Phase
        │
        │  Staff completes up to 12 assessment hours
        │  Logged as "Assessment Session" contact type in CFS Staff App
        │  Dashboard tracks: "Assess. Hours — X of 12 max/yr"
        ▼
Active
        │
        │  IRC issues Purchase of Service (POS) authorization
        │  Director updates status in Excel roster
        │  ⚠ Staff App does not reflect the change until next CSV re-import
        │
        ├─► Service delivery begins (see Staff Task Flow)
        │
        ├─► 90-day clock starts from Service Start Date
        │   Dashboard shows countdown banners:
        │   🟠 Orange: ≤14 days remaining
        │   🔴 Red: expired
        │
        └─► Status change triggers:
            - Director updates Excel
            - Re-import to Staff App
            - ⚠ No notification to assigned Family Coordinator
On Hold
        │  (family request, IRC hold, or capacity issue)
        │  ⚡ Opportunity: flag in-app when a consumer's status changes to On Hold
        ▼
Exited
        │  IRC closes POS
        │  Director marks Exited in roster
        └─► Consumer removed from active caseload
            ⚠ Exit documentation (reason, final session) not currently captured in Staff App
```

**Key compliance rule:** Assessment phase is capped at 12 hours per consumer per year. The Staff App tracks this in the dashboard, but only from data in the current session — if logs were imported from CSV, the count is accurate; if data was lost (session closed without export), the count resets.

---

## 4. Staff Task Flow

The day-to-day work of a Family Coordinator during active service delivery.

```
START OF SERVICE DAY
        │
        ├─► Review dashboard for:
        │   - 90-day warnings (which clients need attention)
        │   - Recent contacts (what was last logged)
        │   - QPR deadline countdown
        │
CLIENT VISIT / CONTACT
        │
        ├─► Conduct visit (in-person, phone, video, community, IDT, etc.)
        │
        ├─► Open CFS Staff App → Log tab
        │
        ├─► Fill in contact log:
        │   Consumer* | Date* | Staff Name* | Contact Type* | Duration
        │   IPP Objectives | Services Provided* | Attendance | Family Present
        │   Session Notes* | Follow-Up? | Next Contact Date | Incident Note
        │
        ├─► Click Save Contact Log
        │   ├─► Validation: all required fields must be filled
        │   │   ⚠ Validation is a generic alert() — no field-level errors (Issue #3)
        │   └─► Record appended to in-memory logs[]
        │
        ├─► If incident occurred:
        │   ├─► Fill Incident Note field
        │   │   ⚠ No mandatory acknowledgment — staff can save and forget (Issue #2)
        │   ├─► Call Director immediately
        │   ├─► Call IRC within 24 hours (verbal SIR)
        │   └─► Submit written SIR within 48 hours (separate IRC process)
        │
END OF SESSION / END OF DAY
        │
        ├─► If using Staff App for the first time today:
        │   Check if CSV was imported — if not, logs go to a fresh empty session
        │   ⚠ No auto-reminder to import before logging
        │
        └─► Export CSV before closing the browser tab
            ⚠ Only safeguard is the beforeunload warning — crash = data loss
            ⚡ Opportunity: auto-prompt to export after every N logs saved
```

**Follow-up tracking:**
Each log entry has a Follow-Up field: `No | Yes - Minor | Yes - Urgent`. There is no dedicated follow-up queue — staff must scan the Records tab and filter manually to find entries with open follow-ups.

⚡ **Automation opportunity:** A "Follow-Up Queue" view on the Dashboard showing all records where `followup !== 'No'` and sorted by urgency and date.

---

## 5. Follow-Up Flow

Follow-ups arise from three sources: planned next-contact dates, urgent issues noted in a session, and outstanding incidents.

```
SOURCE 1: Planned next-contact date
        │
        │  Staff logs a "Next Contact Date" in the contact form
        │  ⚠ This date is stored in the log record but is not surfaced anywhere
        │  ⚠ No calendar integration, no reminder, no queue
        │  ⚡ Opportunity: Dashboard widget listing upcoming next-contact dates by consumer
        │
SOURCE 2: Follow-up flagged in session (Yes - Minor / Yes - Urgent)
        │
        │  Staff sets Follow-Up field when saving a log
        │  ⚠ No dedicated view — must search Records tab manually
        │  ⚡ Opportunity: Follow-Up Queue on Dashboard (see Staff Task Flow)
        │
SOURCE 3: Incident requiring SIR
        │
        │  Staff notes incident in log
        │  ⚠ No acknowledgment, no tracking, no dashboard flag (Issue #2)
        │  ⚡ Opportunity: Incident tracker showing open/confirmed SIRs

All three sources converge at:

Family Coordinator
        │
        ├─► Manually reviews Records tab or personal notes
        ├─► Contacts family / provider / IRC as needed
        └─► Logs a new contact when the follow-up action is taken
            ⚠ No way to link a follow-up contact back to the original record
            ⚡ Opportunity: "Related to log #ID" field to chain contacts
```

---

## 6. Reporting Flow

Reporting happens quarterly for IRC and monthly for CFS Incentive. Both currently require significant manual effort.

```
QUARTERLY PROGRESS REPORT (QPR) — Due 15th of month after quarter ends

Step 1 — Staff App: Generate quarterly summary
        │
        ├─► Navigate to Reports tab
        ├─► Select quarter + year
        ├─► Click Generate
        │   Output: total contacts, total hours, unique consumers, avg hrs/consumer
        │   ⚠ No breakdown by service type, no incident count (Issue #4)
        │
        └─► Export All Records CSV
            Output: OpenGrace_CFS_YYYY-MM-DD.csv

Step 2 — QPR Generator: Write the narrative
        │
        ├─► Open OpenGrace_QPR_Generator.html
        ├─► Enter API key (session-only, Anthropic Claude)
        ├─► Select quarter, import CSV from Step 1
        ├─► Click Generate — Claude writes the QPR narrative
        │   ⚠ Manual handoff — no direct connection between the two tools
        │   ⚡ Opportunity: Export from Staff App directly to QPR Generator format
        │
        └─► Review, edit, finalize QPR text

Step 3 — Submit to IRC
        │
        ├─► Director reviews and approves QPR
        ├─► Submit to IRC portal or via email to Service Coordinator
        │   ⚠ Submission is manual — no integration with IRC portal
        └─► File copy in Program Reporting folder on OneDrive

─────────────────────────────────────────────────────────────────

MONTHLY CFS INCENTIVE REPORT — Due end of month

        ├─► Director pulls contact log data from Staff App export
        ├─► Manually calculates incentive-eligible contacts
        │   ⚠ No dedicated monthly report view in the Staff App
        │   ⚡ Opportunity: Monthly summary card on Dashboard matching incentive criteria
        └─► Submits to IRC

─────────────────────────────────────────────────────────────────

SPECIAL INCIDENT REPORT (SIR) — Due within 24–48 hours of incident

        ├─► Verbal report to IRC within 24 hours (phone)
        ├─► Written SIR submitted within 48 hours
        │   ⚠ No SIR form in the Staff App or staff portal
        │   ⚠ No tracking of open/submitted SIRs
        │   ⚡ Opportunity: SIR form in staff-portal.html with Power Automate submission
        └─► Copy filed under client record in OneDrive
```

---

## 7. Pain Points Summary

| # | Pain Point | Flow | Severity | Issue |
|---|---|---|---|---|
| 1 | No referral tracking — referrals exist only in email before intake is complete | Referral | High | — |
| 2 | Roster changes require manual CSV re-import into Staff App | Intake / Status | High | — |
| 3 | jsPDF loads from CDN — client-forms.html fails offline | Intake | High | — |
| 4 | Incident note has no acknowledgment or SIR tracking | Staff Task / Follow-Up | High | #2 |
| 5 | No edit capability for logged contacts | Staff Task | High | #1 |
| 6 | Log form shows generic alert() on validation failure | Staff Task | Medium | #3 |
| 7 | Next-contact dates are stored but never surfaced | Follow-Up | Medium | — |
| 8 | Follow-up flags have no dedicated queue or view | Follow-Up | Medium | — |
| 9 | No direct handoff from Staff App to QPR Generator | Reporting | Medium | — |
| 10 | Quarterly report lacks service-type breakdown and incident count | Reporting | Medium | #4 |
| 11 | No monthly incentive report view | Reporting | Medium | — |
| 12 | No SIR form or SIR tracking in any tool | Reporting | Medium | — |
| 13 | Roster export not available — roster data can be lost | Staff Task | Medium | #5 |
| 14 | CSV column-name matching is brittle — silent data loss on mismatch | Intake | Medium | #8 |
| 15 | Session-only data with no auto-export prompt | Staff Task | Low | — |

---

## 8. Automation Opportunities

Ranked by impact vs. effort using Open Grace's existing Microsoft 365 stack (Power Automate, SharePoint, OneDrive, Teams).

### High Impact / Low Effort

**⚡ A — Auto-send Welcome Packet on referral acceptance**
- Trigger: Director marks referral as accepted (could be a checkbox in a SharePoint list)
- Action: Power Automate sends Welcome Packet PDF to family email
- Tools: SharePoint list + Power Automate + Outlook
- Effort: 1–2 hours

**⚡ B — Auto-export reminder after every 5 logs**
- Trigger: `logs.length % 5 === 0` after save
- Action: Toast notification: "You have 5 new logs. Export now to save your work."
- Tools: In-app JS change only
- Effort: 30 minutes

**⚡ C — Follow-up queue on Dashboard**
- Trigger: Any log where `followup !== 'No'` and `nextdate` is today or past
- Action: Dashboard card listing overdue follow-ups sorted by urgency
- Tools: In-app JS change only
- Effort: 1–2 hours

### High Impact / Medium Effort

**⚡ D — Live roster sync: Excel → Staff App**
- Trigger: Excel roster file saved to OneDrive
- Action: Power Automate converts to JSON → writes to a shared OneDrive JSON file → Staff App reads on load
- Tools: Power Automate + OneDrive + minor JS update to Staff App
- Effort: 3–5 hours

**⚡ E — Direct export to QPR Generator**
- Trigger: Staff clicks "Send to QPR Generator" on Reports tab
- Action: Packages the filtered quarterly data in the exact format QPR Generator expects and opens it
- Tools: In-app JS change + minor QPR Generator update
- Effort: 2–3 hours

**⚡ F — SIR form in Staff Portal with Power Automate submission**
- Trigger: Staff submits incident report via staff-portal.html
- Action: Power Automate sends SIR to director + timestamps the submission + logs to SharePoint
- Tools: New HTML form section + Power Automate flow
- Effort: 3–5 hours

### Medium Impact / Higher Effort

**⚡ G — Multi-staff shared contact log via SharePoint**
- Trigger: Staff saves a contact log entry
- Action: Power Automate HTTP trigger posts record to a SharePoint list
- Result: All staff logs accumulate in one place; Director sees all logs in real time
- Tools: Power Automate + SharePoint + Staff App HTTP call
- Effort: 5–8 hours

**⚡ H — Automated monthly incentive report**
- Trigger: End of month (scheduled Power Automate)
- Action: Query SharePoint contact log list → calculate incentive-eligible contacts → email summary to Director
- Tools: Power Automate + SharePoint (requires G first)
- Effort: 2–3 hours (after G)

**⚡ I — Referral intake tracking list**
- Trigger: IRC sends referral (manual entry or email parsing)
- Action: SharePoint list tracks: Referred → Intake Scheduled → Forms Signed → Active → Exited
- Result: Director has a pipeline view of all referrals at any time
- Tools: SharePoint list + optional Power Automate to notify on stage changes
- Effort: 3–4 hours

---

## 9. Recommended Implementation Order

If implementing one improvement at a time, this sequence builds on itself:

1. **B** — Auto-export reminder (30 min, zero risk, immediate data safety improvement)
2. **C** — Follow-up queue (1–2 hrs, pure JS, improves daily workflow immediately)
3. **A** — Auto-send Welcome Packet (1–2 hrs, uses existing Power Automate)
4. **E** — Staff App → QPR Generator handoff (2–3 hrs, removes a painful manual step)
5. **F** — SIR form in Staff Portal (3–5 hrs, closes a compliance gap)
6. **D** — Live roster sync (3–5 hrs, eliminates the re-import pain)
7. **G** — Multi-staff shared log (5–8 hrs, enables everything after it)
8. **I** — Referral tracking list (3–4 hrs, after G gives you a real data store)
9. **H** — Automated monthly incentive report (2–3 hrs, after G)

---

*Open Grace LLC · IRC Vendor PJ6208 · Subcode 076 · joshua.kennedy@opengrace.org*
