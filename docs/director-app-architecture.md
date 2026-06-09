# Open Grace CFS Staff App — Architecture Document

**App file:** `OpenGrace_CFS_App_v4.html` (Director Folder)
**Version:** v5 (as of 2026-06-09)
**Maintainer:** J. Kennedy, Director — Open Grace LLC
**Last updated:** 2026-06-09

---

## 1. App Purpose

The CFS Staff App is the primary operational tool for Open Grace LLC Family Coordinators. It provides a single-file, offline-capable interface for:

- Logging client contact sessions in compliance with Inland Counties Regional Center (IRC) documentation standards
- Tracking the 90-day service window for each active client
- Generating quarterly summary reports for IRC submission
- Viewing and filtering all session records by consumer, contact type, and date

The app is a self-contained `.html` file that runs by double-clicking — no server, no login system, no internet connection required for core functionality. It is designed to run on staff laptops, tablets, and field devices.

---

## 2. User Roles

| Role | Access | Responsibilities |
|---|---|---|
| **Family Coordinator** | Full app access | Log contacts, view own records, export CSV |
| **Director (J. Kennedy)** | Full app access | Review all records, generate quarterly reports, import roster |

There is no authentication layer in the current version. Access control is physical — the file is distributed to authorized staff only and is not hosted on a public URL. The Director manages access by controlling who receives the file.

> **Note:** `staff_access.json` (in the GitHub repo) defines staff codes and client assignments for use in the web portal, but is not yet integrated with the Staff App.

---

## 3. Main Workflows

