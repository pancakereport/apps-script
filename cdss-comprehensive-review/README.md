# Comprehensive Review Google Sheets

## Description of Scripts

* **Partial Program Plan:** Output a program plan that includes all future courses that the applicant lists on their comprehensive review application AND all courses the SIS API reports the applicant being enrolled in. Courses that the applicant says they are enrolled in for the current semester but that the API cannot find are flagged. 
* **Pull Transcript Grades:** Utilize the SIS API to pull all grades for comprehrensive review applicants.
* **Application Flags:** Identify and summarize important pieces of each comprehensive review application.

## Set Up Instructions
### Partial Program Plan
1. Upload the [template spreadsheet](partial-program-plan-template.xlsx) to Google Sheets. Ensure that the sheet is called "Template".
1. In the same spreadsheet, upload applicant responses to a separate sheet called "Input".
1. Place the [Apps Script](partial-program-plan.js) in the spreadsheet you've been working on. To access Apps Script, click Extensions -> Apps Script. 
1. While still in the Apps Script editor, add Script Properties for the Enrollment API app id and key in the project settings on the Apps Script page. They should be named `APP_ID_ENROLLMENT` and `APP_KEY_ENROLLMENT`.
1. Back on the spreadsheet, you can execute the script by clicking "Actions" => "Create Program Plans". The first time you run the script you will have to grant permissions. You must do so in order for the script to fully run. When the script completes, you will get a pop up with a link to the folder holding all of the program plans.