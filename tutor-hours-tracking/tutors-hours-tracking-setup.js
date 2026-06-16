/**
 * Reads semester information from the "Semester" sheet.
 * @return {Object.<string, *>} An object where keys are the configuration names (from column A)
 * and values are the corresponding configuration values (from column B).
 */
function getSemesterConfig() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Semester');
  const data = sheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const value = data[i][1];
    config[key] = value;
  }
  return config;
}

const config = getSemesterConfig();
const semester = config.semester;
const tutorHireFileID = config.tutorHireFileID;
const folder = config.folder;

/**
 * Reads course names, base sheet IDs, and share emails from the "Courses" sheet.
 * @return {Object} An object containing three arrays: courses, baseSheets, and shareEmails.
 */
function readCourseKeys() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Courses');
  const data = sheet.getDataRange().getValues(); 
  const rows = data.slice(1);  // remove the header row

  const courses = [];
  const baseSheets = [];
  const shareEmails = [];

  // loop through each row and populate the arrays
  rows.forEach(row => {
    courses.push(row[0].toUpperCase());
    baseSheets.push(row[1]);
    const emails = (row[2] || '').split(',').map(e => e.trim()).filter(e => e);
    shareEmails.push(emails);
  });

  return {
    courses,
    baseSheets,
    shareEmails
  };
}

const courseData = readCourseKeys();
if (courseData) {
  Logger.log('Courses: %s', courseData.courses.join(', '));
  Logger.log('Base Sheets: %s', courseData.baseSheets.join(', '));
  Logger.log('Share emails: %s', courseData.shareEmails.join(', '))
}

const courses = courseData.courses;
const baseSheets = courseData.baseSheets;
const shareEmails = courseData.shareEmails;

/**
 * Creates a new folder inside a specific parent folder in a Google Shared Drive.
 * Shares the newly created folder with a list of email addresses.
 * @param {string} parentFolderId The ID of the parent folder where the new folder will be created.
 * @param {string} newFolderName The name of the new folder to create.
 * @param {string[]} courseShareEmails An array of email addresses to share the folder with.
 * @return {GoogleAppsScript.Drive.Folder} The newly created folder object.
 */
function createFolderInSharedDrive(parentFolderId, newFolderName, courseShareEmails) {
  try {
    const parentFolder = DriveApp.getFolderById(parentFolderId);
    const newFolder = parentFolder.createFolder(newFolderName);

    Logger.log('Successfully created new folder "%s" (ID: %s)', newFolderName, newFolder.getId());

    if (courseShareEmails && courseShareEmails.length > 0) {
      Logger.log('Attempting to share folder "%s" with: %s', newFolderName, courseShareEmails.join(', '));
      courseShareEmails.forEach(email => {
        try {
          newFolder.addEditor(email);
          Logger.log('Successfully shared "%s" with %s (Editor)', newFolderName, email);
        } catch (shareError) {
          // warn if sharing with a specific email fails, but continue with others
          Logger.log('Warning: Could not share "%s" with %s. Error: %s', newFolderName, email, shareError.toString());
        }
      });
    } else {
      Logger.log('No email addresses provided for sharing the folder "%s".', newFolderName);
    }
    return newFolder;
  } catch (e) {
    Logger.log('Error creating or sharing folder: ' + e.toString());
    if (e.toString().includes("not found")) {
      throw new Error("Parent folder not found. Please check the ID.");
    }
    if (e.toString().includes("Permission denied")) {
      throw new Error("Permission denied. You do not have sufficient access to the parent folder.");
    }
    throw e; // re-throw the error if it's not a handled case.
  }
}


/**
 * For each course, call createFolderInSharedDrive to create a folder and share it.
 * @param {string} parentFolderId The ID of the parent folder where the new course folders will be created.
 * @param {string[]} courses An array of course names.
 * @param {string} semester The current semester to append to the folder names (e.g., "Fall 2025").
 * @param {string[][]} shareEmails A 2D array where each inner array contains email addresses
 * to share the corresponding course folder with.
 * @return {GoogleAppsScript.Drive.Folder[]} An array of the newly created folder objects.
 */
