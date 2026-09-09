# Talk track: Credit 360 and Claude Cowork, 3 September 2026

Speaker: Fabian Goetzens, Accenture. Audience: not commercial bankers, not deeply technical.
Budget: 10 minutes on the clock, 5 minutes of questions after.

Two rules for the night.

**One: every banking word gets a plain-English clause the first time it is said, and never again.**
Nobody in that room should have to guess what a covenant is. Nobody should be told twice.

**Two: nothing on this stage is a mock.** The cockpit is a live artifact talking to a real
Salesforce org through connectors, and at the five minute mark it writes into that org in front of
the room, and then we open that org and look at what it wrote.

All figures below come from `knowledge/HARTWELL-DEMO-DOSSIER-20260903.md` (branch
`hartwell-perfect`), which is the single source of truth for this relationship. Where an older doc
disagrees, the dossier wins.

---

## The book, in one place, so you never have to hunt mid-sentence

| | |
|---|---|
| Client | Hartwell Precision Manufacturing LLC. Third-generation precision machining, Fort Wayne, Indiana. NAICS 332710. About 310 employees, two plants (Fort Wayne campus, Kokomo under expansion) |
| What they make | Close-tolerance CNC components for heavy truck drivetrain, medical device housings, aerospace fittings |
| Financials | Revenue $64.2M LTM to June 2026. EBITDA $5.2M, 8.1 percent margin. Volume up about 22 percent over three years against margin compression |
| **Relationship totals** | **$54.0M committed, $38.7M drawn, 71.7 percent utilised, across TWO packages** |
| The C&I package | `Hartwell Industrial C&I Credit Package`. Six booked facilities, $46.0M committed, $31.03M drawn. **This is the package the demo drives** |
| The six | $15M revolving line, $2.5M seasonal line, $8M equipment term, $12M construction, $5M purchase, $3.5M equipment term |
| Also on it | One unbooked $3M Equipment facility at stage Proposal. Not counted in exposure |
| The real estate package | Two booked facilities, $8.0M committed, $7.67M drawn: $6.5M owner-occupied CRE term, $1.5M equipment term |
| Grade | 4 on the relationship, affirmed at the annual review of 2026-07-15. Two facilities carry a 5 at facility level (construction, seasonal line), deliberately |
| Coverage | DSC 1.38x against a 1.25x covenant. Fixed charge coverage 1.22x against 1.15x |
| Covenants | Six, all compliant or in progress. Nothing breached |
| People | James Hartwell, owner, 100 percent member, unlimited personal guarantor across all eight booked facilities. Elena Hartwell, spouse, limited guarantor capped at $2M on the real estate package. Hartwell Logistics LLC, affiliate under common control, NOT a guarantor |
| The ask on the table | James emailed asking to take the $15M line to $20M |
| Org | `accenture-d8--bankinggpt.sandbox.my.salesforce.com` |
| Artifact | https://claude.ai/code/artifact/91b5e835-5536-4f23-950e-4cde7941cf7f |

### The six covenants, with the last test and the next date

| Covenant | Threshold | Last tested 2026-06-30 | Next due |
|---|---|---|---|
| Debt Service Coverage of Borrower | >= 1.25x | 1.38x, compliant | 2026-09-30 |
| Maximum Debt to Worth | <= 3.00x | 2.42x, compliant | 2026-09-30 |
| Minimum Liquidity | >= $5,000,000 | $6,800,000, compliant | 2026-09-30 |
| DSC with and without Distributions | >= 1.15x | 1.22x, compliant | 2026-09-30 |
| Accounts Receivable eligibility | >= 80% eligible | 84%, compliant | 2026-09-08 |
| Term Covenants (Kokomo certificate of occupancy) | one-off | not yet tested, in progress | 2026-11-01 |

### The one honest weak spot, if it comes up

