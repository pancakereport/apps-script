// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Test SIDs', 'testSIDs')
    .addToUi();
}

function testSIDs() {
  Logger.log("Gathering Data for SIDs on Sheet 'Test SIDs.'");
  const sids = readSIDs("Test SIDs", verbose = true);
  const sidMap = {};
  for (const sid of sids) {
    const enrollmentData = fetchEnrollmentData(sid, verbose = false);
    const studentData = fetchStudentData(sid, verbose = false);
    // flatten data from the two APIs
    sidMap[sid] = {

      ...enrollmentData,
      ...studentData
    };
  }
  Logger.log("SID Map: " + JSON.stringify(sidMap, null, 2));
  writeOutput(sidMap, "Test SIDs Output");
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
  const url = `https://gateway.api.berkeley.edu/sis/v3/enrollments/students/${studentId}?primary-only=true&enrolled-only=true`;
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
      // Start high to find the minimum term
      let minTerm = Infinity; 
      // Determine how many R&C courses a student has taken
      const resultMapping = {
        "Taken R&C": enrollments.filter(e => e?.classSection?.class?.course?.catalogNumber?.prefix === "R").length
      };
      // Group enrollments by Course Display Name 
      const coursesMap = {};
      enrollments.forEach(e => {
        const termId = parseInt(e?.classSection?.class?.session?.term?.id);
        const grade = e?.grades?.[0]?.mark;
        const courseName = e?.classSection?.class?.course?.displayName;

        // Update minTerm is grade exists
        if (termId && grade && termId < minTerm) {
          minTerm = termId;
        }

        if (!courseName) return;
        
        if (!coursesMap[courseName]) coursesMap[courseName] = [];
        coursesMap[courseName].push({
          termId: parseInt(termId || 0),
          grade: grade || "N/A"
        });
      });

      resultMapping["Admit Term"] = minTerm === Infinity ? "N/A" : minTerm;

      // For each course, sort by termId (descending) and take the top 3
      // double check that termIds ARE ordered and that the largest numbers are the most recent
      Object.keys(coursesMap).forEach(courseName => {
        const sortedHistory = coursesMap[courseName].sort((a, b) => b.termId - a.termId);

        for (let i = 0; i < Math.min(sortedHistory.length, 3); i++) {
          const suffix = i + 1; // 1, 2, or 3
          const record = sortedHistory[i];
          // Format: "COURSE NAME | Attempt Number | Field" 
          // used to sort alphanumerically so we always get course name, grade, then semester
          resultMapping[`${courseName} | ${suffix} | 1 Name`] = courseName;
          resultMapping[`${courseName} | ${suffix} | 3 Semester`] = record.termId;
          resultMapping[`${courseName} | ${suffix} | 2 Grade`] = record.grade;
        }
      });

      if (verbose) {
        Logger.log(`Mapping for ${studentId}: ` + JSON.stringify(resultMapping, null, 2));
      }
      return resultMapping;
    } else {
      Logger.log(`Enrollment API Error for ${studentId}: HTTP ${responseCode}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Enrollment API Exception for ${studentId}: ${error.toString()}`);
    return null;
  }
}

// get gpa, and egt
function fetchStudentData(studentId, verbose = false) {
  if (!studentId) {
    Logger.log("You appear to have passed in an empty SID (student API). Further investigation may be needed.")
    return null;
  }
  const url = `https://gateway.api.berkeley.edu/sis/v2/students/${studentId}?id-type=student-id&inc-acad=true&inc-cntc=false&inc-regs=false&inc-attr=false&inc-dmgr=false&inc-work=false&inc-dob=false&inc-gndr=false&affiliation-status=ALL&inc-completed-programs=true&inc-inactive-programs=true`;
  const scriptProps = PropertiesService.getScriptProperties();
  const app_id = scriptProps.getProperty('APP_ID_STUDENT');
  const app_key = scriptProps.getProperty('APP_KEY_STUDENT');
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
    if (responseCode === 200) {
      const json = JSON.parse(response.getContentText());
      const student = json.apiResponse.response;
      let studentData = {
        gpa: null,
        egt: null,
      };
      
      if (student.academicStatuses && Array.isArray(student.academicStatuses)) {
        const undergradCareer = student.academicStatuses.find(status => 
          status.studentCareer?.academicCareer?.code === "UGRD"
        );
        if (undergradCareer) {
          studentData.gpa = undergradCareer.cumulativeGPA?.average || null;
          // this may need to be double checked - doesn't work for silas's SID (but they're graduated so it's not the typical usecase)
          try {
            studentData.egt = undergradCareer.studentPlans[0].expectedGraduationTerm?.id || null;
          } catch (error) {       
          }
        }
      } else {
        Logger.log(`Could not find undergraduate enrollment for ${studentId}. 
        No GPA or EGT will berecorded.`)
      }
      if (verbose) {
        Logger.log(`Student API response for ${studentId}: ` + JSON.stringify(studentData, null, 2));
      }
      return studentData;
    } else {
      Logger.log(`Student API Error for ${studentId}: HTTP ${responseCode}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Student API Exception for ${studentId}: ${error.toString()}`);
    return null;
  }
}

// write output to sheet
function writeOutput(sidMap, outputSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let outputSheet = ss.getSheetByName(outputSheetName);
  if (outputSheet) {
    outputSheet.clear();
  } else {
    outputSheet = ss.insertSheet(outputSheetName);
  }
  // Identify all unique keys across all students
  const allKeys = new Set();
  const sids = Object.keys(sidMap);
  sids.forEach(sid => {
    Object.keys(sidMap[sid]).forEach(key => allKeys.add(key));
  });

  // Define priority headers and order remaining headers alphabetically
  const priorityHeaders = ["SID", "gpa", "Admit Term", "egt", "Taken R&C"];
  const otherHeaders = Array.from(allKeys)
    .filter(key => !priorityHeaders.includes(key))
    .sort();

  const finalHeaders = priorityHeaders.concat(otherHeaders);
  outputSheet.appendRow(finalHeaders);

  // Map sidMap data into rows based on finalHeaders
  const rows = sids.map(sid => {
    const studentData = sidMap[sid];
    return finalHeaders.map(header => {
      if (header === "SID") {
        return sid;
      }
      // Check if value exists, handle booleans for R&C Taken
      const val = studentData[header];
      if (val === undefined || val === null) return "";
      return val;
    });
  });
  // Write to the output sheet
  if (rows.length > 0) {
    const range = outputSheet.getRange(2, 1, rows.length, finalHeaders.length);
    // Create an array of formats for the header row
    // "@" is Plain Text, null is "Automatic/Default"
    const formats = [finalHeaders.map(header => {
      // anything that looks like a Semester ID should be plain text to prevent Date conversion
      if (header === "Admit Term" || header === "egt" || header.includes("Semester")) {
        return "@";
      }
      return null; 
    })];
    range.setValues(rows);
  }
  

  // Formatting: Bold headers and freeze top row
  outputSheet.getRange(1, 1, 1, finalHeaders.length).setFontWeight("bold");
  outputSheet.setFrozenRows(1);
}