function createFoldersForCourses(parentFolderId, courses, semester, shareEmails) {
  const targetFolders = [];
  try {    
    if (courses.length !== shareEmails.length) {
      Logger.log('Warning: Mismatch between number of courses and share email lists. Some folders may not be shared correctly.');
    }

    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      // get the specific email list for this course, default to empty array if undefined
      const emailsForCourse = shareEmails[i] || []; 

      const courseFolderName = `${semester} ${course} Timesheets`;
      const parentFolder = DriveApp.getFolderById(parentFolderId);
      const folders = parentFolder.getFoldersByName(courseFolderName);

      let newFolder;

      if (folders.hasNext()) {
        Logger.log(`The folder "${courseFolderName}" already exists.`);
        newFolder = folders.next();
      } else {
        newFolder = createFolderInSharedDrive(parentFolderId, courseFolderName, emailsForCourse);
      }
      
      if (newFolder) {
        targetFolders.push(newFolder);
      }
    }
  } catch (e) {
    Logger.log('Error creating or sharing folders in batch: ' + e.toString());
    throw e; // re-throw the error to halt execution if something goes wrong.
  }
  Logger.log('Successfully created and attempted to share %d folders.', targetFolders.length);
  return targetFolders;
}


const targetFolders = createFoldersForCourses(folder, courses, semester, shareEmails);

function readTutorHiresCSV(fileID) {
  const file = DriveApp.getFileById(fileID);
  const csvData = file.getBlob().getDataAsString();
  const data = Utilities.parseCsv(csvData);  
  const rows = data.slice(1); // skip headers
  const tutorDataByCourse = {};

  rows.forEach(row => {
    const name = `${row[1]} ${row[2]}`; // First + space + Last
    const email = row[7]; // Column H
    const course = row[9].toUpperCase(); // Column J
    const maxHours = (row[12] / 100) * 40  // Column M

    if (!tutorDataByCourse[course]) {
      tutorDataByCourse[course] = [];
    }
    tutorDataByCourse[course].push({name, email, maxHours});
  });

  return tutorDataByCourse;
}

// This function creates a personalized copy of a "base" Google Sheet (e.g., a template timesheet) for a tutor and shares it
function copyHoursSheet(baseSheetID, targetFolderID, course, semester, name, email) {
  const baseSheet = DriveApp.getFileById(baseSheetID);
  const targetFolder = DriveApp.getFolderById(targetFolderID);
  var sheetName = `[${course} ${semester}] ${name} - Hours`;
  var copy; 

  if (!targetFolder.getFilesByName(sheetName).hasNext()) {
    Logger.log(`Sheet not found. Making a copy of base sheet for ${name}...`);
    copy = baseSheet.makeCopy(sheetName, targetFolder);
  } else {
    Logger.log(`Sheet already exists for ${name}. Skipping copy.`);
    copy = targetFolder.getFilesByName(sheetName).next();
  } 

  try { 
    // add tutor
    copy.addEditor(email);
    // skip adding shareEmails because they should have been added to the folder
  } catch (e) {
    Logger.log(`Error adding ${name} to their hours sheet: ${e.message}`);
  }

  Logger.log(`Successfully processed sheet for ${name}: ${copy.getUrl()}`);
}

/**
 * Applies conditional formatting rules to a specific row's "hours" data in a spreadsheet.
 * * The function creates two rules:
 * 1. Highlights cells with a value of 0 in light yellow (#FFF475).
 * 2. Highlights cells with a value greater than the maxHours threshold in light red (#F28B82).
 * * The target range (columns B through S or T) is determined by the course name.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object where the rules will be applied.
 * @param {number} row The 1-indexed row number containing the hours data.
 * @param {number} maxHours The maximum numeric value allowed before triggering the red highlight rule.
 * @param {number} numWeeks The total number of weeks detected from the base sheet. 
 * @return {void}
 */
function addHighlightingToHoursRow(sheet, row, maxHours, numWeeks) {
  const range = sheet.getRange(row, 2, 1, numWeeks);
  const rules = sheet.getConditionalFormatRules();

  // yellow for zero hours
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberEqualTo(0)
    .setBackground('#FFF475') 
    .setRanges([range])
    .build());

  // red for over the maxHours
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(maxHours)
    .setBackground('#F28B82')
    .setRanges([range])
    .build());

  sheet.setConditionalFormatRules(rules);
}

