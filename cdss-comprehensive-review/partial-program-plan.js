// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Create Program Plans', 'fullFunction')
    .addToUi();
}

function fullFunction() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("Fetching enrollment data and preparing sheets...", "Process Started", -1);

  try {
    const currSem = 2262;
    const csReqs = ["LD 1", "LD 2", "LD 4", "LD 6", "LD 7", "LD 8", "LD 9", "CS UD"];
    const dsReqs = ["LD 1", "LD 2", "LD 4", "LD 5", "LD 6", "LD 7", "LD 10", "DS UD"];
    const stReqs = ["LD 1", "LD 2", "LD 3", "LD 4", "LD 5", "ST UD"];
    const dataMap = getInput(csReqs, dsReqs, stReqs);
    const enrollmentTruth = fetchEnrollmentDataAllStudents(dataMap);
    const flaggedCurrentEnrollment = verifyCurrentEnrollmentAllStudents(dataMap, enrollmentTruth, currSem);
    const folderUrl = createFolderWriteToSheet(dataMap, enrollmentTruth, flaggedCurrentEnrollment, currSem, true);
    ss.toast("Success!", "Process Complete", 5);
    showFinishedModal(folderUrl);
    
  } catch (e) {
    ss.toast("An error occurred. Check logs.", "Error", 10);
    Logger.log("Critical Failure in fullFunction: " + e.toString());
    SpreadsheetApp.getUi().alert("Process failed: " + e.message);
  }
}

/** Read the input data
 * Returns a map of {SID: { SID: 1234, ResponseId: 2345,
 *                          cs: {semId1: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                               semId2: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                                ...},
 *                          ds: {semId1: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                               semId2: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                                ...},
 *                          st: {semId1: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                               semId2: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                                ...},
 *                          }}
 * To be used by later functions
 * */
function getInput(csReqs, dsReqs, stReqs, verbose=false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName("Input"); 
  const data = inputSheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);
  // track the 3 columns for a single requirement together
  const courseGroups = {}; 

  const updatedHeaders = headers.map((header, index) => {
    header = header.toString();
    if (header === "CS Ranking") return "rank_cs";
    if (header === "DS Ranking") return "rank_ds";
    if (header === "Stats Ranking") return "rank_st";

    const groupMatch = header.match(/^(LD|CS UD|DS UD|ST UD).*?#(\d+)/);

    if (groupMatch) {
      const prefix = groupMatch[1].trim(); 
      const reqNum = groupMatch[2]; 
      const groupKey = `${prefix} #${reqNum}`; // e.g. "CS UD #1"

      let suffix = "";
      if (header.toLowerCase().includes("course")) suffix = "course";
      else if (header.toLowerCase().includes("grade")) suffix = "grade";
      else if (header.toLowerCase().includes("sem")) suffix = "sem";

      if (suffix) {
        if (!courseGroups[groupKey]) courseGroups[groupKey] = {};
        courseGroups[groupKey][suffix] = index;
        return `${groupKey} ${suffix}`;
      }
    }
    return header;
  });

  const sidIndex = updatedHeaders.indexOf("SID");
  const respIdIndex = updatedHeaders.indexOf("ResponseId");
  const rankCsIndex = updatedHeaders.indexOf("rank_cs");
  const rankDsIndex = updatedHeaders.indexOf("rank_ds");
  const rankStIndex = updatedHeaders.indexOf("rank_st");
  const dataMap = {};

  // SID Map with SID, ResponseId, and course data partitioned by semester 
  rows.forEach(row => {
    const sid = row[sidIndex];
    if (!sid) return;

    // which major columns aren't empty?
    const appliedCS = row[rankCsIndex] !== "";
    const appliedDS = row[rankDsIndex] !== "";
    const appliedST = row[rankStIndex] !== "";

    dataMap[sid] = {
      SID: sid,
      ResponseId: row[respIdIndex],
    };

    if (appliedCS) dataMap[sid].cs = {};
    if (appliedDS) dataMap[sid].ds = {};
    if (appliedST) dataMap[sid].st = {};

    // process course groups
    Object.keys(courseGroups).forEach(groupKey => {
      const indices = courseGroups[groupKey];
      const course = row[indices.course];
      const grade = row[indices.grade];
      const sem = row[indices.sem];
      const semId = semShortToId(sem);

      if (course && grade && semId) {
        const cleanSemId = String(semId).trim();
        const normalizedCourse = normalizeCourseName(course);
        const courseData = { course: normalizedCourse, grade: grade };

        // helper: push course into the correct major bucket
        const addToMajor = (majorKey, reqList) => {
          // return early if they didn't apply to this major
          if (!dataMap[sid][majorKey]) return;
          // is the current groupKey (e.g., "LD 1") in the major's requirement list?
          const matchesReq = reqList.some(req => groupKey.startsWith(req));
          
          if (matchesReq) {
            if (!dataMap[sid][majorKey][cleanSemId]) {
              dataMap[sid][majorKey][cleanSemId] = [];
            }
            dataMap[sid][majorKey][cleanSemId].push(courseData);
          }
        };

        addToMajor('cs', csReqs);
        addToMajor('ds', dsReqs);
        addToMajor('st', stReqs);
      }
    });
  });

  verbose && console.log(JSON.stringify(dataMap, null, 2));
  return dataMap;
}