### 3.1 Daily Contact Log
1. Staff opens the app (file:// or from OneDrive)
2. Navigates to the **Log** tab
3. Selects a consumer from the dropdown (populated from the Consumers list or imported roster)
4. Fills in: date, contact type, duration, IPP objectives, services provided, attendance, session notes, follow-up status, next contact date
5. If an incident occurred: fills in the Incident Note field (triggers SIR obligation)
6. Clicks **Save Contact Log** — record appended to in-memory `logs` array
7. Validation fires; on success, form clears and dashboard updates

### 3.2 CSV Import (from Excel)
1. Staff exports the Contact Log or Client Roster tab from `OpenGrace_CFS_System_v4.xlsx` as CSV
2. Opens the Import modal via the header **Import** button
3. Drags CSV into the drop zone or selects via file picker
4. App auto-detects file type (Contact Log vs. Client Roster) by scanning header names
5. Shows a preview of the first 5 rows
6. Staff clicks **Confirm Import** — data replaces the current in-memory store
7. Source banner updates; dashboard refreshes

### 3.3 Quarterly Report Generation
1. Director navigates to the **Reports** tab
2. Selects quarter and year
3. Clicks **Generate** — filters `logs` array by date range
4. Summary displays: total contacts, total hours, unique consumers, avg hours per consumer, and per-consumer breakdown
5. Director reviews QPR checklist items (manual checkboxes)
6. Exports CSV for upload to IRC portal or import into the QPR Generator tool

### 3.4 CSV Export
1. Available at any time via the **Export** button in the header or Reports tab
2. Exports all records in `logs` as a dated CSV file: `OpenGrace_CFS_YYYY-MM-DD.csv`
3. Staff must export before closing the browser tab — data is session-only

### 3.5 Manual Consumer Add
1. Staff navigates to the **Consumers** tab
2. Enters name, RC case number, language, enrollment date, assigned staff, status
3. Clicks **Add Consumer** — added to in-memory `consumers` array
4. Consumer immediately appears in the Log tab dropdown

---

## 4. Data Models

All data lives in JavaScript memory only (session-only). No localStorage, no server, no database. Data persists only within the current browser tab session.

### `logs[]` — Contact Log Records
```js
{
  id:         Number,   // Date.now() + index
  consumer:   String,   // Consumer full name
  date:       String,   // YYYY-MM-DD
  staff:      String,   // Staff full name
  type:       String,   // Contact type (enum)
  hours:      Number,   // Duration in hours (0.25 step)
  ipp:        String,   // Free-text IPP objective reference
  services:   String[], // Array of service categories (multi-select)
  attendance: String,   // Present | Absent - Excused | Absent - Unexcused | Partial
  family:     String,   // Yes | No | N/A
  notes:      String,   // Session notes (required)
  followup:   String,   // No | Yes - Minor | Yes - Urgent
  nextdate:   String,   // YYYY-MM-DD (optional)
  incident:   String,   // Incident description (blank if none)
}
```

### `consumers[]` — Manually Added Consumers
```js
{
  id:     Number,
  name:   String,
  rc:     String,   // RC Case Number
  lang:   String,   // Primary language
  enroll: String,   // YYYY-MM-DD enrollment date
  staff:  String,   // Assigned staff name
  status: String,   // Active | Assessment Phase | On Hold | Exited
}
```

### `roster[]` — Client Roster (from Excel import)
```js
{
  id:             Number,
  name:           String,
  dob:            String,   // YYYY-MM-DD
  rc:             String,   // RC Case Number
  diagnosis:      String,
  lang:           String,
  enroll:         String,   // YYYY-MM-DD
  startDate:      String,   // YYYY-MM-DD — used for 90-day countdown
  status:         String,   // Active | Assessment Phase | On Hold | Exited
  staff:          String,
  emergency:      String,   // Emergency contact name
  emergencyPhone: String,
  notes:          String,
}
```

### Contact Type Enum
`In-Person Home Visit`, `Phone Call`, `Video Call`, `Community Appointment`, `Assessment Session`, `IDT Meeting`, `Regional Center Meeting`, `Provider Coordination`, `Crisis Response`, `Other`

### Services Provided Enum
`Family Home Support`, `Service Navigation`, `Resource Access`, `Provider Coordination`, `Scheduling Support`, `Transportation Coordination`, `Future Planning`, `Independence Training`, `Backup Services ID`, `Benefits Assistance`

---

## 5. Key Pages / Tabs

| Tab | Panel ID | Purpose |
|---|---|---|
| **Dashboard** | `#panel-dashboard` | Stat cards, 90-day warnings, QPR deadline, recent contacts |
| **Log** | `#panel-log` | New contact log entry form |
| **Records** | `#panel-records` | Searchable, filterable list of all logged contacts |
| **Clients** | `#panel-clients` | Roster view with 90-day status, sorted by urgency |
| **Consumers** | `#panel-consumers` | Manual consumer add form + list |
| **Reports** | `#panel-reporting` | Quarterly summary generator, QPR checklist, export |

### Dashboard Widgets
- **4 roster stat cards:** Active, Assessment Phase, New This Month, Total
- **4 log stat cards:** Total Contacts, This Month, Active Consumers, Assessment Hours (of 12 max/yr)
- **90-day alert banners:** Red (expired), Orange (≤14 days remaining) — calculated from `roster[].startDate`
- **IRC Deadlines:** QPR due date (auto-calculated by quarter), Monthly CFS Incentive, SIR deadlines
- **Recent Contacts:** 5 most recent log entries by date

---

## 6. API / Database Dependencies

The Staff App has **no API calls and no database**. It is entirely self-contained.

| Dependency | Type | Purpose | Status |
|---|---|---|---|
| None — all inline | — | — | — |

### External Systems (manual handoff, not integrated)

| System | How it connects | Gap |
|---|---|---|
| `OpenGrace_CFS_System_v4.xlsx` | Manual CSV export → import | No live sync; staff must re-export after every Excel update |
| `OpenGrace_QPR_Generator.html` | Manual CSV export → import | No direct handoff; staff copy-pastes or re-imports |
| Inland Regional Center Portal | Manual data entry from exported CSV | No API; staff transcribes from the CSV export |
| Power Automate | Not connected to this tool | Connected to `client-forms.html` for PDF delivery; not wired to contact logs |

---

## 7. Security & Privacy Concerns

### PHI Handling
- **Session-only data model (v5+):** All PHI (`logs`, `consumers`, `roster`) is stored in JavaScript variables only. Nothing is written to `localStorage`, `sessionStorage`, `IndexedDB`, or any external endpoint.
- **beforeunload warning:** If unsaved data exists when the tab is closed, the browser shows an export reminder. This is the only data-loss safeguard.
- **No encryption at rest:** Data in memory is unencrypted — standard for session-only JS, but means a browser crash loses all unsaved work.
- **CSV export contains PHI:** The downloaded CSV (`OpenGrace_CFS_YYYY-MM-DD.csv`) contains full consumer names, session notes, incident descriptions, and dates. Staff must store and transmit this file using HIPAA-compliant channels (OneDrive, not email).

### Known Risks (filed as GitHub issues)
- **XSS via imported CSV** (Issue #9): `renderRecords()`, `renderClients()`, and `showPreview()` inject untrusted CSV values into `innerHTML` without escaping. A malicious CSV could execute scripts.
- **No authentication:** The file is access-controlled only by distribution — anyone with the file has full access to any data imported into it.
- **No audit trail:** There is no log of who opened the app, what was imported, or when exports were made.
- **Brittle CSV column matching** (Issue #8): Silent data loss if Excel column names differ from expected strings.

### HIPAA Considerations
- PHI never leaves the device unless the staff member clicks Export
- The tool must not be hosted on a public URL or shared via unauthenticated link
- Downloaded CSVs must be stored in the Open Grace OneDrive folder, not on personal device storage
- Staff should be instructed to close the tab (not minimize) after each session to clear memory

---

## 8. Future Scaling Needs

As Open Grace grows from 1 to 10+ clients and 3+ staff, the following limitations will become blockers:

### Near-term (1–5 clients, 1–3 staff)
| Need | Current State | Recommended Path |
|---|---|---|
| Edit a logged record | Not possible — delete and re-log only | Add edit flow (Issue #1) |
| Know which staff logged what | Staff name is a free-text field — no enforcement | Pre-populate from staff_access.json |
| SIR tracking | Incident field has no follow-up mechanism | Add acknowledgment modal (Issue #2) |

### Mid-term (5–15 clients, 3–6 staff)
| Need | Current State | Recommended Path |
|---|---|---|
| Multi-staff access to shared data | Each staff member has their own file with their own data | Power Automate flow to submit logs to a shared SharePoint list |
| Live roster sync | Manual CSV re-import every time Excel changes | Power Automate to push roster changes to a shared JSON on OneDrive |
| Richer quarterly reports | 4 aggregate stats only | Add service-type breakdown (Issue #4) |
| Roster export | Not available | Add export roster button (Issue #5) |

### Long-term (15+ clients, 6+ staff)
| Need | Current State | Recommended Path |
|---|---|---|
| Centralized data store | Per-device session memory | SharePoint list or Dataverse via Power Apps |
| Authentication | None | Azure AD / Microsoft 365 login |
| Audit trail | None | Power Automate logging to SharePoint |
| IRC portal integration | Manual transcription | IRC API (if/when available) or structured CSV template matching IRC import format |
| Automated QPR generation | Manual + separate QPR Generator tool | Direct handoff from Staff App → QPR Generator via shared data format |

---

## 9. Related Files

| File | Location | Relationship |
|---|---|---|
| `OpenGrace_CFS_App_v4.html` | `Director Folder/` | This app |
| `OpenGrace_CFS_System_v4.xlsx` | OneDrive (not in repo) | Source of truth for roster and contact log data |
| `OpenGrace_QPR_Generator.html` | `Director Folder/` | Downstream consumer of exported contact log CSV |
| `client-forms.html` | `Director Folder/Open-Grace-Staff-main/` | Intake forms — feeds new clients into the roster |
| `staff_access.json` | `Director Folder/Open-Grace-Staff-main/` | Staff codes and client assignments — not yet integrated |
| `contact-log.html` | `Director Folder/Open-Grace-Staff-main/` | Staff-facing JotForm-linked daily log (web portal version) |
| `tests/smoke/cfs-app.smoke.spec.js` | `tests/smoke/` | Playwright smoke tests for this app |

---

*Open Grace LLC · IRC Vendor PJ6208 · Subcode 076 · joshua.kennedy@opengrace.org*