/**
 * Sets up the main "Admin Sheet" for a course, creating or updating "Main" and "Index" sheets,
 * and generating "shadow sheets" with IMPORTRANGE formulas for new tutors.
 *
 * It performs the following steps:
 * 1. Checks for and opens an existing Admin Sheet or creates a new one in the target folder.
 * 2. Ensures "Main" and "Index" sheets with proper headers exist.
 * 3. Iterates through the list of tutors, checking which ones are new.
 * 4. For new tutors, it finds their individual hours sheet file in the folder.
 * 5. Adds the new tutor's name and hours sheet link to the "Index" sheet.
 * 6. Creates a hidden "shadow sheet" for the tutor and applies an IMPORTRANGE formula
 * to pull all data from their individual hours sheet. It also authorizes the import.
 * 7. Adds the tutor's name to the "Main" sheet and populates the weekly hour columns
 * with formulas that reference the data in their shadow sheet.
 * 8. Applies conditional formatting to the tutor's row on the "Main" sheet using `addHighlightingToHoursRow`.
 *
 * @param {string} baseSheetID The ID of the base Google Sheet used as a template for individual tutor hours sheets.
 * @param {string} targetFolderID The ID of the Google Drive folder where the Admin Sheet and individual hours sheets reside.
 * @param {string} course The course code (e.g., 'DATA C104'). Used for naming and determining the number of weeks/columns.
 * @param {string} semester The current semester string (e.g., 'Fall 2025'). Used for sheet naming.
 * @param {Array<Object>} tutors An array of tutor objects, each containing the tutor's name and maximum allowed hours.
 * @param {string} tutors[].name The full name of the tutor.
 * @param {number} tutors[].maxHours The max hours threshold for conditional formatting.
 * @return {void}
 */
function setUpShadowSheetsAndIndex(baseSheetID,targetFolderID, course, semester, tutors) {
  const targetFolder = DriveApp.getFolderById(targetFolderID);
  const adminSheetName = `[${course} ${semester}] Tutor Hours Overview Admin Sheet`;

  // dynamically determine the number of weeks/columns from the base sheet
  let numWeeks = 0;
  try {
    const baseSpreadsheet = SpreadsheetApp.openById(baseSheetID);
    const baseSheet = baseSpreadsheet.getSheets()[0]; // Assumes the first sheet contains the schedule
    
    // fetch a reasonable upper limit for weeks instead of the whole sheet's width.
    // (30 is definitely more than the number of weeks we would have, and keeps the getValues call efficient)
    const MAX_POSSIBLE_WEEKS = 30; 
    const row2Values = baseSheet.getRange(2, 2, 1, MAX_POSSIBLE_WEEKS).getValues()[0];

    // find the index of the first cell that DOES NOT start with "week"
    const firstNonWeekIndex = row2Values.findIndex(val => 
      !String(val).trim().toLowerCase().startsWith("week")
    );

    // if a non-week cell was found, that index equals our number of weeks.
    // if all fetched cells were weeks, then the count is the max size (30)
    const numWeeks = firstNonWeekIndex !== -1 ? firstNonWeekIndex : MAX_POSSIBLE_WEEKS;

    Logger.log(`Detected ${numWeeks} weeks from the base sheet template.`);

  } catch (e) {
    Logger.log(`ERROR reading base sheet: ${e.message}. Defaulting to 18 weeks.`);
    numWeeks = 18; // safe fallback
  }

  // check if the admin sheet already exists
  const matchingFiles = targetFolder.getFilesByName(adminSheetName);
  let adminSpreadsheet;
  if (matchingFiles.hasNext()) {
    const existingFile = matchingFiles.next();
    Logger.log(`Admin sheet already exists: ${existingFile.getUrl()}`);
    adminSpreadsheet = SpreadsheetApp.openById(existingFile.getId());
  } else {
    Logger.log(`Admin sheet not found for ${course}. Creating a new one.`);
    const newSpreadsheet = SpreadsheetApp.create(adminSheetName);
    const file = DriveApp.getFileById(newSpreadsheet.getId());
    targetFolder.addFile(file);
    adminSpreadsheet = SpreadsheetApp.openById(newSpreadsheet.getId());

    // make "Main" and "Index" sheets
    const mainSheet = adminSpreadsheet.getActiveSheet();
    mainSheet.setName("Main");
    const indexSheet = adminSpreadsheet.insertSheet("Index");

    // dynamically set headers based on base sheet weeks (numWeeks)
    const headers = ["Name"];
    for (let i = 1; i <= numWeeks; i++) {
      headers.push("Week " + i);
    }
    mainSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    indexSheet.getRange("A1").setValue("Name");
    indexSheet.getRange("B1").setValue("Link to Hours Sheet");
    Logger.log("Created admin sheet for " + course + ": " + adminSpreadsheet.getUrl());
  }

  // get "Index" sheet or create if it doesn't exist (which would only happen if execution is interrupted)
  let indexSheet = adminSpreadsheet.getSheetByName("Index");
  if (!indexSheet) {
    indexSheet = adminSpreadsheet.insertSheet("Index");
    indexSheet.getRange("A1").setValue("Name");
    indexSheet.getRange("B1").setValue("Link to Hours Sheet");
  }

  let existingNames = new Set();

  const lastRowIndex = indexSheet.getLastRow();
  if (lastRowIndex >= 2) {
    const existingData = indexSheet.getRange(2, 1, lastRowIndex - 1, 1).getValues();
    existingNames = new Set(existingData.flat().filter(name => name));
  } else {
    Logger.log("Index sheet has no existing tutor entries.");
  }

  // track the row to write new entries
  let nextRow = indexSheet.getLastRow() + 1;

  const mainSheet = adminSpreadsheet.getSheetByName("Main");
  const mainStartRow = 2;

  // add missing tutors to Index and create shadow sheets
  const token = ScriptApp.getOAuthToken();
  for (let i = 0; i < tutors.length; i++) {
    const name = tutors[i].name;
    const maxHours = tutors[i].maxHours;

    if (existingNames.has(name)) {
      Logger.log(`Tutor ${name} already exists in the index. Skipping.`);
      continue;
    }

    const courseFolderFiles = targetFolder.getFilesByName(`[${course} ${semester}] ${name} - Hours`);
    if (!courseFolderFiles.hasNext()) {
      Logger.log(`No base sheet found for ${name}. Skipping.`);
      continue;
    }

    const file = courseFolderFiles.next();
    indexSheet.getRange(nextRow, 1).setValue(name);
    indexSheet.getRange(nextRow, 2).setValue(file.getUrl());
    Logger.log(`Added ${name} to index.`);
    nextRow++;

    // add shadow sheet
    let sheet = adminSpreadsheet.getSheetByName(name) || adminSpreadsheet.insertSheet(name);
    Logger.log(`Creating shadow sheet for ${name}`);
    if (sheet.getLastColumn() < 34) {
      sheet.insertColumns(1, 34 - sheet.getLastColumn()); // sheets must have at least 34 columns to import range
    }
    sheet.getRange(1, 1).setValue(`=IMPORTRANGE("${file.getUrl()}", "A1:AH")`);
    sheet.hideSheet();

    const url = `https://docs.google.com/spreadsheets/d/${adminSpreadsheet.getId()}/externaldata/addimportrangepermissions?donorDocId=${file.getId()}`;
    const params = {
      method: "post",
      headers: {
        Authorization: "Bearer " + token
      },
      muteHttpExceptions: true
    };
    UrlFetchApp.fetch(url, params);

    // check if the name already exists in Main sheet
    let existingMainNames = [];
    const lastRowMain = mainSheet.getLastRow();
    if (lastRowMain >= 2) {
      existingMainNames = mainSheet.getRange(mainStartRow, 1, lastRowMain - 1, 1).getValues().flat();
    } else {
      Logger.log("Main sheet is empty (no tutor rows yet).");
    }
    if (existingMainNames.includes(name)) {
      Logger.log(`Tutor ${name} already listed in Main sheet. Skipping.`);
      continue;
    }

    const row = mainSheet.getLastRow() + 1;
    mainSheet.getRange(row, 1).setValue(name);

    // dynamically set formulas for the detected number of weeks
    for (let week = 1; week <= numWeeks; week++) {
      const col = week + 1;
      const shadowColLetter = getColumnLetter(col); // Replaced hardcoded String.fromCharCode implementation
      const formula = `='${name}'!${shadowColLetter}4`;
      mainSheet.getRange(row, col).setFormula(formula);
    }

    addHighlightingToHoursRow(mainSheet, row, maxHours, numWeeks)
    Logger.log(`Added ${name} to Main sheet at row ${row}`);
  }
}

