// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('1. Update Links (Hidden)', 'generateReviewLinks')
    .addSeparator()
    .addItem('2. Update Admin Sheet', 'generateAdminSheet')
    .addSeparator()
    .addItem('3. Update Instructor Sheets', 'generateInstructorSheets')
    .addToUi();
}

// hourly updates to admin sheet (if supplemental application or ALR
// have an automatic sync)
function checkAndUpdateSheets() {
  Logger.log("Time-Driven check started.");
  try {
    Logger.log("Calling generateAdminSheet()...");
    generateAdminSheet();
    Logger.log("generateAdminSheet() complete.");

    Logger.log("Calling generateInstructorSheets()...");
    generateInstructorSheets();
    Logger.log("generateInstructorSheets() complete.");

  } catch (error) {
    Logger.log(`A TIME-DRIVEN error occurred: ${error.toString()}`);
  }
}

// add a trigger when there's automatic updates with ALR

// #################################
// ## CREATE LINKS AND HIDE SHEET ##
// #################################
function generateReviewLinks() {
  // sheets
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alr = ss.getSheetByName("ALR"); 
  const info  = ss.getSheetByName("Information");
  let links = ss.getSheetByName("Links");
  // create links sheet if it doesn't exist
  if (!links) {
    links = ss.insertSheet("Links");
  } else {
    links.clear();
  }
  if (!alr || !info) {
    Logger.log("Required sheet 'ALR' or 'Information' not found.");
    return; 
  }
  // ALR data
  const data = alr.getDataRange().getValues();
  const infoData = info.getDataRange().getValues();
  // ALR headers
  const headers = data[0];
  const applicantIdIndex = headers.indexOf("Applicant ID");
  const classIdIndex = headers.indexOf("Classes");
  // course names and ids
  const courseMap = new Map();
  for (let i = 1; i < infoData.length; i++) {
    const name = infoData[i][0]?.toString().trim();
    // assume that courseId always exists and that ta, tutor, or reader ids may not
    const courseId = infoData[i][1]; 
    const taId = infoData[i][5] || null; // column F
    const tutorId = infoData[i][6] || null; // column G
    const readerId = infoData[i][7] || null; // column H
    if (name && courseId) {
      courseMap.set(name, {"courseId": courseId, 
        "taId": taId, "tutorId": tutorId, "readerId": readerId} );
    }
  }
  // term
  const term = info.getRange(2, 4).getValue();
  // loop through ALR data and set review links
  links.getRange(1, 8).setValue("Instructor Links - TA");
  links.getRange(1, 9).setValue("Instructor Links - Tutor");
  links.getRange(1, 10).setValue("Instructor Links - Reader");
  links.getRange(1, 7).setValue("Admin Links")
  for (let i = 1; i < data.length; i++) {
    const applicantId = data[i][applicantIdIndex]; 
    const courseListRaw = data[i][classIdIndex];
    if (!applicantId || !courseListRaw) continue;

    // instructor links
    const courseNames = courseListRaw.toString().split(";").map(c => c.trim()).filter(Boolean);
    const instructorTaLinks = [];
    const instructorTutorLinks = [];
    const instructorReaderLinks = [];
    for (const courseName of courseNames) {
      const ids = courseMap.get(courseName);

      if (ids.taId) {
        const instructorURL = `https://deptapps.coe.berkeley.edu/ase/all/review/${ids.taId}/applicants/${applicantId}?term=${term}`;
        instructorTaLinks.push(instructorURL);
      } else {
        instructorTaLinks.push(`No TA positions for ${courseName}`);
      }
      if (ids.tutorId) {
        const instructorURL = `https://deptapps.coe.berkeley.edu/ase/all/review/${ids.tutorId}/applicants/${applicantId}?term=${term}`;
        instructorTutorLinks.push(instructorURL);
      } else {
        instructorTutorLinks.push(`No tutor positions for ${courseName}`);
      }
      if (ids.readerId) {
        const instructorURL = `https://deptapps.coe.berkeley.edu/ase/all/review/${ids.readerId}/applicants/${applicantId}?term=${term}`;
        instructorReaderLinks.push(instructorURL);
      } else {
        instructorReaderLinks.push(`No reader positions for ${courseName}`);
      }
    }
    
    const taOutput = instructorTaLinks.join('\n');
    links.getRange(i + 1, 8).setValue(taOutput); 
    const tutorOutput = instructorTutorLinks.join('\n');
    links.getRange(i + 1, 9).setValue(tutorOutput); 
    const readerOutput = instructorReaderLinks.join('\n');
    links.getRange(i + 1, 10).setValue(readerOutput);

    //admin links
    const adminURL = `https://deptapps.coe.berkeley.edu/ase/data/admin/applicants/${applicantId}`;
    links.getRange(i + 1, 7).setValue(adminURL); // column G = 7
  }

  // bring over ALR columns A-F for clarity
  const sourceRange = alr.getRange(1, 1, alr.getLastRow(), 6); // Rows 1 to lastRow, Columns 1 to 6 (A-F)
  sourceRange.copyTo(links.getRange('A1'));

  // hide sheet
  links.hideSheet();
}