// helper function to get course names that will (mostly) match with API
function normalizeCourseName(name) {
  // capitalize and trim
  let clean = name.toString().toUpperCase().trim();
  clean = clean.replace(/[()]/g, ""); // remove parenthesis 
  clean = clean.replace(/^(DATA|CS|COMPSCI)\s?\/\s?(STAT|DATA)\s?/, "DATA ");
  // common department shorthand
  const mapping = {
    "^CS(?=\\b|\\d)": "COMPSCI",
    "^EE(?=\\b|\\d)": "EECS",
    "^SOCIOLOGY(?=\\b|\\d)": "SOCIOL",
    "^STATISTICS(?=\\b|\\d)": "STAT",
    "^STATS(?=\\b|\\d)": "STAT",
    "^ECO(?=\\b|\\d)": "ECON",
    "^BIO(?=\\b|\\d)": "BIOLOGY",
    "^MATHEMATICS(?=\\b|\\d)": "MATH",
    "^MCB(?=\\b|\\d)": "MCELLBI",
    "^CIV(?=\\b|\\d)": "CIVENG",
    "^PHIL(?=\\b|\\d)": "PHILOS",
  };
  for (let pattern in mapping) {
    let re = new RegExp(pattern, "i");
    if (re.test(clean)) {
      clean = clean.replace(re, mapping[pattern]);
      break; 
    }
  }

  // collapse spaces in multi-word departments (e.g., "IND ENG" -> "INDENG")
  // stop before hitting a digit OR a standalone [CNW] + digit
  clean = clean.replace(/^([A-Z\s&]+?)(?=\s*[CNW]?\s*\d)/, function(match) {
    return match.replace(/\s+/g, "");
  });

  // separate dept from num
  // capture: 1. dept, 2. optional Prefix (CNW), 3. num
  const parts = clean.match(/^([A-Z]{2,})\s*([CNW])?\s*(\d.*)$|^([A-Z])\s*([CNW])?\s*(\d.*)$/);
  
  if (parts) {
    // If it's a long dept name (like ECON), parts[1] is the name.
    // If it's a single-letter dept (not common here), parts[4] is the name.
    let dept = parts[1] || parts[4];
    let num = parts[3] || parts[6];
    return dept + " " + num;
  }

  return clean;
}