The construction facility has $5.5M of allocated collateral against a $12.0M commitment, a 0.75
coverage ratio. Say it out loud rather than hiding it: it is the only red pixel on the page, and it
has a dated answer, which is the Kokomo certificate of occupancy tested 2026-11-01.

---

# 0:00 to 1:00 · The hook

**Screen:** the cockpit landing, Hartwell on the worklist. Do not click anything yet.

**Say, in this order, and then stop talking:**

> "A relationship manager is the banker who owns a company as a client. Today, to move one number
> on one loan, she opens five systems, types the same facts into every one of them, and waits about
> three weeks for a change everybody already agreed to in a five minute phone call.
>
> In the next nine minutes you are going to watch her talk to this client's whole book in plain
> English, and watch the system do the paperwork itself, inside the bank's own system of record."

**Two glosses to drop while you say it, one clause each, no more:**
- a *facility* is one loan or one line of credit; this client has eight of them.
- a *system of record* is the bank's official file. If it is not in there, it did not happen.

**So what:** the room now has the whole story in two sentences. Everything after this is proof.

---

# 1:00 to 7:30 · The demo

## Beat 1 · 1:00 to 1:25 · Open the room

**Do:** click **Hartwell**, then the **FAB** (the floating button, bottom right), then **Facility**.
Hartwell now carries two packages, so the greeting asks which one first. Pick **Hartwell Industrial
C&I Credit Package**.

**Appears:** the workroom opens already knowing the deal. $46.0M across the six booked facilities on
that package, a short line-item read of the covenant book, James's mail named with its route chip.
Nothing staged.

**Say, once, while it lands. Then be quiet, the streaming sentence is the moment:**

> "I have not told it anything. It read the relationship, the six facilities on this package, the
> covenant book and the client's email before it said hello."

**So what:** the assistant starts where the banker's brain already is. No search, no filters, no tab
hunting.

**Gloss:** a *covenant* is a promise in the loan agreement that the company keeps some financial
number in a safe range, and the bank checks it on a schedule.

**If someone calls out the total:** the relationship is $54.0M committed and $38.7M drawn across two
packages. This room is anchored on the C&I package, which is $46.0M of it. Both numbers are right,
they count different things.

---

## Beat 2 · 1:25 to 2:05 · The client's ask, in one line

**Do:** click the **$15M Line of Credit** chip. Then type, verbatim:

```
increase to 20M
```

**Appears:** one card on the manifest rail (the review list down the right hand side): $15M to $20M.
Confirm it. The settled row collapses. A coverage-thins advisory arrives as its own separate item.

**Say while the card lands:**

> "That is the client's email, turned into one staged change. Nothing has been written anywhere yet.
> And it just told me, without being asked, that another five million of commitment thins this
> client's coverage cushion. Their debt service coverage is 1.38 times against a covenant of 1.25."

**Then:** acknowledge the advisory. The chips stay.

**So what:** the machine is not just typing. It flagged the thing the banker is paid to notice,
before the banker asked.

**Gloss:** *coverage* is how much cash the company makes for every dollar of debt payment it owes.
Thinner is riskier.

---

## Beat 3 · 2:05 to 2:35 · The two questions the bank always asks next

**Appears:** the amortisation question glides up. Answer with the chips, or type:

```
240
```

then, for the first payment date:

```
October 1, 2026
```

**Say:**

> "It is not guessing at those. The bank's own system will not price a loan until it knows the
> repayment period and the first payment date, so it asks me exactly those two, in the bank's own
> words, and nothing else."

**So what:** this is the difference between a chatbot and a banking tool. The questions are the
bank's questions, in the bank's order.

**Gloss:** *amortisation* is how many months the repayment is spread over.

**Note:** the date chips are computed off the book's July date and may read wrong. Ignore them, tap
**Another date** and type the date.

---

## Beat 4 · 2:35 to 3:05 · The rate

**Appears:** three chips: `Hold 7.60% fixed, paid monthly`, `New all-in rate`, `Index + spread`.

