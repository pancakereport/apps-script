// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Test SIDs', 'testSIDs')
    .addSeparator()
    .addItem('Run All SIDs', 'runSIDs')
    .addToUi();
}

function testSIDs() {
  Logger.log("Gathering Data for SIDs on Sheet 'Test SIDs.'");
  const sids = readSIDs("Test SIDs", verbose = true);
  for (const sid of sids) {
    fetchEnrollmentData(sid, verbose = true);
  }
}

// read in SIDs
function readSIDs(sidSheetName, verbose = false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sidSheet = ss.getSheetByName(sidSheetName); 
  if (!sidSheet) {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Configuration Error', `The sheet '${sidSheetName}' is missing.`, ui.ButtonSet.OK);
    throw new Error(`Sheet with SIDs not found. Ensure that a sheet called '${sidSheetName}' exists`);
  }
  const data = sidSheet.getDataRange().getValues();
  if (data.length < 2) {
    throw new Error(`The sheet '${sidSheetName}' appears to be empty or only contains headers.`);
  }
  const headers = data[0];
  const sidColumnIndex = headers.map(h => h.toString().toUpperCase()).indexOf("SID");
  if (sidColumnIndex === -1) {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Missing Column', 'Could not find a column titled "SID".', ui.ButtonSet.OK);
    throw new Error('Column "SID" not found.');
  }
  const sids = data.slice(1).map(row => row[sidColumnIndex]);
  if (verbose) {
    Logger.log(`Found ${sids.length} SIDs.`);
  }
  return sids;
}

// get grades and an imperfect measure of if R&C taken
function fetchEnrollmentData(studentId, verbose = false) {
  if (!studentId) {
    Logger.log("You appear to have passed in an empty SID (enrollment API). Further investigation may be needed.")
    return null;
  }
  const url = `https://gateway.api.berkeley.edu/uat/sis/v3/enrollments/students/${studentId}?primary-only=true&enrolled-only=true`;
  const scriptProps = PropertiesService.getScriptProperties();
  const app_id = scriptProps.getProperty('APP_ID_ENROLLMENT');
  const app_key = scriptProps.getProperty('APP_KEY_ENROLLMENT');
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
      // Imperfect check for if student completed a R&C course
      const resultMapping = {
        "Taken R&C": enrollments.some(e => e?.classSection?.class?.course?.catalogNumber?.prefix === "R")
      };
      // Group enrollments by Course Display Name 
      const coursesMap = {};
      enrollments.forEach(e => {
        const courseName = e?.classSection?.class?.course?.displayName;
        if (!courseName) return;
        
        if (!coursesMap[courseName]) coursesMap[courseName] = [];
        coursesMap[courseName].push({
          termId: parseInt(e?.classSection?.class?.session?.term?.id || 0),
          grade: e?.grades?.[0]?.mark || "N/A"
        });
      });

      // For each course, sort by termId (descending) and take the top 3
      // double check that termIds ARE ordered and that the largest numbers are the most recent
      Object.keys(coursesMap).forEach(courseName => {
        const sortedHistory = coursesMap[courseName].sort((a, b) => b.termId - a.termId);

        for (let i = 0; i < Math.min(sortedHistory.length, 3); i++) {
          const suffix = i + 1; // 1, 2, or 3
          const record = sortedHistory[i];
          
          resultMapping[`${courseName} Semester ${suffix}`] = record.termId;
          resultMapping[`${courseName} Grade ${suffix}`] = record.grade;
        }
      });

      if (verbose) {
        Logger.log(`Mapping for ${studentId}: ${JSON.stringify(resultMapping)}`);
      }
      return resultMapping;
    } else {
      Logger.log(`API Error for ${studentId}: HTTP ${responseCode}`);
      return null;
    }
  } catch (error) {
    Logger.log(`API Exception for ${studentId}: ${error.toString()}`);
    return null;
  }
}

// get admit term, gpa, and egt
function fetchStudentData(studentId, verbose = false) {
  if (!studentId) {
    Logger.log("You appear to have passed in an empty SID (student API). Further investigation may be needed.")
    return null;
  }
  // TODO URL
  const url = ``;
  const scriptProps = PropertiesService.getScriptProperties();
  const app_id = scriptProps.getProperty('APP_ID_STUDENT');
  const app_key = scriptProps.getProperty('APP_KEY_STUDENT');
  // REMOVE IN THE FUTURE
  if (app_id === app_key) {
    Logger.log("Student API app_id and app_key have not yet been added to the Script Properties");
    return;
  }
  const options = {
    'method': 'get',
    'headers': {
      'accept': 'application/json',
      'app_id': app_id,
      'app_key': app_key
    },
    'muteHttpExceptions': true
  };
}