const tutorHireData = readTutorHiresCSV(tutorHireFileID);
Logger.log("=== Tutor Hire Data ===");
for (const course in tutorHireData) {
  Logger.log("Course: %s", course);
  const tutors = tutorHireData[course];
  
  if (!tutors || tutors.length === 0) {
    Logger.log("  No tutors assigned.");
    continue;
  }
  tutors.forEach((tutor, index) => {
    Logger.log("  %d. Name: %s | Email: %s", index + 1, tutor.name, tutor.email);
  });
}

Logger.log("=== END Tutor Hire Data END ===");

for (let i = 0; i < courses.length; i++) {
  const course = courses[i];
  const baseSheetID = baseSheets[i];
  const targetFolderID = targetFolders[i].getId();
  const courseShareEmails = shareEmails[i];
  const tutors = tutorHireData[course] || [];

  // Logger.log(`course: ${course} with baseSheet ${baseSheetID} in folder ${targetFolderID} with shareEmails ${courseShareEmails}`)

  if (tutors.length === 0) {
    Logger.log("No tutors found for course: " + course);
    continue;
  }

  tutors.forEach(tutor => {
    copyHoursSheet(baseSheetID, targetFolderID, course, semester, tutor.name, tutor.email);
  });

  setUpShadowSheetsAndIndex(baseSheetID, targetFolderID, course, semester, tutors, courseShareEmails);
}