**Do:** type, verbatim:

```
Yes, 7.25% all-in
```

**Appears:** the card shows 7.25%, and the package total on the card reads the **staged** total, not
today's.

**Say, and read the total off the screen rather than from memory:**

> "Look at the package total on that card. It is already showing me what this package becomes if I
> approve everything on this rail, not what it is today."

**So what:** the banker sees the consequence of the whole plan while she is still building it.

**Gloss:** an *all-in rate* is the single interest rate the client actually pays, everything
included.

---

## Beat 5 · 3:05 to 3:25 · The menu is the real records

**Do:** click the **+** in the composer. Scroll the list.

**Appears:** every action available on the $15M line, listed against this client's actual records:
Legal Entity, remove, the real parties on the file.

**Do:** pick one. The line lands in the composer with the placeholder already selected. Edit it,
send it.

**Say:**

> "For anyone who does not want to type: every possible action on every facility is a menu, and the
> options in it are this client's real records, not examples."

**So what:** the natural language is a shortcut, not a requirement. Nobody has to learn a magic
phrase.

---

## Beat 6 · 3:25 to 4:15 · A brand new loan, inside the same change

**Do:** type these lines one at a time, waiting for each card:

```
add a new 3M equipment loan with a 60 month term for CNC line expansion
```
(answer the amortisation chip, **Same as the term (60 months)**, then the first payment date,
**1 October 2026**)
```
add Elena Hartwell as limited guarantor on the new equipment loan
```
```
add a debt service coverage of borrower covenant of 1.30 on the new loan
```
```
add a 1% origination fee on the new equipment loan
```

**Appears:** a `$3MM Equipment` card on the rail, with the guarantor, the covenant and the fee
nested underneath it. On the covenant it offers three instruments, because this relationship already
runs a debt service coverage test at relationship level. Press **Create a new one on this facility**.

**Say, once, at the first card:**

> "That is not an edit to an existing loan. That is a brand new loan, being created inside the same
> approval. And I can hang a guarantor, a covenant and a fee onto a loan that does not exist yet."

**So what:** real client conversations are never one clean change. The tool takes the messy version.

**Gloss:** a *guarantor* is a person who promises to pay if the company cannot. *Limited* means
capped at an agreed amount. Elena Hartwell is already capped at two million on the other package.

---

## Beat 7 · 4:15 to 5:00 · Review, approve, execute. THE CLIMAX, PART ONE

**Do:** click **Review**. Read the plan read-back on screen out loud, fast.

**Appears:** the plan, grouped by facility. Commitment first inside the $15M line, then the rate,
then the amortisation, then the first payment. Then the new facility with its three riders
underneath it.

**Say, slowly. This is the sentence the whole night turns on:**

> "Everything you have watched me say has been staged, not saved. Nothing has touched the bank yet.
> This is the moment a human reads it and decides."

**Do:** Approve. Get the token. **Execute.**

**Appears:** the run goes. A new package version is created, with the six existing loans cloned onto
it plus the new equipment loan. A few seconds later a second line arrives: **"Purpose written"**.
Typical wall time at the connector is under a minute. If it runs long, the room says
**"Filing in progress, nCino is still writing."** and lands the card itself. See the fallbacks.

**Say while it runs:**

> "It is writing a new version of the credit package. The six existing loans are copied forward, the
> new one is added, and the old version stays exactly as it was, so the bank can always see what
> changed and when. Booking that version for approval is still the bank's own process, and it says
> so rather than pretending otherwise."

**So what:** three weeks, collapsed. And it is versioned, not overwritten.

**Gloss:** a *package* is the bundle of facilities the bank approves as one thing. A new *version* is
the bank's way of keeping history instead of erasing it.

---

## Beat 8 · 5:00 to 5:30 · Show nCino. THE CLIMAX, PART TWO

Do not skip this. Everything before it is a claim until this browser tab opens.

