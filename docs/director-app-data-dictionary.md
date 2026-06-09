# Open Grace CFS — Data Dictionary

**Scope:** All form fields, data objects, validation rules, reporting metrics, and duplicate-data risks across the CFS Staff App (`OpenGrace_CFS_App_v4.html`) and Client Acknowledgment Forms (`client-forms.html`)
**Last updated:** 2026-06-09
**Maintainer:** J. Kennedy, Director — Open Grace LLC

---

## How to read this document

- **R** = Required / **O** = Optional
- **Source** = which tool captures this field
- **Stored in** = which data object holds it
- Validation rules describe what the app currently enforces (✅) vs. what it should enforce but does not (⚠)

---

## Part 1 — Contact Log Fields

Captured in the **Log tab** of `OpenGrace_CFS_App_v4.html`. Each saved entry becomes one object in `logs[]`.

---

### 1.1 `consumer` — Consumer Name

| Attribute | Value |
|---|---|
| **Label** | Consumer |
| **R / O** | Required |
| **Type** | String (select from dropdown) |
| **Source** | CFS Staff App — Log tab (`#f-consumer`) |
| **Stored in** | `logs[].consumer` |
| **Format** | Full name, First Last or Last, First (inherited from how consumer was added) |

**Validation:**
- ✅ Must not be empty — save is blocked if no consumer is selected
- ⚠ No enforcement of name format (First Last vs. Last, First)
- ⚠ Free-text match only — if the same person is added twice with slightly different spelling, they appear as two distinct consumers

**Reporting use:** Used to group contacts by consumer in quarterly reports, count unique consumers, and calculate per-consumer hours.

**Duplicate risk:** ⚠ HIGH. Consumer names are stored as plain strings. "Maria Garcia" and "Garcia, Maria" are treated as different people. Contacts logged under either name will not be aggregated together in reports. See Part 5 for full duplicate analysis.

---

### 1.2 `date` — Contact Date

| Attribute | Value |
|---|---|
| **Label** | Date |
| **R / O** | Required |
| **Type** | String (YYYY-MM-DD) |
| **Source** | CFS Staff App — Log tab (`#f-date`) |
| **Stored in** | `logs[].date` |
| **Default** | Today's date (set on form init and after each save) |
| **Format** | ISO 8601: `YYYY-MM-DD` |

**Validation:**
- ✅ Must not be empty
- ⚠ No future-date block — staff can log contacts for dates that haven't happened yet
- ⚠ No past-date limit — staff can backdate entries without restriction (documentation risk)
- ⚠ No check against consumer's enrollment date or service start date

**Reporting use:** Used to filter records by quarter/month in all reports. Drives "This Month" stat card, QPR date range filter, and recent-contacts sort order.

---

### 1.3 `staff` — Staff Name

| Attribute | Value |
|---|---|
| **Label** | Staff Name |
| **R / O** | Required |
| **Type** | String (free text) |
| **Source** | CFS Staff App — Log tab (`#f-staff`) |
| **Stored in** | `logs[].staff` |
| **Format** | Full name, free entry |

**Validation:**
- ✅ Must not be empty
- ⚠ No validation against authorized staff list (`staff_access.json`)
- ⚠ Not pre-populated — staff must type their name on every log entry
- ⚠ Typos create phantom staff members in records and reports

**Reporting use:** Appears on record cards, searchable in Records tab. Not currently aggregated in any report metric.

**Duplicate risk:** ⚠ MEDIUM. "Josh Kennedy" and "Joshua Kennedy" and "J. Kennedy" will all appear as distinct staff members in record searches.

---

### 1.4 `type` — Contact Type

| Attribute | Value |
|---|---|
| **Label** | Contact Type |
| **R / O** | Required |
| **Type** | String (select — fixed enum) |
| **Source** | CFS Staff App — Log tab (`#f-type`) |
| **Stored in** | `logs[].type` |