// ######################
// ## HELPER FUNCTIONS ##
// ######################

// -------------------------
// ## CREATE FILTER VIEWS ##
// -------------------------
/**
 * Create a filter view using the Advanced Sheets API.
 * @param {string} spreadsheetId The ID of the instructor spreadsheet.
 * @param {number} sheetId The ID of the destination sheet within the spreadsheet.
 * @param {string} courseId The specific course code (e.g., "DATA C8") to filter by.
 * @param {number} prefColIndex The 0-indexed column position of the "Course Preference" column.
 * @param {number} numRows The number of rows in the data (including header).
 * @param {number} numCols The number of columns in the data.
 */
function createCourseFilterView(spreadsheetId, sheetId, courseId, prefColIndex, numRows, numCols) {
  // map courseIds to values in the Supplemental Application
  const idToSup = {
    "DATA 89": "Data 89: Mathematical and Graphical Foundations of Probability",
    "DATA C4AC": "Data C4AC: Data and Justice",
    "DATA C8": "Data C8: Foundations of Data Science",
    "DATA 36": "Data 36: Data Scholars Seminar (Foundations Workshop)",
    "DATA C88C": "Data C88C: Computational Structures in Data Science",
    "DATA C100": "Data C100/C200: Principles & Techniques of Data Science",
    "DATA C104": "Data C104: Human Contexts and Ethics of Data - DATA/History/STS",
    "DATA C140": "Data C140: Probability for Data Science",
    "DATA 188": "Data 188: Advanced Data Science Connector",
    "DATA C200": "Data C100/C200: Principles & Techniques of Data Science",
    "DATA 375": "Data 375: Professional Preparation: Teaching of Data Science"
  };
  const filterViewName = `${courseId} Top Choice`;
  const requests = [];

  // get the exact preference string from the map
  const exactFilterValue = idToSup[courseId];
  if (!exactFilterValue) {
    Logger.log(`ERROR: Could not find exact preference string for course ID: ${courseId}. Skipping filter creation.`);
    return; 
  }

  // delete filters if they already exist
  try {
    const spreadsheet = Sheets.Spreadsheets.get(spreadsheetId, { 
      fields: 'sheets(properties/sheetId,filterViews)',
    });
    const targetSheet = spreadsheet.sheets ? 
      spreadsheet.sheets.find(s => s.properties && s.properties.sheetId === sheetId) : null;

    if (targetSheet && targetSheet.filterViews) {
      const existingView = targetSheet.filterViews.find(v => v.title === filterViewName);
      if (existingView) {
        requests.push({
          deleteFilterView: { filterId: existingView.filterViewId }
        });
        Logger.log(`Found and marked existing filter '${filterViewName}' for deletion.`);
      }
    }
  } catch (e) {
    Logger.log(`Error checking for existing filter views (Ignored to proceed): ${e.toString()}`);
  }
  
  // create the filter view and add it to requests
  requests.push({
    addFilterView: {
      filter: {
        title: filterViewName,
        range: {
          sheetId: sheetId,
          startRowIndex: 0, 
          endRowIndex: numRows,    
          startColumnIndex: 0, 
          endColumnIndex: numCols 
        },
        filterSpecs: [{
          columnIndex: prefColIndex, 
          filterCriteria: {
            condition: {
              type: "TEXT_EQ", 
              values: [{
                userEnteredValue: exactFilterValue 
              }]
            }
          }
        }]
      }
    }
  });

  // execute requests (deletion if application and then creation)
  try {
    const response = Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
    const addReply = response.replies[requests.length - 1];
    const filterViewId = addReply.addFilterView.filter.filterViewId;
    Logger.log(`Created filter view for ${courseId}. FilterView ID: ${filterViewId}`);
  } catch (e) {
    Logger.log(`FATAL ERROR creating Filter View for ${courseId} (Sheet ID: ${sheetId}): ${e.toString()}`);
  }
}