**Do:** switch to the Salesforce tab. Open the new package version by the id the run reported:

```
https://accenture-d8--bankinggpt.sandbox.my.salesforce.com/<the new package version id>
```

The record is named `Hartwell Precision Manufacturing LLC - <M/D/YYYY> - PP`.

**Point at these, in this order, and name each one out loud:**

1. **The package name and its date.** "This record did not exist ninety seconds ago."
2. **The loans related list: seven rows.** "Six clones of what was already there, plus one that is
   new."
3. **The new Equipment loan**, `... - Equipment - $3,000,000.00`. Open it. Point at:
   Amount `3,000,000` · Term `60` · Amortized Term Months `60` · First Payment Date `1 Oct 2026` ·
   Stage `Qualification` · Status `Open` · **Is Modification `false`** and no chain row on it.
4. **Its Legal Entities related list:** one row, Borrower, 100 percent.
5. **The Loan Detail child record:** Primary Loan Purpose reads `business_expansion`. Say: "I typed
   'CNC line expansion'. It read that onto the bank's own coded value, and it told me on the card
   that it had."
6. **Back on the original $15M Line of Credit:** still Booked, still Open, still $15,000,000,
   untouched.

**Say at the end:**

> "This is nCino, the system most commercial banks run their lending on. Not a copy, not a preview.
> Everything you watched staged in the assistant is now a record in here, and the previous version
> is still sitting intact beside it."

**So what:** it is real. That is the entire job of these thirty seconds.

**Gloss:** *nCino* is the lending software the bank runs on. It sits on Salesforce.

---

## Beat 9 · 5:30 to 6:15 · The relationship room

**Do:** reload the page. Open Hartwell, **FAB**, **Relationship**.

**Appears:** a greeting with the governance signal and six route chips, the sixth being
`Add a covenant or an asset`.

**Do:** click **Covenant review**.

**Appears:** all six covenants, Pending, with the next test dates 2026-09-30, 2026-09-08 and
2026-11-01. Each answered step leaves exactly one clean row behind.

**Say:**

> "The first room changes the loans. This room does the servicing work: the annual review, the
> covenant checks, the collateral revaluations, the risk grade. Same conversation, different job.
> And nothing here is breached. This is a performing borrower, which is the point: most of a
> banker's week is administrative, not a rescue."

**Do, ONE of these two, whichever the clock allows:**

```
add a Minimum Liquidity covenant of at least 2,000,000 tested quarterly from October 1
```
or
```
add a warehouse at 1400 Industrial Parkway, Fort Wayne, IN 46802 valued at 3.2M as collateral
```

**Appears:** it asks the type from the bank's own catalogue, then the operator and threshold in one
question, then the frequency, then the effective date against the real calendar. Approve, execute.
It lands on the relationship, with zero loan attachments.

**Say:**

> "Every option in that list came out of the bank's own configuration. I never got the chance to
> invent a value."

**So what:** the assistant is fenced by the bank's setup, not by its own imagination.

**Gloss:** *collateral* is the property the bank can take if the loan is not repaid.

---

## Beat 10 · 6:15 to 6:40 · The client page

**Do:** close the room. Walk four tabs, fast.

1. **Covenants:** one aligned row per covenant. Click one to see which facilities it touches.
2. **Exposure**, collateral block: type, sub-type, the address as the title. Click to see the
   pledges. Pledged value across the relationship is $46.1M, lendable $34.7M.
3. **Graph:** every party edge lands on the borrower. Point at **James Hartwell**, who reads
   `Owner · Guarantor · Unlimited` with his facility count. Hartwell Logistics is on the graph as a
   related party and is deliberately not a guarantor.
4. **Activity:** the email row. One line. `Open in workroom`.

**Say:**

> "And this is the read side. One person, one relationship, everything the bank knows about them,
> including the email that started tonight."

