# Data Science Minor Review Google Sheets

When students apply to the data science minor, they fill out a Google Form with information about their progress towards the DS minor. This script verifies their reported progress, flags potential concerns for advisors, and pulls a student's EGT and registered majors from SIS. Potential concerns include taking both STAT 20 and ENGIN 7 and taking multiple upper division courses from their home (major) department. The second flag may be unreliable at this time. The script is currently unable to verify transfer courses.

## Set Up Instructions

1. An example of the form questions is found in `ds-minor-columns-example.xlsx` in the sheet titled "Form Responses 1." The other necessary sheet is "Process From Given Date" which holds the date to process applications from until present. Ensure the date in cell A1 is accurate.
1. Ensure the `ds-minor-review.js` script is in the Google Sheet you're working on and is linked to the form. To access Apps Script, click Extensions -> Apps Script. 
1. While in the Apps Script editor, you must add Script Properties for the SIS API keys. They should be named `APP_ID_ENROLLMENT`, `APP_KEY_ENROLLMENT`, `APP_ID_STUDENT`, and `APP_KEY_STUDENT`.
1. Back on the spreadsheet, you can execute the script by clicking "Actions" -> "Process Grades". The first time you run the script you will have to grant permissions. You must do so in order for the script to fully run. When the script completes, you will get a new sheet titled "Verification Outputs" which has all the pertinent information from the application and any potential concerns or discrepencies comparing to SIS.