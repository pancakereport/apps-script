# ASE Hiring Google Sheets

Academic student employees (ASEs) submit two applications: one on [ACG](https://deptapps.coe.berkeley.edu/) which is managed by CoE/EECS staff and a supplemental application on either Smartsheet or Google Sheets. The supplemental application includes short response questions and a top choice course preference. ACG accesses student grades from [SIS API](https://developers.api.berkeley.edu/) and provides them to reviewers, but does not make them available for download on Applicant List Reports (ALR).

This Apps Script combines information from the ALR, the supplemental application, and grade data from SIS and further creates sheets with proper sharing permissions for each course. 

## Set up Instructions
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
    a. generateReviewLinks
        i. Create a hidden sheet that includes the first six columns of ALR and the admin and instructor links to applications on ACG
    b. generateAdminSheet
        ii. Create the admin sheet (on the same spreadsheet that the ALR and Supplemental applications were uploaded to) that shows ACG admin and instructor links, all the ALR information, and the supplemental application for each student.
    c. generateInstructorSheets
        iii. Create a folder that contains a spreadsheet per course with columns identical to the admin sheet columns (with the exception of the admin link) with rows only for students who applied to that course. Folder is created in the same place in Google Drive as the spreadsheet you’re working from.
8. If one or both of the supplemental application or ALR has an automatic sync, you can add a trigger to update the admin sheet on regular intervals. In the Apps Script page, click "Triggers" from the LH menu. Add a trigger that runs the `checkAndUpdateSheets` function with a "Time driven" event source. Because the API calls take a few minutes to run, I don't recommend triggers more than hourly. You should have failure notifications happen immediately.