**So what:** the assistant is not a bolt-on chat box. It is the same surface the banker already
reads from.

---

## Beat 11 · 6:40 to 7:15 · Cowork, and where the work actually comes from

This is the "why Cowork" beat. Do it live.

**Do:** switch to Claude Cowork. Paste James's email (or a term sheet) into the chat. Then say:

```
open the modification
```

Or, verbatim, the line that is proven:

```
James also wants a 7-year term on the equipment loan and a DSC test at 1.30 on it, open the modification.
```

**Appears:** back in the cockpit, with no reload, a glass chip whispers in the corner of the FAB:
*"An intent for Hartwell from the mail of 26 Jul 2026 ... Open the modification?"*, with **Open** and
**Later**. Click **Open**. It flies to Hartwell, binds the modification route, and feeds the lines
into the room through the room's own composer.

**Say:**

> "Work does not start in a banking system. It starts in an email, a term sheet, a meeting note.
> Cowork reads the document, and the cockpit opens the right room with the work already typed into
> it. Same assistant, from the inbox all the way to the bank's system of record."

**So what:** this is the join. Nobody re-keys anything, at either end of the chain.

---

## Beat 12 · 7:15 to 7:30 · Any client, not just this one

**Do:** open the command palette. Type:

```
Open <any client name>
```

**Say:**

> "Hartwell is not hard-coded. Any relationship in the book, by name."

**So what:** it is a product, not a demo.

---

# 7:30 to 10:00 · The close

## 7:30 to 8:15 · Three benefits, in plain words

Say these three, in this order, and do not decorate them.

1. **Nobody re-keys anything.** The banker said it once, in the language she already speaks. The
   loan, the guarantor, the covenant, the fee and the purpose code all landed in the bank's system
   out of that one conversation.

2. **Every change is reviewed before it lands.** Everything sat on a rail as a staged card. A human
   read the plan and approved it. Until that click, the bank's records had not moved a byte.

3. **The audit trail writes itself.** A new package version, the old version intact beside it, the
   client's email attached to the relationship, every action logged with who ran it and when. Nobody
   has to remember to file anything, because the filing IS the work.

## 8:15 to 9:15 · Why Cowork (say it, do not slide it)

> "Three things join up here.
>
> The first is that the raw material of banking is language. Emails, term sheets, meeting notes,
> credit agreements. Cowork reads those, and hands the structured work to Credit 360 already framed.
>
> The second is that it is one assistant across the whole chain. The thing that read the email is
> the same thing that talks to the loan system. There is no handoff between two vendors, no export,
> no integration project sitting in the middle.
>
> The third is governance, and it is the one I would ask about if I were sitting where you are. The
> human approves. The system files. Nothing is written without a review. Everything the assistant is
> allowed to do is a specific, named tool the bank switched on, running under the logged in banker's
> own permissions. It cannot invent a value, because every option it offered came out of the bank's
> own configuration. And it cannot approve anything, because we did not give it a tool that
> approves."

## 9:15 to 9:45 · The honest limit, said before anyone asks

> "One limit, and I want to say it before you ask it. This drafts, and it files. It does not decide.
> Credit approval stays exactly where it is today, with the credit officer and the committee, under
> the bank's own lending authorities. What changes is that they get a complete, sourced, already
> filed package to decide on, instead of spending three weeks assembling one."

## 9:45 to 10:00 · The last line

> "Five systems and three weeks became one conversation and ninety seconds, and the bank's file is
> more complete at the end than it was at the start. Questions."

---

# Q&A prep

Five minutes, so six to eight of these actually get asked. Two to three sentences each. No hedging,
no jargon.

**1. How accurate is it? What stops it hallucinating a number?**
It does not generate the numbers. Every figure on that screen came back from a tool call against the
bank's records, and the staged changes are structured fields, not sentences. Where a figure cannot
be grounded in a record, the room says so out loud instead of filling the gap, and you saw it do
that when I asked for something no tool covers.

