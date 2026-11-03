# ASE Hiring Google Sheets

Academic student employees (ASEs) submit two applications: one on [ACG](https://deptapps.coe.berkeley.edu/) which is managed by CoE/EECS staff and a supplemental application on either Smartsheet or Google Sheets. The supplemental application includes short response questions and a top choice course preference. ACG accesses student grades from [SIS API](https://developers.api.berkeley.edu/) and provides them to reviewers, but does not make them available for download on Applicant List Reports (ALR).

This Apps Script combines information from the ALR, the supplemental application, and grade data from SIS and further creates sheets with proper sharing permissions for each course. 

## `combine-data.js` Set up Instructions
**Apps Script relies on the exact naming of sheets and expects a match between course naming in the Information sheet and ACG. Please be careful with how things are named and set up.**

1. Download Applicant List Report from ACG and upload to Google Sheets. Name the sheet “ALR”.
2. In the same Spreadsheet, create another sheet named “Information” with the following:
Column A: Course Names; Column B: Course IDs from ACG (used to construct instructor links); Column C: Emails of Instructors who will have “Instructor View Spreadsheets” shared with them; Column D: Term from ACG (used to construct instructor links); Column E: Semester (used to name folders and spreadsheets); Column F: ta job IDs from ACG; Column G: tutor job IDs from ACG; Column H: reader job IDs from ACG.
    ![sheet named “Information” with the following: Column A: Course Names; Column B: Course IDs from ACG; Column C: Emails of Instructors who will have “Instructor View Spreadsheets” shared with them; Column D: Term from ACG; Column E: Semester; Column F: ta job IDs from ACG; Column G: tutor job IDs from ACG; Column H: reader job IDs from ACG](images/information-sheet.png)
3. Upload or link Supplemental Application data to another sheet in the same Google Spreadsheet named “Supplemental”. You should now have the following sheets within one Google Sheet Document: "ALR," "Information," "Supplemental".
4. Place the [Apps Script](combine-data.js) in the spreadsheet you've been working on. To access Apps Script, click Extensions -> Apps Script. 
5. While still in the Apps Script editor, enable the Google Sheets API by clicking Services -> Add a Service. Choose "Google Sheets API" and click "Add".
6. You must also add Script Properties for the API app id and key in the project settings on the Apps Script page. They should be named `app_id` and `app_key`.
7. Execute functions one at a time and in this order. You might need to approve permissions before running functions.
   
    a. `generateReviewLinks`: Create a hidden sheet that includes the first six columns of ALR and the admin and instructor links to applications on ACG
   
    b. `generateAdminSheet`: Create the admin sheet (on the same spreadsheet that the ALR and Supplemental applications were uploaded to) that shows ACG admin and instructor links, all the ALR information, and the supplemental application for each student.
   
    c. `generateInstructorSheets`: Create a folder that contains a spreadsheet per course with columns identical to the admin sheet columns (with the exception of the admin link) with rows only for students who applied to that course. Folder is created in the same place in Google Drive as the spreadsheet you’re working from.
8. If one or both of the supplemental application or ALR has an automatic sync, you can add a trigger to update the admin sheet on regular intervals. In the Apps Script page, click "Triggers" from the LH menu. Add a trigger that runs the `checkAndUpdateSheets` function with a "Time driven" event source. Because the API calls take a few minutes to run, I don't recommend triggers more than hourly. You should have failure notifications happen immediately.

## About `verify-minimum-units.js` 

On a Google Sheet with a sheet titled "SID Input" containing at least a column for "Student ID" (but possibly all columns output on the Admin Sheet from `combine-data.js`), output a new sheet titled "Output" with the following columns
- First name
- Last name
- Email
- Student ID
- EGT
- Home College (does not appear to be available currently from Admin Sheet, closest is Major. Could be pulled with the [student api](https://developers.api.berkeley.edu/api/6) (requires additional credentials))
- Enrolled units
- Waitlisted units
- Total units
- Unit requirement met? (TRUE/FALSE, empty if Home College not found on "Minimum Units by College" sheet)
- RCL exempt? (TRUE/FALSE/empty)

"Unit requirement met?" compares the enrolled units (waitlisted units don't count) to the minimum units required by the hired applicant's home college. The minimum units according to college can be found on a sheet titled "Minimum Units by College" which has the columns "College" and "Units". If a student belongs to more than one college, the highest minimum applies.

"RCL exempt?" comes from an RCL exempt column in Input if there is one. You can also type TRUE/FALSE into Output directly, and reruns keep what you typed. If it's still blank, it's set to TRUE when the student's only Home College is CDSS ("Clg of Comp Data Sci & Society" or "College of Computing, Data Science & Society", see `RCL_EXEMPT_COLLEGES`) and their EGT is the term on "Semester Input".

To keep track of what term this should be run for, there is a "Semester Input" sheet. Cell A1 should have the term id. For Spring 2027, this would be 2227.

If the API 404s for a student, their unit counts should be -1

## `verify-minimum-units.js` Set up Instructions
**Apps Script relies on the exact naming of sheets and columns. Please be careful with how things are named and set up.**

1. Create a sheet named "SID Input" with a column titled "Student ID". You can also paste in the full Admin Sheet of hired applicants from `combine-data.js`. If they exist, "First name", "Last name", "Email", "Home College", and "RCL exempt?" columns are copied to the output (Supplemental names like "Student ID Number" and "Email Address" also work). If a student's "Home College" is blank or a placeholder like "N/A", it is looked up with the Student API instead. If the Student API doesn't return a college, the reason is shown in brackets in Home College, e.g. "[Student API: HTTP 403]". Home College is always shown on "Output", even if it doesn't match a college on "Minimum Units by College" (in which case "Unit requirement met?" is left blank). If name or email columns are missing or blank, they are filled in from the Enrollments API (lived name and primary email), except for students with no enrollment found (404). If the API doesn't return them either, you can type them into "Output" and reruns keep what you typed (unless the API returns them on a later run, which overwrites it). If the same Student ID appears on more than one row, each row appears in the output.
2. In the same Spreadsheet, create a sheet named "Semester Input" and put the SIS term id in cell A1. Term ids are 2 + the last two digits of the year + 2 for Spring, 5 for Summer, or 8 for Fall (e.g. Fall 2026 is 2268, Spring 2027 is 2272).
3. Create a sheet named "Minimum Units by College" with the columns "College" and "Units". College names are matched loosely (case, "College of", and "&" vs "and" are ignored), so "Letters & Science" matches "College of Letters and Science".
4. Place the [Apps Script](verify-minimum-units.js) in the spreadsheet. To access Apps Script, click Extensions -> Apps Script. 
5. Add Script Properties in the project settings on the Apps Script page:
   - `app_id` and `app_key`: Enrollments API credentials (the same ones used by `combine-data.js`).
   - `APP_ID_STUDENT` and `APP_KEY_STUDENT`: Student API credentials. Only needed if some students have a blank "Home College" on "SID Input". Without them, those students' Home College shows "[Student API: APP_ID_STUDENT / APP_KEY_STUDENT not set]" and "Unit requirement met?" is left blank.
6. Reload the spreadsheet and use the "Actions" menu. You might need to approve permissions the first time.

    a. `1. Verify Minimum Units` (`verifyMinimumUnits`): Create (or overwrite) the "Output" sheet. Units are blank if the API returned an error, and -1 if no enrollment was found (404). "Unit requirement met?" is blank if the student's college isn't on "Minimum Units by College". "RCL exempt?" can be edited directly on "Output"; reruns keep the values you entered (as do the "Notified" timestamps).

    b. `2. Email ASEs Not Meeting Requirement` (`emailUnmetRequirement`): After confirming, emails every student on "Output" where "Unit requirement met?" is FALSE, "RCL exempt?" is not TRUE, and "Notified" is empty, then records the send time in "Notified". To resend to a student, clear their "Notified" cell. Edit `EMAIL_SUBJECT` and `EMAIL_BODY` at the top of the script to change the message. See [Email functionality](#email-functionality) for details.

### How Home College is pulled from the Student API
The college has been read from the Student API (`academicStatuses[].studentPlans[]`, major plans only) in two ways:

1. **Previous:** `studentPlans[].academicProgram.academicGroup`. This path doesn't exist in the response (`academicProgram` is nested inside `academicPlan`), so the script fell back to the organization that owns the major, `academicPlan.ownedBy[].organization`. For undergrads this sometimes gave a major/department instead of a college (e.g. "Industrial Engineering and Operations Research" instead of "College of Engineering", or "Mathematics" instead of "Letters & Sciences"). For grad students, however, it correctly gave their college.
2. **Undergrad:** `studentPlans[].academicPlan.academicProgram.academicGroup`. This correctly gives the college for undergrads (e.g. "College of Engineering"), but grad students come back as "Graduate Division". 

The script now uses both ways. A plan counts as grad if its career is `GRAD` or its `academicGroup` is "Graduate Division".
- **Undergrad plans:** `academicGroup`, then `academicProgram.program`, then `academicPlan.ownedBy[].organization`.
- **Grad plans:** `academicPlan.ownedBy[].organization`, then `academicGroup` (unless it's Graduate Division), then `academicProgram.program`.

### Email functionality
Emails are only sent from **Actions -> 2. Email ASEs Not Meeting Requirement** (`emailUnmetRequirement`). Running "Verify Minimum Units" never sends anything.

Emails are sent with MailApp. YAMM is another alternative (and may require additional set up).

**Who gets emailed:** rows on "Output" where all of the following are true:
- "Unit requirement met?" is exactly FALSE (blank rows, e.g. lookup errors or colleges not on "Minimum Units by College", are skipped)
- "RCL exempt?" is not TRUE
- "Notified" is empty, so nobody is emailed twice

Rows that qualify but have no email address are skipped. Their Student IDs are written to the execution log and counted in the confirmation box. This mostly affects students with no enrollment found (404) when "SID Input" didn't have an email for them.

**Before sending:**
1. If nobody qualifies, you get "No students to email." and nothing happens.
2. It checks the account's remaining daily email quota (1,500 a day for Google Workspace accounts like Berkeley's) and stops if there isn't room for everyone.
3. A Yes/No box shows how many students will be emailed and how many will be skipped for missing an address. Nothing is sent unless you click Yes.

**Sending:**
- Each email goes to the "Email" column. That's the value from "SID Input" if there was one, otherwise the primary email from the Enrollments API (usually @berkeley.edu).
- It comes from the Google account that clicks the button, as plain text.
- The subject and body come from `EMAIL_SUBJECT` and `EMAIL_BODY` at the top of the script. These placeholders are filled in per student:
  - `{first}`: first name, or "there" if missing
  - `{units}`: enrolled units (a -1 from a 404 shows as 0)
  - `{minimum}`: the minimum for their college
  - `{college}`: their Home College
- After each successful send, the time is written into that row's "Notified" cell. If one send fails, it's logged and the rest continue.
- At the end you get "Sent X of Y emails."

**Reruns and resending:**
- Rerunning "Verify Minimum Units" keeps the "Notified" times (and "RCL exempt?" values) by Student ID, so clicking the email button again only reaches students who haven't been emailed yet, such as students newly below the minimum.
- If a student met the requirement on the last run but doesn't now, their "Notified" cell is cleared so they're emailed again.
- To email someone again, clear their "Notified" cell.
- Duplicate Student IDs share their "Notified" value after a rerun.

Ultimately, used in a process that checks whether the enrollment requirement has been met, and if not, be able to trigger an automated email to the impacted ASEs notifying them of their status. ("Automated" because the email goes out to all at once? OR "automated" once the script runs, the emails are automatically sent. Can also have emails being sent be its own button). 