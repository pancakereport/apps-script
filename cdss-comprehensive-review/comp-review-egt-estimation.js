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
  verifyInfo(dataMap, currSem, true); // verbose is true right now
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
  const headerSet = new Set(["SID"]);
  sids.forEach(sid => {
    const student = dataMap[sid];
    if (student.major_flags) {
      Object.keys(student.major_flags).forEach(k => {
        // split problem_grades key into two specific columns
        if (k.startsWith("problem_grades_")) {
          headerSet.add(`${k} PNP`);
          headerSet.add(`${k} Below C-`);
        } else {
          headerSet.add(k);
        }
      });
    }
  });

  const headers = Array.from(headerSet);
  headers.push("EGT Flags", "Unable to Verify");

  // dataMap -> 2D Array
  const rows = sids.map(sid => {
    const student = dataMap[sid];
    const flags = student.major_flags || {};
    
    return headers.map(h => {
      // special case for verification and egt flags
      if (h === "Unable to Verify") return (student.unable_to_verify || []).join(", ");
      if (h === "EGT Flags") return (student.egt_flags || []).join(", ");

      if (h.endsWith(" PNP")) {
        const flagKey = h.replace(" PNP", "");
        return (flags[flagKey]?.pnp || []).join(", ");
      }
      if (h.endsWith(" Below C-")) {
        const flagKey = h.replace(" Below C-", "");
        return (flags[flagKey]?.['Below C-'] || []).join(", ");
      }

      if (flags.hasOwnProperty(h)) {
        const val = flags[h];
        return (typeof val === 'object' && val !== null) ? JSON.stringify(val) : (val ?? "");
      }

      // // major flags (prefixed with "Flag: " above)
      // if (h.startsWith("Flag: ")) {
      //   const flagKey = h.replace("Flag: ", "");
      //   const val = flags[flagKey];
      //   // If the value is an object (like problem_grades), stringify it nicely
      //   if (typeof val === 'object' && val !== null) {
      //     return JSON.stringify(val); 
      //   }
      //   return val ?? "";
      // }
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

// clean course names (for student input)
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

// helper function to get course names that will (mostly) match with API
function normalizeCourseName(name) {
  // capitalize and trim
  let clean = name.toString().toUpperCase().trim();
  clean = clean.replace(/^DATA\/STAT\s?/, "DATA ");
  clean = clean.replace(/^CS\/DATA\s?/, "DATA ");
  // in free response students might forget cross listed "C"
  clean = clean.replace(/^DATA\s?(?!C)(100|104|140)\b/, "DATA C$1");
  // collapse spaces in department 
  clean = clean.replace(/^([A-Z\s&]+?)(?=\s*[CNW]?\d)/, function(match) {
    return match.replace(/\s+/g, "");
  });
  // ensure space between department and number while accounting
  // for cross listed courses (C), summer not equiv (N) and web (W)
  clean = clean.replace(/([A-Z]+?)\s*([CNW]?\d[A-Z0-9]*).*/, "$1 $2");

  // remove N or W if they appear immediately before a digit (ignore C)
  clean = clean.replace(/([A-Z]+)\s+[NW](\d)/, "$1 $2");

  // common department shorthand
  const mapping = {
    "^CS\\b": "COMPSCI",
    "^EE\\b": "EECS",
    "^SOCIOLOGY\\b": "SOCIOL",
    "^STATISTICS\\b": "STAT",
    "^STATS\\b": "STAT",
    "^ECO\\b": "ECON",
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
        const displayName = e?.classSection?.class?.course?.displayName;
        const units = e?.enrolledUnits?.taken;

        // update minTerm if grade exists
        if (termId && grade && termId < minTerm) {
          minTerm = termId;
        }

        if (!displayName) return;
        // treat N and W course numbers the same as without
        const courseName = displayName.replace(/[NW](?=\d)/i, ""); 
        
        if (!coursesMap[courseName]) coursesMap[courseName] = [];
        coursesMap[courseName].push({
          termId: parseInt(termId || 0),
          grade: grade || "ENROLLED BUT NO GRADE",
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
// + keep track of termsInAttendance
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
        termsInAttendance: null,
        majors: [],
        colleges: []
      };
      
      if (student.academicStatuses && Array.isArray(student.academicStatuses)) {
        // confirm an active undergraduate status
        const undergradCareer = student.academicStatuses.find(status => 
          status.studentCareer?.academicCareer?.code === "UGRD"
        );
        if (undergradCareer) {
          studentData.gpa = undergradCareer.cumulativeGPA?.average || null;
          studentData.termsInAttendance = undergradCareer.termsInAttendance || null;
          // record major, college for each major plan and egt (egt should be the same if double major??)
          undergradCareer.studentPlans.forEach(plan => {
            if (plan.academicPlan?.type?.code !== "MAJ") return;
            studentData.egt = plan.expectedGraduationTerm?.id || null;
            studentData.majors.push(plan.academicPlan?.plan?.formalDescription);
            studentData.colleges.push(plan.academicProgram?.academicGroup?.formalDescription) // not the closest but maybe i can do some rounding

          });
        }
      } else {
        Logger.log(`Could not find undergraduate enrollment for ${studentId}. No GPA or EGT or termsInAttendance will be recorded.`)
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
  const year = String(sem[1]);
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

// helper to compare grades (A > B > C etc.)
// assumes letter grades are greater than PNP
function getHighestGrade(gradeList) {
  const points = { "A+": 4.0, "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7, "C+": 2.3, "C": 2.0, "C-": 1.7, "D+": 1.3, "D": 1.0, "D-": 0.7, "F": 0, "W": -1, "NP": -1, "I": -1, "P": -1, "ENROLLED BUT NO GRADE": -1};
  return gradeList.reduce((best, current) => {
    return (points[current] || 0) > (points[best] || 0) ? current : best;
  }, gradeList[0]);
}

// helper to verify admit term, egt, gpa, current college, current major
// + keep track of terms in attendance and SIS EGT 
function verifyIdentifyingInfo(sid, dataMap, studentTruth, enrollmentTruth, verbose) {
  const idInfo = dataMap[sid].identifying_info;
  // ADMIT TERM
  const firstSemId = semToId(idInfo["1st Sem"]);
  dataMap[sid].identifying_info["1st Sem ID"] = firstSemId;
  // if a student has a summer admit term, push them to the following fall
  const rawAdmitTerm = enrollmentTruth["Admit Term"];
  const adjustedAdmitTerm = String(rawAdmitTerm).endsWith("5") 
    ? Number(rawAdmitTerm) + 3 
    : Number(rawAdmitTerm);
  if (firstSemId != rawAdmitTerm && firstSemId != adjustedAdmitTerm) {
    verbose && Logger.log(`${sid} admit term: ${idInfo["1st Sem"]} which translates to ${firstSemId} and doesn't match SIS ${enrollmentTruth["Admit Term"]}`);
    dataMap[sid].unable_to_verify.push("1st Sem");
  }
  // EGT
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

  // helper: normalize strings for fuzzy matching
  const normalize = (str) => {
    if (!str) return "";
    return str
      .toString()
      .toLowerCase()
      .replace("clg", "college")
      .replace("&", "and")
      .replace(/[^a-z0-9]/g, "");
  }; 
  // COLLEGE VERIFICATION
  const reportedColleges = idInfo["Current College"] || ""; 
  const actualColleges = studentTruth.colleges || []; 
  const actualCleanedC = actualColleges.map(normalize);

  // can every reported college be verified?
  const collegeIsVerified = reportedColleges.split(",").every(rep => {
    const cleanRep = normalize(rep);
    return actualCleanedC.some(act => act.includes(cleanRep) || cleanRep.includes(act));
  });
  if (!collegeIsVerified) {
    verbose && Logger.log(`Student reported ${reportedColleges}, but SIS sees ${actualColleges} for current college`)
    dataMap[sid].unable_to_verify.push("Current College");
  }
  // MAJOR VERIFICATION
  const reportedMajor = idInfo["Current Major"] || "";
  const actualMajor = studentTruth.majors || [];
  const actualCleanedM = actualMajor.map(normalize);

  const reportedList = reportedMajor.split(",").map(m => m.trim()).filter(m => m !== "");
  const hasUndeclared = reportedList.some(m => /undeclared/i.test(m));
  const hasMultipleMajors = reportedList.length > 1;
  // can every reported major be verified? (except "Undeclared,Major")
  let majorIsVerified;
  if (hasUndeclared && hasMultipleMajors) { 
    majorIsVerified = true;
  } else { 
    majorIsVerified = reportedList.every(rep => {
      const cleanMaj = normalize(rep);
      return actualCleanedM.some(act => act.includes(cleanMaj) || cleanMaj.includes(act));
    });
  }
  if (!majorIsVerified) {
    verbose && Logger.log(`Student reported ${reportedMajor}, but SIS sees ${actualMajor} for current Major`)
    dataMap[sid].unable_to_verify.push("Current Major");
  }
  // add for later (internal calculation) use
  dataMap[sid].identifying_info['Terms in attendance'] = studentTruth.termsInAttendance;
  dataMap[sid].identifying_info['SIS EGT'] = studentTruth.egt;
}

// helper to verify course grade and semester information
function verifyCourseInfo(sid, dataMap, enrollmentTruth, currSem, verbose) {
  const courseInfo = dataMap[sid].course_info;
  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("grade")) {
      const gradeVal = courseInfo[colName];
      const baseReqName = colName.replace(" grade", "");
      const courseName = courseInfo[baseReqName + " course"];
      const semVal = courseInfo[baseReqName + " sem"];
      let unitsFound = 0;

      // SKIP for transfers, test scores, future classes beyond currSem, and placeholders
      const isTransfer = /transfer/i.test(courseName) || /transfer/i.test(semVal);
      if (semVal > currSem || semVal === "Test Score" || isTransfer || !courseName || courseName.toLowerCase() === "other") return;

      // try to find a grade match across attempts 1, 2, and 3
      let foundMatch = false;
      let possibleGradesFound = [];
      // loop through possible attempts
      for (let attempt = 1; attempt <= 3; attempt++) {
        // check standard name and fall program for freshman
        const variants = [
          {grade: `${courseName} | ${attempt} | 2 Grade`, 
            units: `${courseName} | ${attempt} | 3 Units`,
            termId:  `${courseName} | ${attempt} | 4 Semester`},
          {grade: `X${courseName} | ${attempt} | 2 Grade`, 
            units: `X${courseName} | ${attempt} | 3 Units`,
            termId:  `X${courseName} | ${attempt} | 4 Semester`}
        ];

        for (const variant of variants) {
          const apiSem = enrollmentTruth[variant.termId];
          const apiGrade = enrollmentTruth[variant.grade];

          if (semVal == currSem) {
            // We only care about the API record if it's also for the current semester
            if (apiSem == currSem) {
              foundMatch = true;
              break; 
            } else {
              // record found for this course, but it's NOT for currSem; let the loop 
              // continue to see if another 'attempt' matches the currSem.
              continue; 
            }
          }
          if (apiGrade !== undefined && apiGrade !== null) {
            const formattedApiGrade = apiGrade.toString().toUpperCase();
            possibleGradesFound.push(formattedApiGrade);
            
            if (formattedApiGrade === gradeVal) {
              unitsFound = enrollmentTruth[variant.units] || 0;
              foundMatch = true;
              if (semVal != apiSem) {
                dataMap[sid].course_info[baseReqName + " sem"] = apiSem;
              }
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
        dataMap[sid].unable_to_verify.push(baseReqName);
        if (verbose) {
          if (gradeVal === "PL") {
            Logger.log(`${sid}: API doesn't have a current enrollment record of ${courseName} for requirement ${baseReqName}`);
          } else {
            Logger.log(`${sid}: API doesn't have record of ${courseName} for requirement ${baseReqName} with grade ${gradeVal}. 
            SIS saw: ${possibleGradesFound.join(', ') || 'Nothing'}`);
          }
        }

        if (semVal === currSem) {
          dataMap[sid].course_info[baseReqName + " sem"] = `No API enrollment found for ${currSem}`
        } else if (possibleGradesFound.length === 0) {
          dataMap[sid].course_info[colName] = "NA";
        } else {
          dataMap[sid].course_info[colName] = getHighestGrade(possibleGradesFound);
        }
      }
    }
  });
}


/** Verify information in dataMap: 
 * - Do reported 1st Sem, EGT, CGPA, Current College, and Current Major match SIS?
 * - Flag courses where grade doesn't line up with SIS
 *   excluding transfer courses and test scores.
 *   * does not check if semester matches listed, just that grade matches
 *   * some cross listed courses may be flagged depending on student responses
 *     courses with N or W in the number are treated the same as without
 *     and fall program for freshman courses (begin with X) are treated as normal 
 * 
 * Returns dataMap with a new key for each SID:
 * {SID: { identifying_info: {col: val, ...}, now including 1st Sem ID and termsInAttendance
 *         course_info: {col: val, ...},
 *         unable_to_verify: [col1, col2, ...]}}
 */ 
function verifyInfo(dataMap, currSem, verbose = false) {
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

    verifyIdentifyingInfo(sid, dataMap, studentTruth, enrollmentTruth, verbose);
    verifyCourseInfo(sid, dataMap, enrollmentTruth, currSem, verbose);
  });
  return dataMap;
}

// student plan includes summer term(s) or term(s) 
// after the EGT listed on the application or the SIS EGT
function egtFlags(idInfo, courseInfo) {
  const sisEGT = parseInt(idInfo['SIS_EGT']);
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
    retval.push("Summer semesters planned");
  }
  if (!isNaN(appEGT) && terms.some(t => t.sem > appEGT)) {
    retval.push("Terms planned after application EGT");
  }
  if (!isNaN(sisEGT) && terms.some(t => t.sem > sisEGT)) {
    retval.push("Terms planned after EGT from SIS");
  }
  return retval;
}

// count num completed (letter grade) for reqs
function countReqCompleted(courseInfo, reqs) {
  const notLetterGrade = ["PL", "P", "NP", "NA", "ENROLLED BUT NO GRADE", "I"];
  let total = 0;

  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("course") && reqs.some(req => colName.startsWith(req))) {
      const baseReqName = colName.replace(" course", "");
      const gradeVal = courseInfo[baseReqName + " grade"];
      
      if (!notLetterGrade.includes(gradeVal)) {
        total += 1
      }
    }
  });
  return total;
}

// count num enrolled of courses in reqs
function countReqEnrolled(courseInfo, reqs, currSem) {
  let total = 0;

  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("course") && reqs.some(req => colName.startsWith(req))) {
      const baseReqName = colName.replace(" course", "");
      const gradeVal = courseInfo[baseReqName + " grade"];
      const semVal = courseInfo[baseReqName + " sem"];
      
      if (semVal == currSem) {
        total += 1
      }
    }
  });
  return total;
}