**2. What happens when it gets something wrong?**
You see it before it matters, because nothing is written until a human approves the plan. If a line
lands on the wrong facility you discard that card and say it again. If the bank's system refuses
something at execution it names exactly what it refused and leaves the rest of the plan untouched,
and because every change is a new version, the previous state is always still there.

**3. Is our data safe? Where does it go?**
It reaches the bank's systems through connectors the bank installs and controls, running under the
logged in banker's own permissions. She cannot see anything through the assistant that she could not
already see in Salesforce, and the same audit log that records her actions records its actions.

**4. Does this replace relationship managers?**
No. It removes the typing, not the judgement. The parts that are actually the job, reading a client,
pricing a risk, deciding whether to lend, are precisely the parts it does not do.

**5. What does nCino do, and what does the assistant do?**
nCino is the system of record. It owns the loans, the covenants, the collateral, the approval
workflow and the rules about what is legal to save. The assistant is how a human talks to it: it
drafts, it asks the bank's own questions in the bank's own order, and it files what the human
approves.

**6. How long does this take to set up?**
The connectors and the tool definitions are the work, and that is configuration rather than a
rebuild. Nothing you saw required changing nCino, changing the data model, or migrating anything.
This runs against a standard nCino org.

**7. What about our other systems? We are not on nCino.**
The pattern is the connector, not the vendor. There were three behind the glass tonight: nCino for
the records, Boom for the financial spreads, AFS for servicing. Another core system is another
connector, and the room in front of it does not change.

**8. Why not just use ChatGPT for this?**
A general assistant can write about a loan. It cannot create one, because it has no permissioned
route into the bank's system and no way to stage a change for a human to approve. What you watched
was not better prose, it was a governed write path with a human gate in the middle of it.

**9. What is Boom?**
Boom is the spreading tool, which is the bank's word for turning a client's financial statements
into a standard set of comparable lines and ratios. It is where the coverage and leverage numbers
come from. Here it is just another connector the assistant reads.

**10. Can it approve a loan?**
No, and that is deliberate. There is no tool in its hands that approves anything. Submitting a
package for approval is still nCino's own process, run by the people who hold the lending authority.
It gets the decision ready, it does not make it.

**11. (The sceptical banker) Our modifications are messier than that.**
Agreed, and that is why tonight's single plan carried a commitment change, a rate, an amortisation
term, a first payment date, a net new facility, a guarantor, a covenant and a fee, in one approval.
If a line is too messy to parse, it refuses it out loud rather than guessing at it.

**12. (The risk person) How do you prove what it did?**
The new package version, the cloned loans, the untouched prior version, and an action history per
account recording who ran what and when. The evidence is the records themselves, not a log the
assistant wrote about itself.

**13. (If a figure is challenged) Are those numbers real?**
Yes, and they are the same arithmetic seen twice. Debt service coverage reads 1.38 times in the
covenant record and 1.38 times built from the spread, EBITDA of $5.2M over debt service of $3.77M.
Same for leverage at 2.42 times and liquidity at $6.8M.

---

# Fallbacks

Read these before you go up. Say the line, keep moving, never narrate a problem.

**If the execute takes too long or looks like it timed out.**
The room handles this itself now, so let it. It prints one quiet line, **"Filing in progress, nCino
is still writing."**, then polls the action history every three seconds for up to ninety seconds and
lands the executed card on its own, with the ids and the nCino links, exactly as if it had answered
first time.

Say, calmly, over the top of it:
> "The bank's system is still writing. The cockpit polls and lands it."

**Never approve again.** There is no second approval, and the approve control stays sealed
throughout. If ninety seconds pass with the org still writing it says so honestly and offers a
**Check the filing** chip, which re-enters the wait. Click that, never Execute.

For your own nerve: the longest modification this org has ever recorded is 156 seconds, and the
median is under thirty. If it runs long, keep talking, or move to the relationship room and come
back. When the card lands, cut to the nCino tab.