// -----------------------
// ## API CALL FUNCTION ##
// -----------------------
/**
 * Fetches enrollment data from the Berkeley SIS API for a given student ID.
 * Extracts the Course Display Name and the Grade for all courses.
 * If multiple grades are found for the same course, they are combined with a comma (e.g., "grade1, grade2").
 * @param {string} studentId The student's ID.
 * @returns {Object<string, string>|null} A map of { "Course Name": "Grade(s)" }, or null on error.
 */
function fetchEnrollmentData(studentId) {
  if (!studentId) {
    return null;
  }
  // api information
  const url = `https://gateway.api.berkeley.edu/uat/sis/v3/enrollments/students/${studentId}?primary-only=true`;
  const SCRIPT_PROPS = PropertiesService.getScriptProperties();
  const app_id = SCRIPT_PROPS.getProperty('app_id');
  const app_key = SCRIPT_PROPS.getProperty('app_key');
  const options = {
    'method': 'get',
    'headers': {
      'accept': 'application/json',
      'app_id': app_id,
      'app_key': app_key
    },
    'muteHttpExceptions': true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    // if successful record the grade
    if (responseCode === 200) {
      const json = JSON.parse(response.getContentText());
      const enrollments = json?.apiResponse?.response?.enrollmentsByStudent?.studentEnrollments;
      // return empty map if no enrollment data
      if (!enrollments || enrollments.length === 0) {
        return {}; 
      }
      
      const gradeMap = {};
      for (const enrollment of enrollments) {
        // path to course name
        const courseName = enrollment?.classSection?.class?.course?.displayName;
        // path to grade
        const grades = enrollment?.grades;
        let grade;
        if (grades && grades.length > 0) {
          grade = grades.map(g => g?.mark || "N/A").join(', ');        
        } else {
          grade = "Taken, but no grade found"
        }
        if (courseName) {
          // check if courseName already exists in the map 
          // (multiple enrollments in that course are recorded)
          if (gradeMap[courseName]) {
            gradeMap[courseName] = `${gradeMap[courseName]}, ${grade}`;
          } else {
            gradeMap[courseName] = grade;
          }
        }
      }
      return gradeMap;
    } else {
      Logger.log(`API Error for ${studentId}: HTTP ${responseCode}`);
      return null;
    }
  } catch (error) {
    Logger.log(`API Exception for ${studentId}: ${error.toString()}`);
    return null;
  }
}

