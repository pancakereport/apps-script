// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Test Work So Far', 'fullFunction')
    .addToUi();
}

function fullFunction() {
  const currSem = 2262;
  const dataMap = getInput(false);
  cleanCourses(dataMap);
  verifyInfo(dataMap);
  studentPlanFlags(dataMap, currSem);
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

  // get headers dynamically considering all students
  const headerSet = new Set();
  sids.forEach(sid => {
    const student = dataMap[sid];
    Object.keys(student.identifying_info).forEach(k => headerSet.add(k));
    // add course info while excluding any column containing "units"
    Object.keys(student.course_info).forEach(k => {
      if (!k.toLowerCase().includes("units")) {
        headerSet.add(k);
      }
    });
    // Add specific calculated flags
    if (student.major_flags) {
      Object.keys(student.major_flags).forEach(k => {
        // If it's a problem_grades key, split it into two specific columns
        if (k.startsWith("problem_grades_")) {
          headerSet.add(`Flag: ${k} PNP`);
          headerSet.add(`Flag: ${k} Below C-`);
        } else {
          headerSet.add("Flag: " + k);
        }
      });
    }
  });

  const headers = Array.from(headerSet);
  headers.push("Predicted EGT Flags", "Unable to Verify");

  // dataMap -> 2D Array
  const rows = sids.map(sid => {
    const student = dataMap[sid];
    const flags = student.major_flags || {};
    
    return headers.map(h => {
      // special case for verification and egt flags
      if (h === "Unable to Verify") return (student.unable_to_verify || []).join(", ");
      if (h === "Predicted EGT Flags") return (student.predicted_egt_flags || []).join(", ");

      // major flags (prefixed with "Flag: " above)
      if (h.startsWith("Flag: ")) {
        const flagKey = h.replace("Flag: ", "");
        const val = flags[flagKey];
        // If the value is an object (like problem_grades), stringify it nicely
        if (typeof val === 'object' && val !== null) {
          return JSON.stringify(val); 
        }
        return val ?? "";
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
        const units = e?.enrolledUnits?.taken;

        // Update minTerm is grade exists
        if (termId && grade && termId < minTerm) {
          minTerm = termId;
        }

        if (!courseName) return;
        
        if (!coursesMap[courseName]) coursesMap[courseName] = [];
        coursesMap[courseName].push({
          termId: parseInt(termId || 0),
          grade: grade || "No Grade on SIS",
          units:  units || 0 
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
          resultMapping[`${courseName} | ${suffix} | 4 Semester`] = record.termId;
          resultMapping[`${courseName} | ${suffix} | 2 Grade`] = record.grade;
          resultMapping[`${courseName} | ${suffix} | 3 Units`] = record.units;
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
// also get termsInAttendance
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
        termsInAttendance: null
      };
      
      if (student.academicStatuses && Array.isArray(student.academicStatuses)) {
        const undergradCareer = student.academicStatuses.find(status => 
          status.studentCareer?.academicCareer?.code === "UGRD"
        );
        if (undergradCareer) {
          studentData.gpa = undergradCareer.cumulativeGPA?.average || null;
          studentData.termsInAttendance = undergradCareer.termsInAttendance || null;
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

// Helper to compare grades (A > B > C etc.)
function getHighestGrade(gradeList) {
  const points = { "A+": 4.0, "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7, "C+": 2.3, "C": 2.0, "C-": 1.7, "D+": 1.3, "D": 1.0, "D-": 0.7, "F": 0, "W": -1, "NP": -1, "I": -1, "P": -1};
  return gradeList.reduce((best, current) => {
    return (points[current] || 0) > (points[best] || 0) ? current : best;
  }, gradeList[0]);
}

/** Verify information in dataMap
 * - 1st Sem
 * - EGT
 * - CGPA 
 * - (TODO) Current College
 * - (TODO) Current Major
 * - Flag courses if any of course (including N, W, or some C),
 *   grade doesn't line up with SIS, excluding transfer courses and test scores.
 *   DOES NOT CHECK IF  SEMESTER LINES UP
 * 
 * Returns dataMap with a new key for each SID:
 * {SID: { identifying_info: {col: val, ...}, now including 1st Sem ID and termsInAttendance
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
    const firstSemId = semToId(idInfo["1st Sem"]);
    dataMap[sid].identifying_info["1st Sem ID"] = firstSemId;
    if (firstSemId != enrollmentTruth["Admit Term"]) {
      verbose && Logger.log(`${sid} admit term: ${idInfo["1st Sem"]} which translates to ${firstSemId} and doesn't match SIS ${enrollmentTruth["Admit Term"]}`);
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

    // add termsInAttendance to identifying info
    dataMap[sid].identifying_info['Terms in attendance'] = studentTruth.termsInAttendance;

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
        if (gradeVal === "PL" || semVal === "Test Score" || isTransfer || !courseName || courseName.toLowerCase() === "other") return;

        // try to find a grade match across attempts 1, 2, and 3
        let foundMatch = false;
        let possibleGradesFound = [];
        // loop through possible attempts
        for (let attempt = 1; attempt <= 3; attempt++) {
          // check standard name and fall program for freshman
          const variants = [
            { grade: `${courseName} | ${attempt} | 2 Grade`, units: `${courseName} | ${attempt} | 3 Units` },
            { grade: `X${courseName} | ${attempt} | 2 Grade`, units: `X${courseName} | ${attempt} | 3 Units` }
          ];

          for (const variant of variants) {
            const apiGrade = enrollmentTruth[variant.grade];
            if (apiGrade !== undefined && apiGrade !== null) {
              const formattedApiGrade = apiGrade.toString().toUpperCase();
              possibleGradesFound.push(formattedApiGrade);
              
              if (formattedApiGrade === gradeVal) {
                foundMatch = true;
                unitsFound = enrollmentTruth[variant.units] || 0;
                break; // inner loop (variants)
              }
            }
          }
          if (foundMatch) break; // outter loop (attempts)
        }

        // record units (0 if course not found)
        dataMap[sid].course_info[baseReqName + " units"] = unitsFound;

        // update dataMap based on findings
        if (!foundMatch) {
          if (verbose) {
            Logger.log(`${sid}: API doesn't have record of ${courseName} for requirement ${baseReqName}. 
              SIS saw: ${possibleGradesFound.join(', ') || 'Nothing'}`);
          }
          // course not found in SIS
          if (possibleGradesFound.length === 0) {
            dataMap[sid].course_info[colName] = "NA";
          // course found in SIS but grade didn't match student report
          } else {
            dataMap[sid].course_info[colName] = getHighestGrade(possibleGradesFound);
          }
          
          dataMap[sid].unable_to_verify.push(baseReqName);
        }
      }
    });
  });

  return dataMap;
}

// student plan includes summer term(s) or term(s) 
// after the EGT listed on the application
function predictedEgtFlags(idInfo, courseInfo) {
  const appEGT = parseInt(idInfo['EGT']);
  const retval = [];

  // identify all unique prefixes
  const prefixes = [...new Set(Object.keys(courseInfo).map(k => k.replace(/(sem|grade|course)$/i, "")))];

  // map prefixes to objects and filter for valid semester data
  const terms = prefixes.map(p => ({
    sem: parseInt(courseInfo[`${p}sem`]),
    grade: courseInfo[`${p}grade`]
  })).filter(t => !isNaN(t.sem));

  // check if summer term or term after EGT
  if (terms.some(t => t.sem % 10 === 5 && t.grade === "PL")) {
    retval.push("Summer");
  }
  if (!isNaN(appEGT) && terms.some(t => t.sem > appEGT)) {
    retval.push("Terms after application EGT");
  }
  return retval;
}

// checks for passing letter grades (or test scores) in
// LD 5 + (LD 1 | LD 2 | LD 6)
function meetsDSRequirementsBasic(courseInfo) {
  gradesNotAccepted = ["P", "NP", "PL", "D+", "D-", "D", "F", "NA"]
  if (gradesNotAccepted.includes(courseInfo["LD #5 DSc8/St20 grade"]) ) {
    return false;
  }
  if (courseInfo["LD #1 Calc 1 grade"] != "PL" && 
    !gradesNotAccepted.includes(courseInfo["LD #1 Calc 1 grade"])) {
    return true;
  } else if (courseInfo["LD #2 Calc 2 grade"] != "PL" && 
    !gradesNotAccepted.includes(courseInfo["LD #2 Calc 2 grade"])) {
    return true;
  } else if (courseInfo["LD #6 CS 61A grade"] != "PL" && 
    !gradesNotAccepted.includes(courseInfo["LD #6 CS 61A grade"])) {
      return true;
  } else {
    return false;
  }
}

function countReqDS(courseInfo, currSem) {
  const lower_div = ["LD #1", "LD #2", "LD #4", "LD #5", "LD #6", "LD #7", "LD #10"];
  const notLetterGrade = ["PL", "P", "NP", "NA"];
  let total = 0;

  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("course") && lower_div.some(req => colName.startsWith(req))) {
      const baseReqName = colName.replace(" course", "");
      const gradeVal = courseInfo[baseReqName + " grade"];
      const semVal = courseInfo[baseReqName + " sem"];
      
      if (semVal == currSem || !notLetterGrade.includes(gradeVal)) {
        total += 1
      }
    }
  });
  return total;
}

function meetsDSRequirements(idInfo, courseInfo, currSem) {
  if (!meetsDSRequirementsBasic(courseInfo)) return false;

  const isTransfer = idInfo["FY vs TR"];
  const termsInAttendance = idInfo["Terms in attendance"];
  const numCompleted = countReqDS(courseInfo, currSem);
  if (!isTransfer) { // first year admit
    if (termsInAttendance < 3) { // first year
      // basic + one additional course completed = 3 reqs
      return numCompleted >= 3;
    } else if (termsInAttendance < 5) { // second year
      // basic + three additional courses = 5 reqs
      return numCompleted >= 5;
    } else if (termsInAttendance < 7) { // third year
      // all reqs completed or in progress = 7 reqs
      return numCompleted == 7;
    } else if (termsInAttendance > 6) { // fourth year, beyond
      return `Too many terms in attendance (${termsInAttendance} terms)`;
    }
  } else { // transfer
    if (termsInAttendance == 6) { // new transfer
      if (numCompleted == 7) {
        return true;
      } else {
        return "Summer Course Required to complete LD req";
      }
    } else if (termsInAttendance == 7) { // continuing transfer
      return numCompleted == 7;
    } else if (termsInAttendance > 7) { // applying with 4+ semesters at UC Berkeley
      return  `Too many terms in attendance (${termsInAttendance} terms)`;
    } else { // this should never be reached, but just in case
      return "Something weird is happening with terms in attendance";
    }
  }
  return false;
}

// calculate GPA for courses in requirements
// if grade is not verified and SIS grade exists, use SIS grade
// if grade is not verified and no SIS grade (gradeVal is NA), exclude requirement
// if transfer, exclude from major GPA calculation
function calculateMajorGPA(courseInfo, requirements) {
  const pointVals = {"A+": 4.0, "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7, "C+": 2.3, "C": 2.0, "C-": 1.7, "D+": 1.3, "D": 1.0, "D-":0.7, "F": 0};

  let totalGradePoints = 0;
  let earnedGradePoints = 0;

  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("grade") && requirements.some(req => colName.startsWith(req))) {
      const gradeVal = courseInfo[colName];
      const baseReqName = colName.replace(" grade", "");
      const unitsVal = courseInfo[baseReqName + " units"];
      const semVal = courseInfo[baseReqName + " sem"];
      // end this iteration of forEach if no letter grade 
      if (pointVals[gradeVal] === undefined) return; 
      // no units
      if (isNaN(unitsVal) || unitsVal === 0) return;
      // transfer course or test score
      if (!/^\d+$/.test(semVal)) return;

      totalGradePoints += unitsVal;
      earnedGradePoints += unitsVal * pointVals[gradeVal];

    }
  })
  if (totalGradePoints === 0) return "NA";
  return (earnedGradePoints / totalGradePoints).toFixed(3);
}

// were any major requirements taken PNP or received below a C-?
function identifyProblemGrades(courseInfo, requirements) {
  // key: pnp or belowCMinus
  // value: requirement where problem arises
  const problemGrades = {
    'pnp': [],
    'Below C-': []
  };
  const pnp = ["P", "NP"];
  const belowCMinus = ["D+", "D", "D-", "F"];

  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("course") && requirements.some(req => colName.startsWith(req))) {
      const courseName = courseInfo[colName];
      const baseReqName = colName.replace(" course", "");
      const gradeVal = courseInfo[baseReqName + " grade"];
      
      if (pnp.includes(gradeVal)) {
        problemGrades.pnp.push(colName + " - " + courseName);
      } else if (belowCMinus.includes(gradeVal)) {
        problemGrades['Below C-'].push(colName + " - " + courseName)
      }
    }
  });
  return problemGrades;
}

// return major GPA (SIS data)
// check if any courses for major were taken P/NP
// check if any courses for major receieved grade below C-
// check if meets DS requirements if DS
function majorFlags(idInfo, courseInfo, currSem) {
  const flags = {};
  // determine which majors the student is applying to
  const majors = [idInfo['First Choice Major'], idInfo['Second Choice Major'], idInfo['Third Choice Major']];
  // helper to check if any of the three major slots contain the target major
  const hasMajor = (target) => majors.some(m => m && m.includes(target));
  let requirements;
  if (hasMajor("Data Science")) {
    requirements = ["LD #1", "LD #2", "LD #4", "LD #5", "LD #6", "LD #7", "LD #10", "DS Upper Division"];
    flags.major_gpa_ds = calculateMajorGPA(courseInfo, requirements);
    flags.meets_ds_requirements = meetsDSRequirements(idInfo, courseInfo);
    flags.problem_grades_ds = identifyProblemGrades(courseInfo, requirements);
  }
  if (hasMajor("Computer Science")) {
    requirements = ["LD #1", "LD #2", "LD #4", "LD #6", "LD #7", "LD #8", "LD #9", "CS Upper Division"];
    flags.major_gpa_cs = calculateMajorGPA(courseInfo, requirements);
    flags.problem_grades_cs = identifyProblemGrades(courseInfo, requirements);
  } 
  if (hasMajor("Statistics")) {
    requirements = ["LD #1", "LD #2", "LD #3", "LD #4", "LD #5", "ST Upper Division"];
    flags.major_gpa_st = calculateMajorGPA(courseInfo, requirements);
    flags.problem_grades_st = identifyProblemGrades(courseInfo, requirements);
  }
  return flags;
}


// what about units (too many, too few?) -> laura thinks not too big of a deal 
// anything about gen ed?
// flag for student plan doesn't meet major requirements, listed courses don't work
function studentPlanFlags(dataMap, currSem) {
  const sids = Object.keys(dataMap);

  sids.forEach(sid => {
    dataMap[sid].predicted_egt_flags = [];
    const idInfo = dataMap[sid].identifying_info;
    const courseInfo = dataMap[sid].course_info;

    dataMap[sid].predicted_egt_flags = predictedEgtFlags(idInfo, courseInfo);
    dataMap[sid].major_flags = majorFlags(idInfo, courseInfo, currSem);
  });
}

// unnecessary but how to calculate "year"
// Math.floor(currSem / 10) - Math.floor(firstSem / 10)