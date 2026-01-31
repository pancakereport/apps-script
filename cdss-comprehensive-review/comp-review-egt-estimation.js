// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Test Work So Far', 'fullFunction')
    .addToUi();
}

function fullFunction() {
  const dataMap = getInput(false);
  cleanCourses(dataMap);
  verifyInfo(dataMap);
  writeToSheet(dataMap, "Intermediate Processed Data");
}

/** Read the input data
 * Returns a map of {SID: { identifying_info: {col: val, ...}, 
 *                         course_info: {col: val, ...}}}
 * To be used by later functions
*/
function getInput(verbose=false) {
  // read data
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName("Input"); 
  const data = inputSheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);
  // rename headers
  const updatedHeaders = headers.map(header => {
    if (header === "Basic Info_4") return "SID";
    // rename Lower Division: "LD N: <Requirement>#X_1" -> "LD N Requirement course|grade|sem"
    const ldMatch = header.match(/^LD (\d+)[: \-]+(.+)#(\d+)_1/);
    if (ldMatch) {
      const ldNum = ldMatch[1];     
      const reqName = ldMatch[2].trim(); 
      const typeCode = ldMatch[3];  
      const suffix = typeCode === "1" ? "course" : typeCode === "2" ? "grade" : "sem";
      return `LD #${ldNum} ${reqName} ${suffix}`;
    }
    return header;
  });
  // list of headers to keep in identifying_info
  const keepHeaders = [
    "SID", "FY vs TR", "1st Sem", "1st Sem_5_TEXT", "EGT", "EGT_12_TEXT", 
    "Current College", "Current Major", "Change or Add", "CGPA",
    "Major Ranking_1", "Major Ranking_2", "Major Ranking_3"
  ];

  // SID Map with partitioned data - identifying data and data relating to courses
  const sidIndex = updatedHeaders.indexOf("SID");
  const dataMap = {};
  rows.forEach(row => {
    const sid = row[sidIndex];
    if (!sid) return; 
    dataMap[sid] = {
      identifying_info: {},
      course_info: {}
    };

    updatedHeaders.forEach((header, index) => {
      const val = row[index];
      if (header.includes("grade") || header.includes("sem") || header.includes("course")) {
        dataMap[sid].course_info[header] = val;
      } else if (keepHeaders.includes(header)){
        dataMap[sid].identifying_info[header] = val;
      }
    });
    // handle when response is "other" by filling in their text response
    const idInfo = dataMap[sid].identifying_info;
    if (/other/i.test(idInfo["1st Sem"])) {
      idInfo["1st Sem"] = idInfo["1st Sem_5_TEXT"];
    }
    delete idInfo["1st Sem_5_TEXT"]; 
    if (/other/i.test(idInfo["EGT"])) {
      idInfo["EGT"] = idInfo["EGT_12_TEXT"];
    }
    delete idInfo["EGT_12_TEXT"]; 
    // pivot Major Ranking
    const majorMap = {
      "Major Ranking_1": "Computer Science",
      "Major Ranking_2": "Data Science",
      "Major Ranking_3": "Statistics"
    };
    idInfo["First Choice Major"] = "";
    idInfo["Second Choice Major"] = "";
    idInfo["Third Choice Major"] = "";

    Object.keys(majorMap).forEach(rankKey => {
      const rankValue = idInfo[rankKey];
      const majorName = majorMap[rankKey];

      if (rankValue == 1) idInfo["First Choice Major"] = majorName;
      if (rankValue == 2) idInfo["Second Choice Major"] = majorName;
      if (rankValue == 3) idInfo["Third Choice Major"] = majorName;
      
      delete idInfo[rankKey];
    });
  });
  verbose && console.log(JSON.stringify(dataMap, null, 2));
  return dataMap;
}

