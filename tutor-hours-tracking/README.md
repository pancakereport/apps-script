# Tutor hour tracking Google Sheets

Create and properly share Google Sheets with tutors to keep track of their weekly hours. Tutors can only view their individual sheet where they can log their hours for the week. Instructors will be able to view those individual sheets and also see a summary of all tutor hours tracking for their class on an admin sheet. The admin sheets all have color highlighting that is based on individual appointments according to ACG. If a tutor logs zero hours for a week, that cell will be yellow. If a tutor logs more hours than their appointment, that cell will be red.

## Set up Instructions

1. Download “Hire List” Report from ACG. Choose the right Term, “Tutor / UCS1” for the ASE Type, and set Final? to “Yes”.
1. Upload the hire list to DSUS ASE Shared Drive. Hold on to the share link for the uploaded file. To get the link, click the three dots on the right side of the screen next to the uploaded file. Select “Share” and then “Copy share link.”
1. Make a copy of the Set Up Tutor Timesheets file and fill out the variables. Making a copy of the file will also copy over the App Script. 
    a. Note 1: it will not rename the app script. I suggest renaming the app script to something like “tutor hours overall set up SEMESTER”
    b. Note 2: It is important that the individual sheets keep their names (“Semester” and “Courses”) and that the variable names are not edited; these are used by the script specifically.
1. Run the script from the new “Set Up Tutor Timesheets”
1. If there are any late hires, upload a new Hire List from ACG to the Shared Drive. Update the tutorHireFileID variable. Rerun the script. The script will skip over any tutors who already existed.