// #####################################
// ## CREATE AND FILL OUT ADMIN SHEET ##
// #####################################
function generateAdminSheet() {
  // sheets
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const alr = ss.getSheetByName("ALR"); 
  const links = ss.getSheetByName("Links"); 
  const sup = ss.getSheetByName("Supplemental"); 
  const info = ss.getSheetByName("Information");
  let adminSheet = ss.getSheetByName("Admin Sheet");
  if (!adminSheet) {
    adminSheet = ss.insertSheet("Admin Sheet");
  }

  const linksData = links.getRange(1, 1, links.getLastRow(), 10).getValues();
  // read a wide range to ensure all ALR columns are included, even if they are empty
  const alrData = alr.getRange(1, 7, alr.getLastRow(), 25).getValues(); 
  const supData = sup.getDataRange().getValues();
  
  if (linksData.length === 0 || alrData.length === 0 || supData.length === 0) {
      Logger.log("One or more required sheets are empty. Aborting.");
      adminSheet.getRange('A1').setValue("Data missing from Links, ALR, or Supplemental sheets.");
      return;
  }

  // header extraction and combination
  const linksHeaders = linksData[0];
  const alrHeaders = alrData[0];
  const supHeaders = supData[0];
  const combinedHeaders = [...linksHeaders, ...alrHeaders];
  
  // key indexing
  const adminStudentIdIndex = linksHeaders.indexOf("Student ID"); 
  const supSidIndex = supHeaders.indexOf("Student ID Number");
  if (adminStudentIdIndex === -1 || supSidIndex === -1) {
    Logger.log("Could not find required header columns (Student ID in ALR/Links or Student ID Number in Supplemental). Aborting.");
    return;
  }

  // supplemental column definition
  const duplicateCols = ["First Name", "Last Name", "Student ID Number", "Email Address", "Academic Career", "Expected Graduation Term"];
  const supplementalColumnsToFill = ["First Name", "Last Name", "Email Address", "Academic Career", "Expected Graduation Term", "Student ID Number", "Expected Graduation Term", "Course Preference"];

  // map sup column names to ALR/admin column names where they differ
  const colMap = {
      "First Name": "First name", 
      "Last Name": "Last name", 
      "Student ID Number": "Student ID", 
      "Expected Graduation Term": "Expected graduation", 
      "Academic Career": "Student group",
      "Email Address": "Email",
      "Course Preference": "Classes"
  };

  // supplemental header processing 
  const newHeaders = [];
  const supIndicesToKeep = [];
  for (let i = 0; i < supHeaders.length; i++) {
    if (!duplicateCols.includes(supHeaders[i])) {
      newHeaders.push(supHeaders[i]);
      supIndicesToKeep.push(i);
    }
  }
  const supplementalColCount = newHeaders.length;
  
  // mapping supplemental name to admin index
  const linksIndicesToFill = {};
  supplementalColumnsToFill.forEach(supColName => {
      // determine the admin sheet's column name
      // use the colMap if a mapping exists, otherwise use the supplemental name
      const adminColName = colMap[supColName] || supColName;
      const index = combinedHeaders.indexOf(adminColName);
      if (index !== -1) {
          linksIndicesToFill[supColName] = index;
      }
  });

  // supplemental data - keep track of both unique values not in ALR and all values
  const supMap = new Map();
  for (let i = 1; i < supData.length; i++) {
      const supRow = supData[i];
      const supKey = String(supRow[supSidIndex]).trim().toLowerCase(); 

      if (supKey) { 
          const uniqueSupData = supIndicesToKeep.map(index => supRow[index]);
          // data needed for the right join
          const fillInData = {};
          supplementalColumnsToFill.forEach(colName => {
              const index = supHeaders.indexOf(colName);
              if (index !== -1) {
                  fillInData[colName] = supRow[index];
              }
          });
          supMap.set(supKey, {
              unique: uniqueSupData,
              fill: fillInData
          });
      }
  }

  // join ALR and sup. also call the API
  const adminBaseData = [];
  const linksRowCount = linksData.length;
  const alrRowCount = alrData.length;
  
  // combine links and ALR data (skipping header row)
  for (let i = 1; i < linksRowCount; i++) {
    const linksRow = linksData[i];
    // pad alrRow if linksRow is longer than alrRow to avoid index errors on headers
    const alrRow = i < alrRowCount ? alrData[i] : new Array(alrHeaders.length).fill(''); 
    adminBaseData.push([...linksRow, ...alrRow]);
  }

  const apiGradeMap = new Map(); // Map: Student ID -> { "COURSE NAME": "GRADE" }
  const allEnrollmentCourses = new Set();
  const emptySupplementalRow = new Array(supplementalColCount).fill('No Supplemental Found'); 
  const adminBaseDataRecords = [];

  // process links/ALR data (left join) for API
  for (let i = 0; i < adminBaseData.length; i++) {
    const row = adminBaseData[i];
    const adminKey = String(row[adminStudentIdIndex]).trim().toLowerCase(); 
    
    // get all grades
    let enrollmentGrades = {};
    if (adminKey) {
        enrollmentGrades = fetchEnrollmentData(adminKey) || {};
        apiGradeMap.set(adminKey, enrollmentGrades);
        // collect all unique course names
        Object.keys(enrollmentGrades).forEach(course => allEnrollmentCourses.add(course));
    }
    
    const supRecord = supMap.get(adminKey);
    const supData = supRecord ? supRecord.unique : emptySupplementalRow;
    
    adminBaseDataRecords.push({
        row: row,
        supData: supData,
        adminKey: adminKey,
        isMatched: !!supRecord
    });
  }
  
  // unmatched supplemental data (right join remainder part) and API
  const linksAlrColCount = combinedHeaders.length;
  const unmatchedSupRecords = [];

  for (const [supKey, supRecord] of supMap.entries()) {
    if (!apiGradeMap.has(supKey)) { // only process keys not found in links/ALR data
        let enrollmentGrades = {};
        if (supKey) {
            enrollmentGrades = fetchEnrollmentData(supKey) || {};
            apiGradeMap.set(supKey, enrollmentGrades);
            Object.keys(enrollmentGrades).forEach(course => allEnrollmentCourses.add(course));
        }

        // build the links/ALR part of the row 
        const newLinksAlrRow = new Array(linksAlrColCount).fill('No ALR Found');
        
        // populate columns using the 'fill' data
        for (const [supColName, adminIndex] of Object.entries(linksIndicesToFill)) {
            let dataToInsert = supRecord.fill[supColName]; 
            // clean course preference data
            if (supColName === "Course Preference" && dataToInsert) {
              let cleanedData = String(dataToInsert).trim();
              let separatorIndex = -1;
              const slashIndex = cleanedData.indexOf('/');
              const colonIndex = cleanedData.indexOf(':');
              
              if (slashIndex !== -1) {
                  separatorIndex = slashIndex;
              } else if (colonIndex !== -1) {
                  separatorIndex = colonIndex;
              }
              if (separatorIndex !== -1) {
                  cleanedData = cleanedData.substring(0, separatorIndex).trim();
              }
              dataToInsert = cleanedData;
            }
            if (dataToInsert) { 
                 newLinksAlrRow[adminIndex] = dataToInsert;
            }
        }
        
        unmatchedSupRecords.push({
            row: newLinksAlrRow,
            supData: supRecord.unique,
            adminKey: supKey
        });
    }
  }
  
  // final construction of outputData
  const enrollmentHeaders = Array.from(allEnrollmentCourses).sort();
  const outputData = [];

  // helper function to append API data
  function appendApiData(key, gradeMap, headers) {
      const apiRow = [];
      const studentGrades = gradeMap.get(key) || {};
      for (const course of headers) {
          apiRow.push(studentGrades[course] || ""); // append grade or empty string
      }
      return apiRow;
  }

  // combine links/ALR records
  for (const record of adminBaseDataRecords) {
      const apiRow = appendApiData(record.adminKey, apiGradeMap, enrollmentHeaders);
      const finalRow = [...record.row, ...record.supData, ...apiRow];
      outputData.push(finalRow);
  }

  // combine unmatched supplemental records
  for (const record of unmatchedSupRecords) {
      const apiRow = appendApiData(record.adminKey, apiGradeMap, enrollmentHeaders);
      const finalRow = [...record.row, ...record.supData, ...apiRow];
      outputData.push(finalRow);
  }

  // write to admin sheet
  // in case the sheet is holding data from a previous run, clear it here.
  adminSheet.clear();
  const finalHeaders = [...combinedHeaders, ...newHeaders, ...enrollmentHeaders];
  adminSheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
  if (outputData.length > 0) {
    adminSheet.getRange(2, 1, outputData.length, finalHeaders.length).setValues(outputData);
  }

  // add filter views for each course
  const data = info.getDataRange().getValues().slice(1);
  const courses = data.map(d => d[0]);
  for (const course of courses) {
    createCourseFilterView(
      ss.getId(), 
      adminSheet.getSheetId(), 
      course, 
      finalHeaders.indexOf("Course Preference"), 
      outputData.length + 1, // account for header
      finalHeaders.length);
  }
}