function writeToSheet(dataMap, sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();

  const sids = Object.keys(dataMap);
  if (sids.length === 0) return;

  // get headers dynamically from the first student
  const sample = dataMap[sids[0]];
  const headers = [...Object.keys(sample.identifying_info), 
                   ...Object.keys(sample.course_info),
                   "Unable to Verify"];

  // dataMap -> 2D Array
  const rows = sids.map(sid => {
    const student = dataMap[sid];
    
    return headers.map(h => {
      // special case for verification
      if (h === "Unable to Verify") {
        const issues = student.unable_to_verify || [];
        return issues.join(", "); // Converts ["CGPA", "LD #10"] to "CGPA, LD #10"
      }
      // standard columns
      return student.identifying_info[h] ?? student.course_info[h] ?? "";
    });
  });

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

// clean course names 
function cleanCourses(dataMap) {
  const sids = Object.keys(dataMap);
  sids.forEach(sid => {
    const courseInfo = dataMap[sid].course_info;
    const courseColumns = Object.keys(courseInfo);
    courseColumns.forEach(colName => {
      // target "course" columns for LD 10 or Upper Div
      if (colName.includes("course")) {
        let rawValue = courseInfo[colName];
        if (!rawValue) return;

        // corresponding sem column
        const semColName = colName.replace("course", "sem");
        const semValue = courseInfo[semColName] || "";
        // leave alone if transfer mentioned
        if (/transfer/i.test(rawValue) || /transfer/i.test(semValue)) {
          return;
        }
        courseInfo[colName] = normalizeCourseName(rawValue);
      }
    });
  });
}

// helper function to get course names that will hopefully match with API
function normalizeCourseName(name) {
  // capitalize and trim
  let clean = name.toString().toUpperCase().trim();
  // "DATA/STAT" -> "DATA"
  clean = clean.replace(/^DATA\/STAT\s?/, "DATA ");
  clean = clean.replace(/^CS\/DATA\s?/, "DATA ");
  // in free response students might forget cross listed "C"
  clean = clean.replace(/^DATA\s?(?!C)(100|104|140)\b/, "DATA C$1");

  // collapse spaces in department 
  clean = clean.replace(/^([A-Z\s&]+?)(?=\s*[CWN]?\d)/, function(match) {
    return match.replace(/\s+/g, "");
  });

  // ensure space between department and number while accounting
  // for cross listed courses (C) and online (W) and summer session not equivalent (N)
  clean = clean.replace(/([A-Z]+)\s*([CWN]?\d[A-Z0-9]*).*/, "$1 $2");

  // common department shorthand
  const mapping = {
    "^CS\\b": "COMPSCI",
    "^COMP SCI\\b": "COMPSCI",
    "^EE\\b": "EECS",
    "^SOCIOLOGY\\b": "SOCIOL",
    "^STATISTICS\\b": "STAT",
    "^STATS\\b": "STAT",
    "^BIO\\b": "BIOLOGY",
    "^MATHEMATICS\\b": "MATH"
  };

  for (let pattern in mapping) {
    let re = new RegExp(pattern, "i");
    if (re.test(clean)) {
      clean = clean.replace(re, mapping[pattern]);
      break; 
    }
  }

  return clean;
}

// helper function: get grades to verify
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
      let resultMapping = {};
      // Start high to find the minimum term
      let minTerm = Infinity; 
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

// helper function: get gpa and egt to verify
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

// helper function that turns semester names to ids
function semToId(sem) {
  // split to into semester and year 
  sem = sem.split(" ");
  const semester = sem[0];
  const year = sem[1];
  const year_digits = year.split("")

  let semester_digit;
  if (/Spring/i.test(semester)) {
    semester_digit = "2";
  } else if (/Summer/i.test(semester)) {
    semester_digit = "5";
  } else if (/Fall/i.test(semester)) {
    semester_digit = "8";
  }

  id = year_digits[0] + year_digits[2] + year_digits[3] + semester_digit
  return id;
}

/** Verify information in dataMap
 * - 1st Sem
 * - EGT
 * - CGPA 
 * - (maybe) Current College
 * - (maybe) Current Major
 * - Flag ourses if any of course (including X, N, W, or some C),
 *   grade, or sem don't line up, excluding transfer courses and test scores.
 * 
 * Returns dataMap with a new key for each SID:
 * {SID: { identifying_info: {col: val, ...}, 
 *         course_info: {col: val, ...},
 *         unable_to_verify: [col1, col2, ...]}}
 */ 
function verifyInfo(dataMap, verbose = false) {
  const sids = Object.keys(dataMap);
  
  sids.forEach(sid => {
    dataMap[sid].unable_to_verify = [];
    
    // fetch API data
    const enrollmentTruth = fetchEnrollmentData(sid);
    const studentTruth = fetchStudentData(sid);

    if (!enrollmentTruth || !studentTruth) {
      dataMap[sid].unable_to_verify.push("Not able to verify anything");
      return;
    }

    const idInfo = dataMap[sid].identifying_info;
    const courseInfo = dataMap[sid].course_info;

    // VERIFY IDENTIFYING INFO
    if (semToId(idInfo["1st Sem"]) != enrollmentTruth["Admit Term"]) {
      verbose && Logger.log(`${sid} admit term: ${idInfo["1st Sem"]} which translates to ${semToId(idInfo["1st Sem"])} and doesn't match SIS ${enrollmentTruth["Admit Term"]}`);
      dataMap[sid].unable_to_verify.push("1st Sem");
    }

    if (semToId(idInfo["EGT"]) != studentTruth.egt) {
      verbose && Logger.log(`${sid} stated egt: ${idInfo["EGT"]} which translates to ${semToId(idInfo["EGT"])} and doesn't match SIS ${studentTruth.egt}`);
      dataMap[sid].unable_to_verify.push("EGT");
    }

    // GPA, allow for minor rounding differences
    const reportedGPA = parseFloat(idInfo["CGPA"]);
    const actualGPA = parseFloat(studentTruth.gpa);
    if (isNaN(reportedGPA) || Math.abs(reportedGPA - actualGPA) > 0.05) {
      verbose && Logger.log(`${sid} stated GPA ${reportedGPA} SIS states ${actualGPA}`)
      dataMap[sid].unable_to_verify.push("CGPA");
    }

    // VERIFY COURSE INFO
    Object.keys(courseInfo).forEach(colName => {
      if (colName.includes("grade")) {
        const gradeVal = courseInfo[colName];
        const baseReqName = colName.replace(" grade", "");
        const courseName = courseInfo[baseReqName + " course"];
        const semVal = courseInfo[baseReqName + " sem"];

        // SKIP if..
        // column grade or cem contains "transfer"
        // sem is "Test Score"
        // grade is "PL"
        const isTransfer = /transfer/i.test(courseName) || /transfer/i.test(semVal);
        if (gradeVal === "PL" || semVal === "Test Score" || isTransfer || !courseName) return;

        // compare against API
        const apiGradeKey = `${courseName} | 1 | 2 Grade`;
        const apiGrade = enrollmentTruth[apiGradeKey];

        // flag if API doesn't have the course OR grades don't match
        if (!apiGrade) {
          if (verbose) {
            Logger.log(`${sid} - enrollment from API:`);
            Logger.log(JSON.stringify(enrollmentTruth, null, 2));
            Logger.log(`${sid}: API doesn't have record of ${courseName} for requirement ${baseReqName}`)
          }
          dataMap[sid].unable_to_verify.push(baseReqName);
        } else if (apiGrade.toString().toUpperCase() !== gradeVal.toString().toUpperCase()) {
          if (verbose) {
            Logger.log(`${sid} - enrollment from API:`);
            Logger.log(JSON.stringify(enrollmentTruth, null, 2));
            Logger.log(`API (${apiGrade}) doesn't match student reported ${gradeVal}`)
          }
          dataMap[sid].unable_to_verify.push(baseReqName);
        }
      }
    });
  });

  return dataMap;
}