**Allowed values:**

| Value | IRC Billing Relevance |
|---|---|
| `In-Person Home Visit` | Core CFS service |
| `Phone Call` | Billable contact |
| `Video Call` | Billable contact |
| `Community Appointment` | Billable contact |
| `Assessment Session` | Billable — capped at 12 hrs/consumer/yr |
| `IDT Meeting` | Interdisciplinary Team — billable |
| `Regional Center Meeting` | Coordination — billable |
| `Provider Coordination` | Billable contact |
| `Crisis Response` | Billable — may trigger SIR |
| `Other` | Use sparingly — reduces reporting clarity |

**Validation:**
- ✅ Must not be empty (select defaults to blank placeholder)
- ✅ Values are constrained to the enum above (HTML select)
- ⚠ "Other" accepts no sub-classification — creates an unquantifiable bucket in reports

**Reporting use:** Used for the contact-type breakdown in quarterly reports (Issue #4 — not yet implemented). Assessment Sessions are specially filtered to calculate the 12-hr annual cap shown on the dashboard.

---

### 1.5 `hours` — Duration (Hours)

| Attribute | Value |
|---|---|
| **Label** | Duration (hours) |
| **R / O** | Optional |
| **Type** | Number (float) |
| **Source** | CFS Staff App — Log tab (`#f-hours`) |
| **Stored in** | `logs[].hours` |
| **Range** | 0.25 – 8.0, step 0.25 |
| **Default** | Empty (0 if not entered) |

**Validation:**
- ⚠ Not required — staff can save a log with 0 hours, which silently skews all hour-based reports
- ⚠ No minimum enforcement beyond the HTML `min="0.25"` attribute (bypassed if staff types directly)
- ⚠ No maximum enforcement beyond HTML `max="8"` attribute
- ⚠ No check that hours are plausible for the contact type (e.g., 8 hours for a Phone Call)

**Reporting use:** Summed to calculate Total Hours in quarterly reports. Used to compute Avg Hrs / Consumer. Assessment hours specifically aggregated for the 12-hr cap dashboard metric.

**Risk:** ⚠ If hours are omitted, quarterly reports undercount total service hours delivered. This affects rate justification and IRC compliance.

---

### 1.6 `ipp` — IPP Objectives

| Attribute | Value |
|---|---|
| **Label** | IPP Objectives |
| **R / O** | Optional |
| **Type** | String (free text) |
| **Source** | CFS Staff App — Log tab (`#f-ipp`) |
| **Stored in** | `logs[].ipp` |
| **Example** | `Goal 1 – Daily living skills`, `Goal 3 – Community access` |

**Validation:**
- ⚠ Not required — but IRC documentation standards expect session notes to reference IPP goals
- ⚠ Free text — no connection to the consumer's actual IPP goals on file at IRC
- ⚠ No standardized format enforced

**Reporting use:** Exported in CSV; visible on record cards. Not currently aggregated in any report. Auditors may review for IPP alignment during IRC compliance reviews.

---

### 1.7 `services` — Services Provided

| Attribute | Value |
|---|---|
| **Label** | Services Provided |
| **R / O** | Required |
| **Type** | String[] (multi-select checkboxes) |
| **Source** | CFS Staff App — Log tab (`.f-svc` checkboxes) |
| **Stored in** | `logs[].services` (array) |
| **Export format** | Semicolon-delimited string: `"Family Home Support;Resource Access"` |

**Allowed values:**

| Value | Description |
|---|---|
| `Family Home Support` | Direct in-home support activities |
| `Service Navigation` | Helping family navigate regional center system |
| `Resource Access` | Connecting family to community resources |
| `Provider Coordination` | Coordinating with other service providers |
| `Scheduling Support` | Appointment and schedule management |
| `Transportation Coordination` | Arranging or coordinating transportation |
| `Future Planning` | Long-term planning for consumer independence |
| `Independence Training` | Skills development for independent living |
| `Backup Services ID` | Identifying backup service providers |
| `Benefits Assistance` | SSI, Medi-Cal, housing benefits navigation |

**Validation:**
- ✅ At least one checkbox must be checked (required field per form config)
- ✅ Values are constrained to the enum above (HTML checkboxes)

**Reporting use:** Exported as semicolon-delimited string in CSV. Not currently aggregated in quarterly reports — service frequency breakdown is a missing report feature (Issue #4).

---

### 1.8 `attendance` — Attendance

| Attribute | Value |
|---|---|
| **Label** | Attendance |
| **R / O** | Optional (defaults to `Present`) |
| **Type** | String (select — fixed enum) |
| **Source** | CFS Staff App — Log tab (`#f-attendance`) |
| **Stored in** | `logs[].attendance` |
| **Default** | `Present` |

**Allowed values:** `Present`, `Absent - Excused`, `Absent - Unexcused`, `Partial`

**Validation:** ✅ Constrained to enum. No further validation.

**Reporting use:** Shown as colored badge on record cards (green = Present, red = Unexcused, gold = other). Should be included in quarterly compliance report as unexcused absence count (not yet implemented — Issue #4).

---

### 1.9 `family` — Family Present

| Attribute | Value |
|---|---|
| **Label** | Family Present? |
| **R / O** | Optional (defaults to `Yes`) |
| **Type** | String (select) |
| **Source** | CFS Staff App — Log tab (`#f-family`) |
| **Stored in** | `logs[].family` |
| **Default** | `Yes` |

**Allowed values:** `Yes`, `No`, `N/A`

**Reporting use:** Exported in CSV. Not currently aggregated. Relevant for IRC documentation of family participation.

---

### 1.10 `notes` — Session Notes

| Attribute | Value |
|---|---|
| **Label** | Session Notes |
| **R / O** | Required |
| **Type** | String (textarea) |
| **Source** | CFS Staff App — Log tab (`#f-notes`) |
| **Stored in** | `logs[].notes` |
| **Min length** | 1 character (any non-empty string passes) |

**Validation:**
- ✅ Must not be empty
- ⚠ No minimum length — a single space character passes validation
- ⚠ No structure guidance — IRC expects notes to reference progress toward IPP goals, barriers, and next steps
- ⚠ Notes are truncated to 2 lines on record cards (CSS `-webkit-line-clamp: 2`) with no expand option

**Reporting use:** Exported in CSV. Auditors review for quality and IPP alignment. The QPR Generator uses notes (via CSV import) to generate the QPR narrative.

---

### 1.11 `followup` — Follow-Up Status

| Attribute | Value |
|---|---|
| **Label** | Follow-Up? |
| **R / O** | Optional (defaults to `No`) |
| **Type** | String (select) |
| **Source** | CFS Staff App — Log tab (`#f-followup`) |
| **Stored in** | `logs[].followup` |
| **Default** | `No` |

**Allowed values:** `No`, `Yes - Minor`, `Yes - Urgent`

**Validation:** ✅ Constrained to enum. No further validation.

**Reporting use:** Shown as badge on record cards. Should appear in a follow-up queue on the Dashboard (not yet implemented). Urgent follow-ups should be surfaced prominently.

---

### 1.12 `nextdate` — Next Contact Date

| Attribute | Value |
|---|---|
| **Label** | Next Contact Date |
| **R / O** | Optional |
| **Type** | String (YYYY-MM-DD) |
| **Source** | CFS Staff App — Log tab (`#f-nextdate`) |
| **Stored in** | `logs[].nextdate` |

**Validation:**
- ⚠ No validation — stored as-is
- ⚠ Not surfaced anywhere after saving — no dashboard widget, no reminder, no queue

**Reporting use:** Exported in CSV only. This field is effectively invisible after the log is saved.

---

### 1.13 `incident` — Incident Note

| Attribute | Value |
|---|---|
| **Label** | Incident Note |
| **R / O** | Optional |
| **Type** | String (textarea) |
| **Source** | CFS Staff App — Log tab (`#f-incident`) |
| **Stored in** | `logs[].incident` |

**Validation:**
- ⚠ No validation — blank means no incident
- ⚠ No mandatory SIR acknowledgment when filled (Issue #2)
- ⚠ No tracking of whether verbal/written SIRs were filed

**Compliance note:** Any non-blank incident note implies a legally reportable event. IRC requires verbal SIR within 24 hours and written SIR within 48 hours. The app currently has no mechanism to enforce or track this.

**Reporting use:** A red "⚠️ Incident" badge appears on the record card if non-empty. Should be counted separately in quarterly reports (Issue #4).

---

## Part 2 — Consumer / Client Fields

### 2.1 Consumers — Manually Added (`consumers[]`)

Captured in the **Consumers tab** of the CFS Staff App.

| Field | Label | R/O | Type | Notes |
|---|---|---|---|---|
| `id` | — | Auto | Number | `Date.now()` at time of creation |
| `name` | Full Name | R | String | Free text — see duplicate risk |
| `rc` | RC Case # | O | String | Regional Center case number — no format enforced |
| `lang` | Primary Language | O | String | Free text — no language code standard |
| `enroll` | Enrollment Date | O | String | YYYY-MM-DD — no validation |
| `staff` | Assigned Staff | O | String | Free text — no validation against staff list |
| `status` | Status | O | Enum | `Active` \| `Assessment Phase` \| `On Hold` \| `Exited` |

**Validation:**
- ✅ Name must not be empty
- ⚠ All other fields are optional with no format validation
- ⚠ RC Case # accepts any string — no format check (IRC numbers follow a specific format)

---

### 2.2 Roster — Imported from Excel (`roster[]`)

Imported via CSV from `OpenGrace_CFS_System_v4.xlsx`.

| Field | CSV Column | R/O | Type | Notes |
|---|---|---|---|---|
| `id` | — | Auto | Number | Assigned on import |
| `name` | `Full Name` or `name` | R | String | Import fails silently if column missing |
| `dob` | `Date of Birth` or `dob` | O | String | YYYY-MM-DD — no validation |
| `rc` | `RC Case #` or `RC Case Number` or `rc` | O | String | — |
| `diagnosis` | `Diagnosis` or `diagnosis` | O | String | Free text |
| `lang` | `Language` or `Primary Language` or `lang` | O | String | Free text |
| `enroll` | `Enrollment Date` or `enroll` | O | String | YYYY-MM-DD |
| `startDate` | `Service Start Date` or `startDate` | O | String | **Critical** — drives 90-day countdown |
| `status` | `Status` or `status` | O | Enum | `Active` \| `Assessment Phase` \| `On Hold` \| `Exited` |
| `staff` | `Assigned Staff` or `staff` | O | String | Free text |
| `emergency` | `Emergency Contact` or `emergency` | O | String | Name only |
| `emergencyPhone` | `Emergency Phone` or `emergencyPhone` | O | String | No format validation |
| `notes` | `Notes` or `notes` | O | String | Free text |

**Critical field — `startDate`:** The 90-day compliance window is calculated entirely from this field. If it is blank, the client shows no deadline. If it contains an incorrect date, the countdown is wrong. The app does not warn when this field is missing for an Active client.

**Import validation:**
- ✅ Rows with no `name` value are filtered out
- ⚠ All other missing values silently default to empty string
- ⚠ Column name matching is case-sensitive on the first variant, case-insensitive fallback — fragile (Issue #8)

---

## Part 3 — Client Acknowledgment Form Fields

Captured in `client-forms.html`. Three separate forms; fields auto-populate across tabs.

### 3.1 Consent to Services (Tab 1)

| Field ID | Label | R/O | Type | Syncs to |
|---|---|---|---|---|
| `c-consumer` | Consumer Full Name | R | Text | `r-consumer`, `e-consumer` |
| `c-uci` | UCI Number | R | Text | `r-uci`, `e-uci` |
| `c-dob` | Date of Birth | R | Date | `e-dob` |
| `c-diag` | Primary Diagnosis | O | Text | — |
| `c-guardian` | Guardian / Authorized Representative | R | Text | `r-guardian` |
| `c-rel` | Relationship to Consumer | R | Text | — |
| `c-email` | Family Email Address | R | Email | `r-email` |
| `c-date` | Today's Date | R | Date | `r-date`, `e-date` |
| `c-guard-print` | Guardian Print Name | O | Text | — |
| `c-staff-print` | Staff Name & Title | O | Text | — |
| `sig-consent-guardian` | Guardian Signature | R | Canvas | — |
| `sig-consent-staff` | Staff Signature | R | Canvas | — |
| Checkboxes (6) | Consent & ROI acknowledgments | R | Checkbox | — |

**UCI Number:** 7-digit number assigned by IRC. No format validation is currently enforced — the field accepts any string.

**Auto-populate:** When staff fills in Tab 1, `syncFields()` copies Consumer Name, UCI, Guardian, Email, Date, and DOB to the matching fields in Tabs 2 and 3. This reduces re-entry but does not prevent a staff member from manually editing the downstream copies to different values.

---

### 3.2 Client Rights & Confidentiality (Tab 2)

| Field ID | Label | R/O | Type | Pre-filled from |
|---|---|---|---|---|
| `r-consumer` | Consumer Full Name | R | Text | `c-consumer` |
| `r-uci` | UCI Number | R | Text | `c-uci` |
| `r-guardian` | Guardian / Authorized Representative | R | Text | `c-guardian` |
| `r-email` | Family Email Address | R | Email | `c-email` |
| `r-date` | Today's Date | R | Date | `c-date` |
| `r-guard-print` | Guardian Print Name | O | Text | — |
| `r-staff-print` | Staff Name & Title | O | Text | — |
| `sig-rights-guardian` | Guardian Signature | R | Canvas | — |
| `sig-rights-staff` | Staff Signature | R | Canvas | — |
| Checkboxes (5) | Rights acknowledgments | R | Checkbox | — |

---

### 3.3 Emergency Contact & Authorization (Tab 3)

| Field ID | Label | R/O | Type | Pre-filled from |
|---|---|---|---|---|
| `e-consumer` | Consumer Full Name | R | Text | `c-consumer` |
| `e-uci` | UCI Number | R | Text | `c-uci` |
| `e-dob` | Date of Birth | R | Date | `c-dob` |
| `e-date` | Today's Date | R | Date | `c-date` |
| `e-p1-name` | Primary Emergency Contact Name | R | Text | — |
| `e-p1-rel` | Relationship | R | Text | — |
| `e-p1-phone` | Primary Phone | R | Tel | — |
| `e-p1-alt` | Alternate Phone | O | Tel | — |
| `e-p1-email` | Contact Email | R | Email | — |
| `e-p1-addr` | Home Address | O | Text | — |
| `e-p2-name` | Secondary Contact Name | O | Text | — |
| `e-p2-rel` | Secondary Relationship | O | Text | — |
| `e-p2-phone` | Secondary Phone | O | Tel | — |
| `e-pcp` | Primary Care Physician | O | Text | — |
| `e-pcp-phone` | PCP Phone | O | Tel | — |
| `e-ins` | Health Insurance | O | Text | — |
| `e-ins-id` | Insurance Member ID | O | Text | — |
| `e-allergy` | Known Allergies | O | Text | — |
| `e-meds` | Current Medications | O | Textarea | — |
| `e-special` | Special Health / Safety Considerations | O | Textarea | — |
| `e-guard-print` | Guardian Print Name | O | Text | — |
| `e-staff-print` | Staff Name & Title | O | Text | — |
| `sig-emerg-guardian` | Guardian Signature | R | Canvas | — |
| `sig-emerg-staff` | Staff Signature | R | Canvas | — |
| Checkboxes (4) | Emergency authorization acknowledgments | R | Checkbox | — |

**Phone number fields:** All `tel` inputs accept any string — no format validation (no `(xxx) xxx-xxxx` enforcement).

---

## Part 4 — Outcome Metrics & Reporting Fields

These are derived values computed at report time from the raw `logs[]` and `roster[]` data.

### 4.1 Dashboard Metrics

| Metric | Displayed in | Calculated from | Field(s) used |
|---|---|---|---|
| Total Contacts | `#s-total` | `logs.length` | — |
| This Month | `#s-month` | `logs` filtered by current YYYY-MM | `logs[].date` |
| Active Consumers | `#s-consumers` | `consumers` filtered by status | `consumers[].status` |
| Assessment Hours | `#s-assess` | Sum of hours where type = Assessment Session | `logs[].type`, `logs[].hours` |
| Active Clients (Roster) | `#rs-active` | `roster` filtered by status | `roster[].status` |
| Assessment Phase (Roster) | `#rs-assess` | `roster` filtered by status | `roster[].status` |
| New This Month | `#rs-new` | `roster` filtered by enroll month = current month | `roster[].enroll` |
| Total Clients | `#rs-total` | `roster.length` | — |
| 90-Day Countdown | Alert banners | Days from `startDate` + 90 to today | `roster[].startDate` |
| QPR Due Date | `#qpr-due` | Quarter of current date | Current date |

### 4.2 Quarterly Report Metrics

| Metric | Element | Formula |
|---|---|---|
| Total Contacts | `#r-contacts` | Count of `logs[]` in date range |
| Total Hours | `#r-hours` | Sum of `logs[].hours` in date range |
| Unique Consumers | `#r-unique` | Count of distinct `logs[].consumer` values in range |
| Avg Hrs / Consumer | `#r-avg` | Total Hours ÷ Unique Consumers |
| Per-consumer breakdown | `#r-breakdown` | Contact count + hours + services per consumer |

**Missing metrics** (Issue #4 — not yet implemented):

| Metric | Formula | Why it matters |
|---|---|---|
| Contacts by type | Count per `logs[].type` | IRC wants to see service mix |
| Services frequency | Count per value in `logs[].services` | Demonstrates CFS scope |
| Incident count | Count where `logs[].incident !== ''` | Compliance — must be reported |
| Urgent follow-up count | Count where `logs[].followup === 'Yes - Urgent'` | QA indicator |
| Unexcused absence count | Count where `logs[].attendance === 'Absent - Unexcused'` | Service continuity flag |

---

## Part 5 — Duplicate Data Risks

Duplicate data is the most serious long-term data quality risk in the current system. Because consumer names are stored as plain strings with no ID system, the same person can appear under multiple spellings and will never be automatically merged.

### 5.1 Consumer Name Duplicates

**Risk level:** HIGH

| Scenario | Example | Impact |
|---|---|---|
| Name format inconsistency | `"Maria Garcia"` vs. `"Garcia, Maria"` | Split contact history — reports undercount |
| Nickname vs. legal name | `"Mike Torres"` vs. `"Michael Torres"` | Split history — hours split across two "people" |
| Typo on entry | `"Jaybrion Burks"` vs. `"Jaybrion Burk"` | Orphaned records — one consumer has no history |
| CSV import format vs. manual entry | Imported as `"Last, First"`, logged as `"First Last"` | All imported records unlinked from manual logs |

**Root cause:** No stable consumer ID. The `logs[].consumer` field stores the display name string, not a reference to a consumer object with a unique `id`.

**Fix:** Assign a stable `consumerId` at the time a consumer is created or imported, store `logs[].consumerId` instead of `logs[].consumer`, and display the name at render time by lookup.

---

### 5.2 Staff Name Duplicates

**Risk level:** MEDIUM

| Scenario | Example |
|---|---|
| Abbreviation vs. full name | `"J. Kennedy"` vs. `"Joshua Kennedy"` |
| Middle name included | `"Joshua R. Kennedy"` vs. `"Joshua Kennedy"` |
| Typo | `"Josua Kennedy"` |

**Impact:** Staff attribution in records is unreliable. Filtered searches by staff name will miss records. When multi-staff reporting is added, per-staff contact counts will be wrong.

**Fix:** Pre-populate staff name from an authenticated session or a validated dropdown matching `staff_access.json`.

---

### 5.3 Consumer vs. Roster Disconnect

**Risk level:** HIGH

The app maintains two separate lists of people:

| List | Source | Used for |
|---|---|---|
| `consumers[]` | Manually added in Consumers tab | Log form dropdown, dashboard active count |
| `roster[]` | Imported from Excel CSV | Clients tab, 90-day countdown, roster stats |

These two lists are **never linked**. A client can exist in `roster[]` and also be manually added to `consumers[]` as a separate entry. Contacts logged against the `consumers[]` entry will not appear in the client card pulled from `roster[]`.

**Fix:** When importing a roster, check if any roster name matches an existing consumer and merge them, or display a warning to the user.

---

### 5.4 Cross-Session Data Drift

**Risk level:** MEDIUM

Because data is session-only, staff who open a new session each day have no connection to historical data unless they re-import a CSV. This means:

- A consumer might exist in Monday's session CSV but not Tuesday's if the export was partial
- Contacts logged in different sessions under slightly different consumer names accumulate across multiple CSV exports with no deduplication
- The Excel source file (`OpenGrace_CFS_System_v4.xlsx`) becomes the de facto system of record, and the Staff App is only as accurate as the last import

---

### 5.5 Client Acknowledgment Form vs. Roster

**Risk level:** LOW (current scale), HIGH (at scale)

Fields captured in `client-forms.html` at intake (UCI number, DOB, guardian name, emergency contact) are never automatically imported into the Staff App roster. The Director must manually add them to Excel, then re-import. Any mismatch between the signed intake form and the Excel roster is invisible to the app.

---

## Part 6 — Field Cross-Reference

Fields that appear in more than one place, with notes on where the authoritative copy lives.

| Field | client-forms.html | CFS Staff App (consumers[]) | CFS Staff App (roster[]) | Excel source |
|---|---|---|---|---|
| Consumer full name | `c-consumer` (Tab 1) | `consumers[].name` | `roster[].name` | `Full Name` column |
| UCI number | `c-uci` | — | — | Not in current roster model |
| Date of birth | `c-dob` | — | `roster[].dob` | `Date of Birth` |
| Primary diagnosis | `c-diag` | — | `roster[].diagnosis` | `Diagnosis` |
| Enrollment date | — | `consumers[].enroll` | `roster[].enroll` | `Enrollment Date` |
| Assigned staff | — | `consumers[].staff` | `roster[].staff` | `Assigned Staff` |
| Status | — | `consumers[].status` | `roster[].status` | `Status` |
| Emergency contact name | `e-p1-name` | — | `roster[].emergency` | `Emergency Contact` |
| Emergency contact phone | `e-p1-phone` | — | `roster[].emergencyPhone` | `Emergency Phone` |
| Primary language | — | `consumers[].lang` | `roster[].lang` | `Language` |
| Service start date | — | — | `roster[].startDate` | `Service Start Date` |

**Authoritative source:** `OpenGrace_CFS_System_v4.xlsx` is the system of record. All other copies are derived. Changes made in the app do not flow back to Excel.

---

*Open Grace LLC · IRC Vendor PJ6208 · Subcode 076 · joshua.kennedy@opengrace.org*