// ###################################
// ## CREATE SHEETS FOR INSTRUCTORS ##
// ###################################
function generateInstructorSheets() {
  // course mappings for dynamic grade column selection
  const relevantCourses = {
    "DATA 89": ["MATH 1B", "MATH 52", "MATH 53", "DATA C88S", "DATA C140", "STAT 134"],
    "DATA C4AC": ["DATA C104", "DATA C4AC"],
    "DATA C8": ["DATA C8"],
    "DATA 36": ["DATA 36"],
    "DATA C88C": ["DATA C88C", "COMPSCI 10", "COMPSCI 61A", "ENGIN 7"],
    "DATA C100": ["DATA C8", "DATA C100", "DATA C200"],
    "DATA 101": ["DATA 101", "COMPSCI 61B", "COMPSCI 61BL", "COMPSCI 186"],
    "DATA C104": ["DATA C104", "DATA C4AC"],
    "DATA C140": ["DATA C88S", "DATA C140", "EECS 126", "INDENG 172", "STAT 134", "DATA C8"],
    "DATA 145": [],
    "DATA 188": ["DATA C100", "DATA C140", "COMPSCI 182", "COMPSCI C182", "DATA C182", "COMPSCI 189", "MATH 53", "EECS 127"],
    "DATA C200": ["DATA C8", "DATA C100", "DATA C200"],
    "DATA 375": ["DATA 375", "COMPSCI 370", "COMPSCI 375"]
  };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const adminSheet = ss.getSheetByName("Admin Sheet"); 
  const infoSheet = ss.getSheetByName("Information"); 
  // read in list of courses and share emails
  const data = infoSheet.getDataRange().getValues();
  const rows = data.slice(1);
  const courses = [];
  const shareEmails = [];
  rows.forEach(row => {
    courses.push(row[0]);
    const emails = (row[2] || '').split(',').map(e => e.trim()).filter(e => e);
    shareEmails.push(emails);
  });
  const semester = rows[0][4];

  // get information about current location
  const fileId = ss.getId();
  const file = DriveApp.getFileById(fileId);
  const folders = file.getParents();
  var parentFolder;
  if (folders.hasNext()) {
    parentFolder = folders.next();
  } else {
    throw new Error("Make sure you're running this script in the DSUS ASE Shared Drive");
  }
  // create folder if it doesn't exist
  const folderName = `ASE Applicant Sheets - Instructor View ${semester}`
  const subFolders = parentFolder.getFoldersByName(folderName);
  let instFolder;
  if (!subFolders.hasNext()) {
    instFolder = parentFolder.createFolder(folderName);
  } else {
    Logger.log("Instructor View folder already exists")
    instFolder = subFolders.next();
  }

  // read in application data from Admin Sheet
  const adminData = adminSheet.getDataRange().getValues();
  const headers = adminData[0];

  // indices of dynamic columns
  const classesIndex = headers.indexOf("Classes");
  const adminLinksIndex = headers.indexOf("Admin Links"); // drop this column from instructor sheets
  const taLinksIndex = headers.indexOf("Instructor Links - TA");
  const tutorLinksIndex = headers.indexOf("Instructor Links - Tutor");
  const readerLinksIndex = headers.indexOf("Instructor Links - Reader");

  if (classesIndex === -1 || taLinksIndex === -1 || tutorLinksIndex === -1 || readerLinksIndex === -1) {
    Logger.log("Missing one or more critical headers: Classes, TA Links, Tutor Links, or Reader Links. Aborting.");
    return;
  }

  // Define link columns and a placeholder part to check against
  const linkColumnDetails = [
    { index: taLinksIndex, header: "Instructor Links - TA", check: false, placeholder: "No TA positions" },
    { index: tutorLinksIndex, header: "Instructor Links - Tutor", check: false, placeholder: "No tutor positions" },
    { index: readerLinksIndex, header: "Instructor Links - Reader", check: false, placeholder: "No reader positions" }
  ];

  // pre-process headers for dynamic selection
  const fixedColumnCount = 45; // A (index 0) through AS (index 44)
  const adminApiHeaders = headers.slice(fixedColumnCount); // AT:end headers (grade columns)

  // iterate through courses
  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];

    // pre-filter admin data for the current course
    const courseAdminRecords = []; // stores { row: [], matchIndex: number }

    for (let j = 1; j < adminData.length; j++) {
        const row = adminData[j];
        const classesRaw = row[classesIndex];
        if (!classesRaw) continue;

        const classes = String(classesRaw).split(';').map(c => c.trim()).filter(Boolean);
        const matchIndex = classes.indexOf(course);

        if (matchIndex !== -1) {
            courseAdminRecords.push({ row: row, matchIndex: matchIndex });
        }
    }
    
    if (courseAdminRecords.length === 0) {
        Logger.log(`Skipping sheet creation for ${course}: No applicants found.`);
        continue;
    }

    // determine which link columns to keep
    // reset check status for the current course
    linkColumnDetails.forEach(d => d.check = false); 

    for (const record of courseAdminRecords) {
        for (const linkCol of linkColumnDetails) {
            const linkCellContent = record.row[linkCol.index];
            if (linkCellContent) {
                 const links = String(linkCellContent).split('\n');
                 const specificLink = links[record.matchIndex];
                 
                 // check if the specific link does NOT contain the placeholder (meaning it's a URL)
                 if (specificLink && !String(specificLink).toLowerCase().includes(linkCol.placeholder.toLowerCase())) {
                     linkCol.check = true;
                 }
            }
        }
    }

    // determine the set of columns to keep 
    const indicesToDrop = [];
    if (adminLinksIndex !== -1) indicesToDrop.push(adminLinksIndex); // Always drop Admin Links
    
    // add link column indices that failed the check
    linkColumnDetails.filter(d => !d.check).forEach(d => indicesToDrop.push(d.index));

    // get indices for all columns A:AS (0 to 44)
    const initialFixedIndices = Array.from({ length: fixedColumnCount }, (_, k) => k);

    // filter out all columns we decided to drop
    const fixedIndicesToKeep = initialFixedIndices.filter(index => !indicesToDrop.includes(index));

    // determine which API/Grade columns are relevant
    const courseCodesToMatch = relevantCourses[course] || [];
    const relevantApiIndices = []; // indices RELATIVE to adminApiHeaders (0, 1, 2...)
    for (let k = 0; k < adminApiHeaders.length; k++) {
        if (courseCodesToMatch.includes(adminApiHeaders[k])) {
            relevantApiIndices.push(k);
        }
    }
    const relevantApiHeaders = relevantApiIndices.map(index => adminApiHeaders[index]);

    // construct the final header array for the new sheet
    const finalFixedHeaders = fixedIndicesToKeep.map(index => headers[index]);
    const finalHeaders = [...finalFixedHeaders, ...relevantApiHeaders];
    
    // instructor sheet creation and prep 
    const newSpreadsheetName = `${semester} ${course} ASE Applicants - Instructor View`;
    let instSpreadsheet;
    if (instFolder.getFilesByName(newSpreadsheetName).hasNext()) {
      const file = instFolder.getFilesByName(newSpreadsheetName).next();
      instSpreadsheet = SpreadsheetApp.openById(file.getId());
      Logger.log(`${newSpreadsheetName} already exists. Clearing Data to Update...`);
      const sheetToClear = instSpreadsheet.getSheets()[0];
      sheetToClear.clearContents();
    } else {
      const newSpreadsheet = SpreadsheetApp.create(newSpreadsheetName);
      const file = DriveApp.getFileById(newSpreadsheet.getId());
      instFolder.addFile(file);
      instSpreadsheet = SpreadsheetApp.openById(file.getId());
      // add shareEmails
      try { 
        if (shareEmails[i] && shareEmails[i].length > 0) {
          for (const email of shareEmails[i]) {
            instSpreadsheet.addEditor(email);
          }
        }
      } catch (e) {
        Logger.log(`Error adding editors to ${newSpreadsheetName}: ${e.message}`);
      }
    }

    // loop through courseAdminRecords to construct final rows ---
    const destSheet = instSpreadsheet.getSheets()[0];
    const filteredData = [finalHeaders];

    for (const record of courseAdminRecords) {
        const originalRow = record.row;
        const matchIndex = record.matchIndex;
        
        // create a temporary row copy for processing the cell content
        const rowToProcess = [...originalRow];
        
        // update "Classes" column (keep only the matched class)
        try {
            const classes = String(rowToProcess[classesIndex]).split(';');
            rowToProcess[classesIndex] = classes[matchIndex].trim();
        } catch (e) {
            rowToProcess[classesIndex] = originalRow[classesIndex]; // keep original if issue
            Logger.log(`Error processing classes for applicant: ${e.message}`);
        }

        // update Link columns (keep only the matched link)
        for (const linkCol of linkColumnDetails) {
            const linkIndex = linkCol.index;
            const linkCellContent = rowToProcess[linkIndex];
            
            if (linkCellContent) {
                const links = String(linkCellContent).split('\n');
                // set the cell content to just the link relevant to this course
                rowToProcess[linkIndex] = links[matchIndex] ? links[matchIndex].trim() : ''; 
            } else {
                 rowToProcess[linkIndex] = ''; 
            }
        }

        // construct the new row by picking columns to keep
        
        // get the kept fixed/link part of the row
        let newRow = fixedIndicesToKeep.map(index => rowToProcess[index]);

        // get the dynamic API/Grade data
        const apiRow = rowToProcess.slice(fixedColumnCount); // AR onwards
        const relevantApiRow = relevantApiIndices.map(index => apiRow[index]); // select only relevant columns
        
        // combine the fixed and dynamic parts
        newRow = [...newRow, ...relevantApiRow];
        
        filteredData.push(newRow);
    }

    // write filteredData to sheet and create filter view 
    let numRows = 0;
    let numCols = 0;
    if (filteredData.length > 0) {
      numRows = filteredData.length;
      numCols = filteredData[0].length;
      destSheet.getRange(1, 1, numRows, numCols).setValues(filteredData);
    }
    // create filter view for applicants' top choice
    if (numRows > 1 && numCols > 0) {
      const prefColIndex = finalHeaders.indexOf("Course Preference"); 
      createCourseFilterView(
        instSpreadsheet.getId(), 
        destSheet.getSheetId(), 
        course, 
        prefColIndex,
        numRows,
        numCols
      );
    }
  }
}
