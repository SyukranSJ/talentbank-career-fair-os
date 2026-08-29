# Talentbank Career Fair OS

> AI-assisted career fair calendar and event operations prototype built for the
> Talentbank Junior AI Automation Engineer challenge.

## 🚀 Live Demo

**[Open the live prototype](https://talentbank-career-fairs-orpin.vercel.app/)**

EMAIL=events@talentbank.demo <br>
PASSWORD=TalentbankDemo.2026


The live deployment is the recommended way to review the prototype. You can
browse the public career-fair calendar, open event details, register for events,
and explore the Talentbank events/admin workflow and AI Copilot.

The GitHub repository contains the complete source code and a local setup guide
for reviewers who want to inspect or run the project themselves.

---

## What this project does

Talentbank Career Fair OS is a prototype for managing career-fair events,
registrations, scheduling and event operations.

### For candidates and employers

Users can:

- Browse the career-fair calendar.
- Search and filter events.
- Open event details.
- Check dates, daily hours, venue, audience and capacity.
- Register for events.
- See whether an event is full or cancelled.
- Register only for events whose audience allows their user type.

### For the Talentbank events team

The admin system allows the events team to:

- Create and edit events.
- Manage event dates and daily hours.
- Move/reschedule events.
- Cancel events with a reason.
- View registrations and capacity.
- Identify scheduling conflicts.
- Review event history/audit information.
- Use the AI Copilot to propose event changes.

### AI Event Copilot

The Copilot allows the events team to describe an operation in natural
language.

For example:

> "Move the KL AI & Data Career Fair to next Thursday afternoon."

The Copilot converts the request into a structured proposal and validates it
against the application's business rules.

**The Copilot does not automatically apply changes.** The user reviews the
proposal and must explicitly approve it. If conflicts are detected, the user
must acknowledge them before applying the change.

---

## Key capabilities

### Multi-day events

Multi-day events use daily operating hours.

For example:

**10–12 October 2026**  
**10:00 AM–5:00 PM each day**

is represented as three daily occurrences rather than one continuous event.

This allows conflict detection to reason about each day's actual operating
hours.

### Capacity management

Registrations are checked against event capacity, including concurrent
registration attempts.

### Audience restrictions

Events can be configured as:

- Candidates only
- Employers only
- Open to everyone

Audience restrictions are enforced through the registration flow rather than
being purely cosmetic UI settings.

### Conflict detection

Scheduling changes are checked against existing events. Potential conflicts
are surfaced to the events team before a change is applied.

### Audit history

Important event changes are recorded so the team can see what happened and
whether an operation came from a manual action or the Copilot.

---

# Reviewing the live demo

The recommended review flow is:

1. Open the **Live Demo** above.
2. Browse the public calendar.
3. Open a multi-day event.
4. Check its daily hours and capacity.
5. Open an event registration page.
6. Test the candidate/employer audience restriction.
7. Open the admin login.
8. Review an event.
9. Try the move/reschedule workflow.
10. Open the AI Copilot.
11. Ask it to create or move an event.
12. Review the proposed change and any conflicts.
13. Confirm that changes require explicit user approval.

---

# Running locally

The live Vercel deployment is the easiest way to review the prototype.

The repository can also be run locally if you want to inspect the implementation
or reproduce the environment.

## Requirements

- Node.js 20+
- npm 10+
- Git
- A Supabase project
- A Gemini API key if you want to use the AI Copilot

## Installation

Clone the repository and enter the project:

```bash
git clone <https://github.com/SyukranSJ/talentbank-career-fair-os.git>
cd Talent