// grab student enrollment data in the same format returned by getInput()
function fetchEnrollmentDataSingleStudent(studentId, verbose = false) {
  if (!studentId) {
    Logger.log("You appear to have passed in an empty SID (student API). Further investigation may be needed.")
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
    if (responseCode === 200) {
      const json = JSON.parse(response.getContentText());

      const enrollments = json?.apiResponse?.response?.enrollmentsByStudent?.studentEnrollments || [];

      let studentSemesters = {};

      enrollments.forEach(e => {
        const semId = e?.classSection?.class?.session?.term?.id;
        const courseName = e?.classSection?.class?.course?.displayName;
        const grade = e?.grades?.[0]?.mark || "Enrolled";
        const units = e?.enrolledUnits?.taken || 0;

        if (!semId || !courseName) return;
        if (!studentSemesters[semId]) {
          studentSemesters[semId] = [];
        }
        studentSemesters[semId].push({
          course: courseName,
          grade: grade,
          units: units
        });
      });
      if (verbose) {
        Logger.log(`Student API response for ${studentId}: ` + JSON.stringify(studentSemesters, null, 2));
      }
      return studentSemesters;
    } else {
      Logger.log(`Enrollment API Error ${response.getResponseCode()} for ${studentId}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Enrollment API Exception for ${studentId}: ${error.toString()}`);
    return null;
  }
}

function fetchEnrollmentDataAllStudents(dataMap, verbose = false) {
  const sids = Object.keys(dataMap);
  const enrollmentTruth = {};
  sids.forEach(sid => {
    const enrollment = fetchEnrollmentDataSingleStudent(sid, verbose);
    enrollmentTruth[sid] = enrollment;
  });
  return enrollmentTruth;
}

function verifyCurrentEnrollmentSingleStudent(sid, dataMap, enrollmentTruth, currSem, verbose) {
  const studentData = dataMap[sid];
  const studentTruth = enrollmentTruth[sid]; 
  const unverifiedForThisStudent = [];

  // what the student claimed to take in currSem
  const coursesToVerify = studentData[currSem] || [];
  if (coursesToVerify.length === 0) return []; 

  // what the API says they are actually in for currSem
  const apiCourses = (studentTruth && studentTruth[currSem]) || [];

  coursesToVerify.forEach(courseObj => {
    const normalizedInputName = courseObj.course;
    
    // attempt to find a match from API
    const match = apiCourses.find(apiRecord => {
      const normalizedApiName = normalizeCourseName(apiRecord.course);
      return normalizedApiName === normalizedInputName || 
             normalizedApiName.includes(normalizedInputName) || 
             normalizedInputName.includes(normalizedApiName);
    });

    if (match) {
      courseObj.units = match.units;
    } else {
      unverifiedForThisStudent.push(normalizedInputName);

      if (verbose) {
        Logger.log(`${sid}: Unable to verify current enrollment for ${normalizedInputName}`);
      }
    }
  });
  return unverifiedForThisStudent;
}

function verifyCurrentEnrollmentAllStudents(dataMap, enrollmentTruth, currSem, verbose) {
  const discrepancies = {};
  const sids = Object.keys(dataMap);

  sids.forEach(sid => {
    const unverifiedCourses = verifyCurrentEnrollmentSingleStudent(sid, dataMap, enrollmentTruth, currSem, verbose);
    // only add student to the map if there are actually unverified courses
    if (unverifiedCourses.length > 0) {
      discrepancies[sid] = unverifiedCourses;
    }
  });
  return discrepancies;
}

// helper function that turns semester names
// like "Sp26" to ids
function semShortToId(sem) {
  const s = String(sem).toLowerCase().trim();

  // extract semester prefix and the year digits
  const match = s.match(/^(sp|su|fa)(\d{2})$/);
  if (!match) return sem;
  const prefix = match[1];
  const yearShort = match[2]; 
  let semester_digit;
  if (prefix === "sp") {
    semester_digit = "2";
  } else if (prefix === "su") {
    semester_digit = "5";
  } else if (prefix === "fa") {
    semester_digit = "8";
  }
  const id = "2" + yearShort + semester_digit;
  return Number(id);
}

// takes in a semester id and returns the plain English meaning
// or null if the semester id isn't 4 digits
function idToSem(id) {
  const idStr = String(id);
  const lastDigit = idStr.slice(-1);
  let sem;
  if (lastDigit == '2') {
    sem = "Spring";
  } else if (lastDigit == '5') {
    sem = "Summer";
  } else if (lastDigit == '8') {
    sem = "Fall";
  } else {
    return null;
  }
  const year = idStr[0] + "0" + idStr[1] + idStr[2]; // first digit, zero, second digit, third digit of id
  return sem + " " + year;
}

function writeToStudentSheet(newSheet, studentData, apiTruth, studentFlaggedCurrentEnrollment, currSem, verbose = false) {
  const copiedSheet = newSheet.getSheetByName("Program Plan");
  copiedSheet.getRange("A3:L100").clearContent();

  const majorPlanned = studentData.courses || {};
  const applicationKeys = Object.keys(majorPlanned);
  const apiKeys = (apiTruth) ? Object.keys(apiTruth) : [];
  
  // create a unique sorted list of all semester ids
  const rawSemesters = [...new Set([...applicationKeys, ...apiKeys])]
    .filter(key => idToSem(key) !== null)
    .sort((a, b) => Number(a) - Number(b));

  const firstSem = Number(rawSemesters[0]);
  const lastSem = Number(rawSemesters[rawSemesters.length - 1]);
  const allSemesters = [];

  // generate every semester ID ending in 2, 5, 8 between first and last
  for (let y = Math.floor(firstSem / 10); y <= Math.floor(lastSem / 10); y++) {
    [2, 5, 8].forEach(suffix => {
      const id = y * 10 + suffix;
      if (id >= firstSem && id <= lastSem) allSemesters.push(id);
    });
  }

  // group all semesters by academic year
  const yearsMap = {}; 
  allSemesters.forEach(key => {
    const semStr = idToSem(key);
    const [season, year] = semStr.split(" ");
    const acadYear = (season === 'Fall') ? Number(year) : Number(year) - 1;
    if (!yearsMap[acadYear]) yearsMap[acadYear] = [];
    yearsMap[acadYear].push(key);
  });

  const sortedYears = Object.keys(yearsMap).sort((a, b) => Number(a) - Number(b));

  copiedSheet.getRange("B1").setValue(studentData.ResponseId);

  const flagGrid = Array.from({length: 5}, () => [""]);

  if (studentFlaggedCurrentEnrollment && studentFlaggedCurrentEnrollment.length > 0) {
    studentFlaggedCurrentEnrollment.forEach((c, i) => { if (i < 5) flagGrid[i][0] = c; });
    copiedSheet.getRange(4, 13, 5, 1).setFontWeight("bold").setValues(flagGrid);
  } else {
    flagGrid[0][0] = "All courses listed on application verified";
    copiedSheet.getRange(4, 13, 5, 1).setFontWeight("normal").setValues(flagGrid);
  }

  let currentRowCursor = 3; // start writing at row 3 (dynamic after this)

  sortedYears.forEach((acadYear) => {
    const yearSemKeys = yearsMap[acadYear];
    let maxCoursesInThisYear = 5;

    // determine the height needed for this year's block
    yearSemKeys.forEach(key => {
      let dataCount = 0;
      if (Number(key) <= currSem) {
        dataCount = (apiTruth && apiTruth[key]) ? apiTruth[key].length : (majorPlanned[key] ? majorPlanned[key].length : 0);
      } else {
        dataCount = (majorPlanned[key]) ? majorPlanned[key].length : 0;
      }
      if (dataCount > maxCoursesInThisYear) maxCoursesInThisYear = dataCount;
    });

    // write the data
    yearSemKeys.forEach(key => {
      const semesterStr = idToSem(key);
      const [season] = semesterStr.split(" ");
      const colMap = { 'Fall': 1, 'Spring': 5, 'Summer': 9 }; // positions on the spreadsheet
      const col = colMap[season];

      if (col) {

        // write the semester header (e.g., "Fall 2025")
        copiedSheet.getRange(currentRowCursor, col).setFontWeight("bold").setFontSize(12).setValue(semesterStr);

        let activeData = (Number(key) <= currSem) 
          ? (apiTruth && apiTruth[key] ? apiTruth[key] : (majorPlanned[key] || []))
          : (majorPlanned[key] || []);

        // prepare grid
        const gridHeight = Math.max(activeData.length, 5);
        const outputGrid = Array.from({length: gridHeight}, () => ["", "", ""]);

        activeData.forEach((item, i) => {
          outputGrid[i] = [item.course || "", item.grade || "", item.units || ""];
        });

        const targetRange = copiedSheet.getRange(currentRowCursor + 1, col, gridHeight, 3);
        
        // formatting
        const formatSource = copiedSheet.getRange(4, col, 1, 3);
        formatSource.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

        // write the actual data (or 5 empty rows to clear template)
        targetRange.setValues(outputGrid);
      }
    });
    currentRowCursor += (maxCoursesInThisYear + 2);
  });
}

function createFolderWriteToSheet(dataMap, enrollmentTruth, flaggedCurrentEnrollment, currSem, verbose = false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const templateSheet = ss.getSheetByName("Template");
  if (!templateSheet) {
    throw new Error("Could not find a sheet named 'Template'");
  }

  const folderName = "Comprehensive Review 2026 Program Plans";
  const existingFolders = DriveApp.getFoldersByName(folderName);
  const targetFolder = existingFolders.hasNext() ? existingFolders.next() : DriveApp.createFolder(folderName);
  const targetUrl = targetFolder.getUrl();
  if (verbose) Logger.log("Target Folder URL: " + targetUrl);

  const majorConfig = [
    {key: 'cs', label: 'Computer Science'},
    {key: 'ds', label: 'Data Science'},
    {key: 'st', label: 'Statistics'}
  ];

  // OPTIMIZATION: index existing files once to avoid DriveApp calls in the loop
  const existingFilesMap = {};
  const files = targetFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    existingFilesMap[file.getName()] = file.getId();
  }

  const sids = Object.keys(dataMap);
  sids.forEach((sid, index) => {
    const studentData = dataMap[sid];
    const responseId = studentData.ResponseId;

    if (index % 10 === 0) {
      ss.toast(`Processing student ${index + 1} of ${sids.length}...`, "In Progress");
    }

    majorConfig.forEach(config => {
      // does this major exist for this student?
      if (studentData[config.key]) {
        const fileName = `${responseId} ${config.label} Program Plan`;
        
        const majorSpecificData = {
          ResponseId: responseId,
          SID: sid,
          courses: studentData[config.key]
        };

        let newFile;
        const existingFiles = targetFolder.getFilesByName(fileName);

        try {
          if (existingFilesMap[fileName]) {
            newSheet = SpreadsheetApp.open(existingFiles.next());
          } else {// if it doesn't exist, create it
            newSheet = SpreadsheetApp.create(fileName);
            const sheetFile = DriveApp.getFileById(newSheet.getId());
            const copiedSheet = templateSheet.copyTo(newSheet);
            copiedSheet.setName("Program Plan"); 
            const defaultSheet = newSheet.getSheetByName("Sheet1");
            if (defaultSheet) newSheet.deleteSheet(defaultSheet);
            sheetFile.moveTo(targetFolder);
            if (verbose) Logger.log("Created new sheet for " + responseId);
          }
          writeToStudentSheet(newSheet, majorSpecificData, enrollmentTruth[sid], flaggedCurrentEnrollment[sid], currSem, verbose);
        } catch (err) {
          Logger.log(`Failed to process SID ${sid}: ${err.message}`);
        }
      }
    });
    if (index % 10 === 0) {
      SpreadsheetApp.flush();
    }
  });
  return targetUrl;
}

function showFinishedModal(url) {
  const htmlOutput = HtmlService
    .createHtmlOutput(
      `<p>All program plans have been generated successfully.</p>
       <p><a href="${url}" target="_blank" style="font-family: sans-serif; color: #1155cc;">Click here to open the folder</a></p>
       <button onclick="google.script.host.close()" style="margin-top: 10px;">Close</button>`
    )
    .setWidth(350)
    .setHeight(150);
  
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Execution Complete');
}