// checks for passing letter grades (or test scores) in
// LD 5 + (LD 1 | LD 2 | LD 6)
function meetsDSAdmitReqBasic(courseInfo) {
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

// according to https://cdss.berkeley.edu/dsus/academics/declaring-major
function meetsDSAdmitReq(idInfo, courseInfo, currSem) {
  if (!meetsDSAdmitReqBasic(courseInfo)) return false;

  const isTransfer = idInfo["FY vs TR"] === "Transfer";
  const termsInAttendance = idInfo["Terms in attendance"];
  const lower_div = ["LD #1", "LD #2", "LD #4", "LD #5", "LD #6", "LD #7", "LD #10"];
  const numCompleted = countReqCompleted(courseInfo, lower_div);
  const numEnrolled = countReqEnrolled(courseInfo, lower_div, currSem);
  if (!isTransfer) { // first year admit
    if (termsInAttendance < 3) { // first year
      // basic + one additional course = 3 reqs
      return numCompleted + numEnrolled >= 3 ;
    } else if (termsInAttendance < 5) { // second year
      // basic + three additional courses = 5 reqs
      return numCompleted + numEnrolled >= 5;
    } else if (termsInAttendance < 7) { // third year
      // all reqs completed or in progress = 7 reqs
      return numCompleted + numEnrolled == 7;
    } else if (termsInAttendance > 6) { // fourth year, beyond
      return `Too many terms in attendance (${termsInAttendance} terms)`;
    }
  } else { // transfer admit
    if (termsInAttendance === 6) { // new transfer
      if (numCompleted === 7) {
        return true;
      } else if (numCompleted === 6) {
        return "Summer Course Required to complete LD req";
      } else {
        return false;
      }
    } else if (termsInAttendance === 7) { // continuing transfer
      return numCompleted === 7;
    } else if (termsInAttendance > 7) { // applying with 4+ semesters at UC Berkeley
      return  `Too many terms in attendance (${termsInAttendance} terms)`;
    } else { // this should never be reached, but just in case
      return "Something weird is happening with terms in attendance";
    }
  }
  return false;
}

// https://docs.google.com/spreadsheets/d/17iOiE6Sfu6IZOPIHT0vadOHjPt34dNLiGLUTla3yAE8/edit?gid=0#gid=0
function meetsCSAdmitReq(idInfo, courseInfo, currSem, cs_gpa) {
  // no transfers are eligible for comprehensive review
  const isTransfer = idInfo["FY vs TR"] === "Transfer";
  if (isTransfer) return false;

  const gradesNotAcceptedCompleted = ["P", "NP", "PL", "D+", "D-", "D", "F", "NA"];
  const gradesNotAcceptedInProgress = ["P", "NP", "D+", "D-", "D", "F", "NA"]
  // LD 1, LD 2 completed
  if (gradesNotAcceptedCompleted.includes(courseInfo["LD #1 Calc 1 grade"]) || gradesNotAcceptedCompleted.includes(courseInfo["LD #2 Calc 2 grade"])) {
    return false;
  }
  // LD 4 passing grade or enrolled currSem
  // if physics 89 must have physics listed as major
  const ld4sem = courseInfo["LD #4 LinAlg sem"];
  const ld4isFuture = ld4sem !== "Transfer" && parseInt(ld4sem) > currSem;
  if (ld4sem === "Other") {
    return "More investigation needed, see LD4";
  }
  if (courseInfo["LD #4 LinAlg course"] === "PHYSICS 89" && !idInfo["Current Major"].includes("Physics")) {
    return false;
  }
  if (gradesNotAcceptedInProgress.includes(courseInfo["LD #4 LinAlg grade"]) || ld4isFuture) {
    return false;
  } 
  // LD 6, LD 7, LD 9 must have 1 completed, 2 enrolled
  const lower_div = ["LD #6", "LD #7", "LD #9"];
  const numReqCompleted = countReqCompleted(courseInfo, lower_div);
  const numReqEnrolled = countReqEnrolled(courseInfo, lower_div, currSem);
  if (numReqCompleted < 1 || numReqCompleted + numReqEnrolled != 3) {
    return false;
  }
  // majorGPA must be >= 3.0
  if (cs_gpa >= 3.0) {
    return true;
  } else if (numReqEnrolled > 0 || courseInfo["LD #4 LinAlg grade"] === "PL") {
    return "GPA below 3.0 with courses in progress";
  } else {
    return false;
  }
}

// https://docs.google.com/spreadsheets/d/17iOiE6Sfu6IZOPIHT0vadOHjPt34dNLiGLUTla3yAE8/edit?gid=1222050180#gid=1222050180
function meetsStAdmitReq(idInfo, courseInfo, currSem) {
  const isTransfer = idInfo["FY vs TR"] === "Transfer";
  const termsInAttendance = idInfo["Terms in attendance"];
  const gradesNotAcceptedCompleted = ["P", "NP", "PL", "D+", "D-", "D", "F", "NA"];
  if (!isTransfer) { // first year admit
    if (termsInAttendance < 3) { // first year
      // completed LD 1; LD 2, LD 5 enrolled
      if (gradesNotAcceptedCompleted.includes(courseInfo["LD #1 Calc 1 grade"])) {
        return false
      }
      const lower_div = ["LD #2", "LD #5"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      const numReqEnrolled = countReqEnrolled(courseInfo, lower_div, currSem);

      return numReqCompleted + numReqEnrolled === 2;
    } else if (termsInAttendance < 5) { // second year
      // completed LD 1, LD 2, LD 5; LD 3 or LD 4 enrolled
      const lower_div = ["LD #1", "LD #2", "LD #5"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      if (numReqCompleted != lower_div.length) {
        return false;
      } 
      const lower_div2 = ["LD #3", "LD #4"];
      const numReqCompleted2 = countReqCompleted(courseInfo, lower_div2);
      const numReqEnrolled2 = countReqEnrolled(courseInfo, lower_div2, currSem);

      return numReqCompleted2 + numReqEnrolled2 === lower_div2.length;
    } else if (termsInAttendance < 7) { // third year
      // completed LD 1, LD 2, LD 5
      const lower_div = ["LD #1", "LD #2", "LD #5"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      if (numReqCompleted != lower_div.length) {
        return false;
      } 
      // LD 3/LD 4 one completed, one enrolled
      const lower_div2 = ["LD #3", "LD #4"];
      const numReqCompleted2 = countReqCompleted(courseInfo, lower_div2);
      const numReqEnrolled2 = countReqEnrolled(courseInfo, lower_div2, currSem);
      if (numReqCompleted2 + numReqEnrolled2 !== lower_div2.length) {
        return false;
      }
      // ST Upper Division#2 enrolled 
      if (courseInfo["ST Upper Division#2 grade"] == "PL" || !gradesNotAcceptedCompleted.includes(courseInfo["ST Upper Division#2 grade"])) {
        return true;
      } else {
        return false;
      }
    } else if (termsInAttendance > 7) { // applying with 4+ semesters at UC Berkeley
      return  `Too many terms in attendance (${termsInAttendance} terms)`;
    }
  } else { // transfer admit
      // LD 1, LD 2 completed
      const lower_div = ["LD #1", "LD #2"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      if (numReqCompleted != lower_div.length) {
        return false;
      } 
      // LD 5 enrolled
      if (courseInfo["LD #5 DSc8/St20 grade"] !== "PL" || gradesNotAcceptedCompleted.includes(courseInfo["LD #5 DSc8/St20 grade"])) {
        return false;
      }
      // LD 3/LD 4 one completed, one enrolled
      const lower_div2 = ["LD #3", "LD #4"];
      const numReqCompleted2 = countReqCompleted(courseInfo, lower_div2);
      const numReqEnrolled2 = countReqEnrolled(courseInfo, lower_div2, currSem);

      return numReqCompleted2 + numReqEnrolled2 === lower_div2.length;
  }
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
      if (!(gradeVal in pointVals)) return;
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
// check if meets admit requirements
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
    flags.problem_grades_ds = identifyProblemGrades(courseInfo, requirements);
    flags.meets_ds_admit_requirements = meetsDSAdmitReq(idInfo, courseInfo, currSem);
  }
  if (hasMajor("Computer Science")) {
    requirements = ["LD #1", "LD #2", "LD #4", "LD #6", "LD #7", "LD #8", "LD #9", "CS Upper Division"];
    const cs_gpa = calculateMajorGPA(courseInfo, requirements);
    flags.major_gpa_cs = cs_gpa;
    flags.problem_grades_cs = identifyProblemGrades(courseInfo, requirements);
    flags.meets_cs_admit_requirements = meetsCSAdmitReq(idInfo, courseInfo, cs_gpa);
  } 
  if (hasMajor("Statistics")) {
    requirements = ["LD #1", "LD #2", "LD #3", "LD #4", "LD #5", "ST Upper Division"];
    flags.major_gpa_st = calculateMajorGPA(courseInfo, requirements);
    flags.problem_grades_st = identifyProblemGrades(courseInfo, requirements);
    // flag.meets_st_admit_requirements = meetsStAdmitReq(idInfo, courseInfo, currSem);
  }
  return flags;
}

// flag for student plan doesn't meet major requirements, 
// TODO verify if listed courses work (upper div)
function studentPlanFlags(dataMap, currSem) {
  const sids = Object.keys(dataMap);

  sids.forEach(sid => {
    dataMap[sid].egt_flags = [];
    const idInfo = dataMap[sid].identifying_info;
    const courseInfo = dataMap[sid].course_info;

    dataMap[sid].egt_flags = egtFlags(idInfo, courseInfo);
    dataMap[sid].major_flags = majorFlags(idInfo, courseInfo, currSem);
  });
}

// unnecessary but how to calculate "year"
// Math.floor(currSem / 10) - Math.floor(firstSem / 10)