**If the model is slow.**
The card is always instant; only the narration under it streams. If nothing at all lands after about
ten seconds with no card, restate the line naming the facility by name, or click that facility's chip
and say the short version. Do not repeat the long sentence.

**If a line lands on the wrong facility, or is misread.**
Discard the card, click that facility's own chip (for example `$15.0MM Line of Credit`), then say the
short instruction without naming the facility again.

**If consent dialogs appear.**
Allow them and say nothing. There is a one-time consent on the loading page itself, and a scope
dialog for the 28 Customer 360 tools, and neither asks twice in a session. If one appears mid demo
and the room notices, name it for what it is: the permission model doing exactly what you just
claimed it does.

**If the machine stutters or the glass drags.**
Command palette:
```
Glass: frost
```
and afterwards, back to:
```
Glass: liquid
```

**If anything looks stuck or wrong.**
Reload the page, reopen Hartwell, Facility Actions. That is always safe, it is a fresh room every
time. Never open a second room without reloading first, because it replays the first greeting.

**If the org refuses at Execute.**
Read its sentence out loud. It names exactly what it refused and confirms the rest of the plan is
untouched. Discard that entry and re-approve, or discard the plan and restart that piece.

**Three questions with prepared answers, if they come off the screen.**
- *"The tab says more facilities than the room does."* The relationship carries an unbooked $3M
  equipment proposal at stage Proposal. The room counts only booked facilities. Both numbers are
  right, they count different things.
- *"$46M or $54M?"* $54.0M committed across two packages, $38.7M drawn, 71.7 percent utilised. The
  room in the demo is anchored on the C&I package, which is $46.0M of that.
- *"Why can't you set the rate on a new facility?"* The bank's own new-facility tool takes product,
  amount, purpose and term, and has no pricing fields at all. That is the bank's configuration, not
  a limit of the room. Pricing lands afterwards through a modification.

**Do not, tonight.**
- Do not type the Minimum Liquidity removal on the $15M line expecting a card. On this book that
  covenant lives at relationship level with no loan attachment, so the honest answer is an answer,
  not a card. Use Accounts Receivable on the same line if you want to show a real exclusion card.
- Do not open a second room without reloading first.
- Do not claim any figure the screen is not showing. Read totals off the card.

---

# After the demo: the revert

Run this once you are off stage, so the book is clean for the next run.

```bash
read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"
export TOK INST
export NEW_PKG=<the new package version id the run reported>
export NEW_COVENANTS=<covenant id>[,<covenant id>...]
python3 knowledge/sf-build-v2/tools/revert-hartwell.py
python3 knowledge/sf-build-v2/tools/revert-finish.py
```

`NEW_COVENANTS` matters: a covenant a run mints lives on the ACCOUNT and survives a package revert
without it. The correct baseline afterwards on the C&I package is 1 package, 7 loans (six booked plus
the Proposal-stage `Equipment - $3,000,000.00` that predates this work), with the real estate package
untouched beside it.

---

# Sources

`knowledge/HARTWELL-DEMO-DOSSIER-20260903.md` (every figure; branch `hartwell-perfect`) ·
`knowledge/DEMO-SCRIPT-20260903-FINAL.md` (the click order) ·
`knowledge/DEMO-RUNBOOK-20260903.md` (the escape hatches and the two answers) ·
`knowledge/MOD-NEW-LOAN-DRIVE-20260903.md` (the verbatim lines, the nCino verification table, the
revert) · `design/proposals/intent-handoff-addendum.md` (the Cowork intent handoff) ·
`client-360/skills/credit-360-cockpit/SKILL.md` (the tool surface and the write discipline) ·
`knowledge/research/covenant-testing-20260902.md`, `collateral-valuation-20260902.md`,
`annual-review-and-risk-rating-20260902.md` (the nCino terms).
