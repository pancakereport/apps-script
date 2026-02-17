// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Test Work So Far', 'fullFunction')
    .addToUi();
}

function fullFunction() {
  const currSem = 2262;
  const reqListLongId = "1kFe7BUCyapp5GO8SlpFOkidV-8NOH8BzkueIX5tPuV8";
  const dataMap = getInput(false);
  cleanCourses(dataMap);
  verifyInfo(dataMap, currSem, false); 
  studentPlanFlags(dataMap, currSem, reqListLongId);
  writeToSheet(dataMap, "Intermediate Processed Data");
}


/** Read the input data
 * Returns a map of {SID: { identifying_info: {col: val, ...}, 
 *                         course_info: {col: val, ...}}}
 * To be used by later functions
 * */
function getInput(verbose=false) {
  // read data
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName("Input"); 
  const data = inputSheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  // rename headers
  const updatedHeaders = headers.map(header => {
    // rename Lower Division: "LD N: <Requirement> course|grade|sem" or 
    // "LD N - <Requirement> course|grade|sem"
    // -> "LD N <Requirement> course|grade|sem"
    const ldMatch = header.match(/^LD (\d+)[: \-]+(.+)\s(course|grade|sem)$/i);
    if (ldMatch) {
      const ldNum = ldMatch[1];
      const reqName = ldMatch[2].trim();
      const suffix = ldMatch[3].toLowerCase(); // course, grade, or sem
      
      return `LD #${ldNum} ${reqName} ${suffix}`;
    }
    return header;
  });
  // list of headers to keep in identifying_info
  const keepHeaders = [
    "SID", "FY vs TR", "1st Sem", "EGT",
    "Current College", "Current Major", "CGPA",
    "CS Ranking", "DS Ranking", "Stats Ranking",
    "1st DE", "2nd DE"
  ];

  // SID Map with partitioned data - identifying data and data relating to courses
  const sidIndex = updatedHeaders.indexOf("SID");
  const dataMap = {};
  rows.forEach(row => {
    const sid = String(row[sidIndex]);
    if (!sid) return; 
    if (!randomSids.has(sid)) return;
    dataMap[sid] = {
      identifying_info: {},
      course_info: {}
    };

    updatedHeaders.forEach((header, index) => {
      const val = row[index];
      if (header.includes("grade") || header.includes("course")) {
        dataMap[sid].course_info[header] = val;
      } else if (header.includes("sem")) {
        dataMap[sid].course_info[header] = semShortToId(val);
      } else if (keepHeaders.includes(header)){
        dataMap[sid].identifying_info[header] = val;
      }
    });
    // handle when response is "other" by filling in their text response
    const idInfo = dataMap[sid].identifying_info;
    // pivot Major Ranking
    const majorMap = {
      "CS Ranking": "Computer Science",
      "DS Ranking": "Data Science",
      "Stats Ranking": "Statistics"
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

  const headers = ["SID", "Unable to Verify", "EGT Flags", ...headerSet];

  // dataMap -> 2D Array
  const rows = sids.map(sid => {
    const student = dataMap[sid];
    const flags = student.major_flags || {};
    
    return headers.map(h => {
      // special case for verification and egt flags
      if (h === "Unable to Verify") return (student.unable_to_verify || []).join(", ");
      if (h === "EGT Flags") return (student.egt_flags || []).join(", ");

      if (h.endsWith("_unable_to_verify_if_approved")) {
        const list = flags[h];
        return Array.isArray(list) ? list.join("\n") : (list ?? "");
      }

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

      return student.identifying_info[h] ?? student.course_info[h] ?? "";
    });
  });

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  const MAX_WIDTH = 300; 
  for (let i = 1; i <= headers.length; i++) {
    if (sheet.getColumnWidth(i) > MAX_WIDTH) {
      sheet.setColumnWidth(i, MAX_WIDTH);
    }
  }
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

  // Group 2: The "Course Number String" (everything until the next space)
  const parts = clean.match(/^([A-Z]+)\s*[CNW]?\s*(\d\S*)/);
  
  if (parts) {
    let dept = parts[1];
    let num = parts[2];
    // trim trailing punctuation and words while keeping the alphanumeric course num intact
    num = num.split(/[^A-Z0-9]/)[0];

    return dept + " " + num;
  }

  // // separate dept from num
  // // capture: 1. dept, 2. optional Prefix (CNW), 3. num
  // const parts = clean.match(/^([A-Z]{2,})\s*([CNW])?\s*(\d.*)$|^([A-Z])\s*([CNW])?\s*(\d.*)$/);
  
  // if (parts) {
  //   // If it's a long dept name (like ECON), parts[1] is the name.
  //   // If it's a single-letter dept (not common here), parts[4] is the name.
  //   let dept = parts[1] || parts[4];
  //   let num = parts[3] || parts[6];
  //   return dept + " " + num;
  // }

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
        // treat C, N, and W course numbers the same as without
        const courseName = displayName.replace(/[CNW](?=\d)/i, ""); 
        
        if (!coursesMap[courseName]) coursesMap[courseName] = [];
        coursesMap[courseName].push({
          termId: parseInt(termId || 0),
          grade: grade || "ENROLLED BUT NO GRADE",
          units:  units || 0 
        });
      });

      resultMapping["Admit Term"] = minTerm === Infinity ? "N/A" : minTerm;

      // For each course, sort by termId (descending) and take the top 3
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
            studentData.colleges.push(plan.academicProgram?.academicGroup?.formalDescription)
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

// helper function that turns semester names
// like "Spring 2026" to ids
function semLongToId(sem) {
  // split to into semester and year 
  sem = String(sem).split(" ");
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
  const firstSemId = idInfo["1st Sem"];
  dataMap[sid].identifying_info["1st Sem ID"] = firstSemId;
  // if a student has a summer admit term, push them to the following fall
  const rawAdmitTerm = enrollmentTruth["Admit Term"];
  const adjustedAdmitTerm = String(rawAdmitTerm).endsWith("5") 
    ? Number(rawAdmitTerm) + 3 
    : Number(rawAdmitTerm);
  if (firstSemId != rawAdmitTerm && firstSemId != adjustedAdmitTerm) {
    verbose && Logger.log(`${sid} admit term: ${idInfo["1st Sem"]} which doesn't match SIS ${enrollmentTruth["Admit Term"]}`);
    dataMap[sid].unable_to_verify.push("1st Sem");
  }
  // EGT
  if (idInfo["EGT"] != studentTruth.egt) {
    verbose && Logger.log(`${sid} stated egt: ${idInfo["EGT"]} which doesn't match SIS ${studentTruth.egt}`);
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
  if (verbose) {
    Logger.log(`${sid} Initial State: ${JSON.stringify(dataMap[sid].course_info)}`);
    Logger.log(`${sid} Enrollment Truth: ${JSON.stringify(enrollmentTruth)}`);
  }
  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("grade")) {
      const gradeVal = courseInfo[colName];
      const baseReqName = colName.replace(" grade", "");
      const courseName = courseInfo[baseReqName + " course"];
      const semValStr = courseInfo[baseReqName + " sem"];
      const semVal = Number(semValStr);
      let unitsFound = 0;

      // SKIP for transfers, test scores, future classes beyond currSem, and placeholders
      const isTransfer = /transfer/i.test(courseName) || /transfer/i.test(semValStr);
      const isTestScoreCourse = courseName === "CALC BC" || courseName === "CALC AB" || 
        courseName === "A-LEVEL FURTHER MATH" || courseName === "HL Math";
      if (semVal > currSem || semValStr === "Test Score" || isTransfer || !courseName || 
      courseName.toLowerCase() === "other" || isTestScoreCourse) return;

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
          const apiSem = Number(enrollmentTruth[variant.termId]);
          const apiGrade = enrollmentTruth[variant.grade];

          // incompletes
          if (apiGrade === "I") {
            foundMatch = true;
            dataMap[sid].course_info[baseReqName + " grade"] = "I";
            verbose && Logger.log(`${sid} has an Incomplete recorded for ${courseName} satisfying requirement ${baseReqName}`);
            break;
          }

          // if the API shows they are currently in a course, count it 
          // as a match regardless of the student's semVal
          if (apiSem === currSem) {
            foundMatch = true;
            unitsFound = enrollmentTruth[variant.units] || 0;
            if (semVal !== currSem || gradeVal !== "PL") {
              dataMap[sid].course_info[baseReqName + " sem"] = currSem;
              dataMap[sid].course_info[baseReqName + " grade"] = "PL";
            }
            break;
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
          // "PL" for current or past semester is caught here
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
  if (verbose) {
    Logger.log(`${sid} Final State: ${JSON.stringify(dataMap[sid].course_info)}`);  
  }
}


/** Verify information in dataMap: 
 * - Do reported 1st Sem, EGT, CGPA, Current College, and Current Major match SIS?
 * - Flag courses where grade doesn't line up with SIS
 *   excluding transfer courses and test scores.
 *   * if semester does not match listed, semester is updated. Same for grade
 *   * some cross listed courses may be flagged depending on student responses
 *     courses with N or W in the number are treated the same as without
 *     and fall program for freshman courses (beginning with X) are treated as normal 
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

/** Flag all of the following:
 *    student plan includes summer term(s)
 *    student plan includes term(s) after the EGT listed on the application or the SIS EGT
 *    requirements in which a course semester is listed as "PL" and the semester is less than currSem
 */
function egtFlags(idInfo, courseInfo, currSem) {
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

  terms.forEach(t => {
    if (t.grade === "PL" && Number(t.sem) < Number(currSem)) {
      retval.push(`${t.p} is planned for ${t.sem} which is not a current or future semester`);
    }
  });
  return retval;
}

// count num completed (letter grade) for reqs
function countReqCompleted(courseInfo, reqs) {
  const notLetterGrade = ["PL", "P", "NP", "NA", "ENROLLED BUT NO GRADE", "I"];
  let total = 0;
  // const courses = [];

  Object.keys(courseInfo).forEach(colName => {
    const isExactMatch = reqs.some(req => colName.startsWith(req + " "));
    if (colName.includes("course") && isExactMatch) {
      const baseReqName = colName.replace(" course", "");
      const gradeVal = courseInfo[baseReqName + " grade"];
      
      if (!notLetterGrade.includes(gradeVal)) {
        total += 1
        // courses.push(baseReqName);
      }
    }
  });
  // Logger.log(`Requirements Completed: ${courses}`)
  return total;
}

// count num enrolled of courses in reqs
function countReqEnrolled(courseInfo, reqs, currSem) {
  let total = 0;
  // const courses = [];

  Object.keys(courseInfo).forEach(colName => {
    const isExactMatch = reqs.some(req => colName.startsWith(req + " "));
    if (colName.includes("course") && isExactMatch) {
      const baseReqName = colName.replace(" course", "");
      const semVal = courseInfo[baseReqName + " sem"];
      
      if (Number(semVal) === Number(currSem)) {
        total += 1
        // courses.push(baseReqName);
      }
    }
  });
  // Logger.log(`Requirements Enrolled: ${courses}`)
  return total;
}

// some requirements have long lists of courses that satisfy them. here, grab those lists from a separate sheet
function getReqListLong(ssId) {
  const ss = SpreadsheetApp.openById(ssId);
  const allSheets = ss.getSheets();
  const mainMap = new Map();

  allSheets.forEach(sheet => {
    const sheetName = sheet.getName();
    if (sheetName === "DS Domain Emphasis") {
      const sheet = ss.getSheetByName(sheetName); 
      const data = sheet.getDataRange().getValues();
      const headers = data[0];

      const idx = {
        domain: headers.indexOf("Domain Emphasis"),
        listing: headers.indexOf("Course Listing"),
        number: headers.indexOf("Course Number"),
        division: headers.indexOf("Lower-division/Upper-division"),
        units: headers.indexOf("Units"),
        approvedOnly: headers.indexOf("Approved only with this topic (Y/N)"),
        title: headers.indexOf("Course Title")
      };

      const domainMap = new Map();

      data.slice(1).forEach(row => {
        const domainName = row[idx.domain];
        if (!domainName) return; // skip empty rows

        if (!domainMap.has(domainName)) {
          domainMap.set(domainName, new Map());
        }

        const courseKeyRaw = `${row[idx.listing]} ${row[idx.number]}`;
        const courseKey = normalizeCourseName(courseKeyRaw);
        const isApprovedOnly = row[idx.approvedOnly] === "Y";

        const courseDetails = {
          division: row[idx.division],
          units: row[idx.units],
          approvedOnlyWithTopic: row[idx.approvedOnly],
          // only include title if 'Approved only with this topic' is Y
          courseTitle: isApprovedOnly ? row[idx.title] : null
        };
        domainMap.get(domainName).set(courseKey, courseDetails);
      });
      mainMap.set(sheetName, domainMap);
    } else if (sheetName === "Stat Cluster") {
      const statCluster = new Set();
      const sheet = ss.getSheetByName(sheetName); 
      const data = sheet.getDataRange().getValues();
      data.slice(1).forEach(row => {
        const dept = row[0];
        const numRaw = row[1];
        const num = String(numRaw).toUpperCase();
        const courseNameRaw = dept + " " + num;
        const courseName = normalizeCourseName(courseNameRaw);
        statCluster.add(courseName);
      });
      mainMap.set(sheetName, statCluster);
    } else if (sheetName === "CS Technical Electives") {
      const csTechElectives = {"courses": new Set(), "depts": new Map()};
      const sheet = ss.getSheetByName(sheetName); 
      const data = sheet.getDataRange().getValues();
      data.slice(2).forEach(row => { // skip first 2 rows
        const courseRaw = row[0];
        const course = normalizeCourseName(courseRaw);
        const notes = row[1] || "";
        if (notes) { // department for a single
          const notesArray = notes.split(" ");
          // TODO: finish
          let coursefinal = "";
          if (notesArray.length > 1) { // actual courses are listed
            notesArray.forEach(note => {
              coursefinal = course + " " + note;
              csTechElectives["courses"].add(coursefinal);
            });
          } else {
            csTechElectives["depts"].set(course, notes);
          }
        } else { // course on a single line
          csTechElectives["courses"].add(course);
        }
      });
      mainMap.set(sheetName, csTechElectives);
    }
  });
  return mainMap;
}

// checks for passing letter grades (or test scores) in
// LD 5 + (LD 1 | LD 2 | LD 6)
function meetsDSAdmitReqBasic(courseInfo) {
  gradesNotAccepted = ["P", "NP", "PL", "D+", "D-", "D", "F", "NA", "ENROLLED BUT NO GRADE", "I"]

  if (gradesNotAccepted.includes(courseInfo["LD #5 DSc8/St20 grade"]) ) {
    return false;
  }
  if (!gradesNotAccepted.includes(courseInfo["LD #1 Calc 1 grade"])) {
    return true;
  } else if (!gradesNotAccepted.includes(courseInfo["LD #2 Calc 2 grade"])) {
    return true;
  } else if (!gradesNotAccepted.includes(courseInfo["LD #6 CS 61A grade"])) {
      return true;
  } else {
    return false;
  }
}

// according to https://cdss.berkeley.edu/dsus/academics/declaring-major
function meetsDSAdmitReq(idInfo, courseInfo, currSem) {

  if (!meetsDSAdmitReqBasic(courseInfo)) return "FALSE: Does not meet requirements for LD 5, LD 1, LD 2, or LD 6";

  const sid = idInfo['SID'];
  const isTransfer = idInfo["FY vs TR"] === "Transfer";
  const termsInAttendance = idInfo["Terms in attendance"];
  const lower_div = ["LD #1", "LD #2", "LD #4", "LD #5", "LD #6", "LD #7", "LD #10"];
  // Logger.log(`${sid}:`);
  const numCompleted = countReqCompleted(courseInfo, lower_div);
  const numEnrolled = countReqEnrolled(courseInfo, lower_div, currSem);
  if (!isTransfer) { // first year admit
    if (termsInAttendance < 3) { // first year
      // basic + one additional course = 3 reqs
      if (numCompleted + numEnrolled >= 3) {
        return true;
      } else {
        // Logger.log(`${sid}: DS FALSE: Has not completed or enrolled in 3 lower divs as a first year`);
        // Logger.log(`${sid}: numCompleted is ${numCompleted}, numEnrolled is ${numEnrolled}`);
        return "FALSE: Has not completed or enrolled in 3 lower divs as a first year";
      }
    } else if (termsInAttendance < 5) { // second year
      // basic + three additional courses = 5 reqs
      if (numCompleted + numEnrolled >= 5) {
        return true;
      } else {
      //   Logger.log(`${sid}: DS FALSE: Has not completed or enrolled in 5 lower divs as a second year`);
      //   Logger.log(`${sid}: numCompleted is ${numCompleted}, numEnrolled is ${numEnrolled}`);
        return "FALSE: Has not completed or enrolled in 5 lower divs as a second year";
      }
    } else if (termsInAttendance < 7) { // third year
      // all reqs completed or in progress = 7 reqs
      if (numCompleted + numEnrolled == 7) {
        return true;
      } else {
        // Logger.log(`${sid}: DS FALSE: Has not completed or enrolled in 7 lower divs as a third year`);
        // Logger.log(`${sid}: numCompleted is ${numCompleted}, numEnrolled is ${numEnrolled}`);
        return "FALSE: Has not completed or enrolled in 7 lower divs as a third year";
      }
    } else if (termsInAttendance > 6) { // fourth year, beyond
      return `FALSE: Too many terms in attendance (${termsInAttendance} terms)`;
    }
  } else { // transfer admit
    if (termsInAttendance < 7) { // new transfer
      if (numCompleted + numEnrolled === 7) {
        return true;
      } else if (numCompleted + numEnrolled === 6) {
        // Logger.log(`${sid}: DS CONDITIONAL: Summer Course Required to complete LD req`);
        // Logger.log(`${sid}: numCompleted is ${numCompleted}, numEnrolled is ${numEnrolled}`);
        return "CONDITIONAL: Summer Course Required to complete LD req";
      } else {
        // Logger.log(`${sid}: DS FALSE: Has not completed or enrolled in 6 lower divs as a new transfer`)
        // Logger.log(`${sid}: numCompleted is ${numCompleted}, numEnrolled is ${numEnrolled}`);
        return "FALSE: Has not completed or enrolled in 6 lower divs as a new transfer";
      }
    } else if (termsInAttendance === 7) { // continuing transfer
      if (numCompleted + numEnrolled === 7) {
        return true;
      } else {
        // Logger.log(`${sid}: DS FALSE: Has not completed or enrolled in 7 lower divs as a continuing transfer`)
        // Logger.log(`${sid}: numCompleted is ${numCompleted}, numEnrolled is ${numEnrolled}`);
        return "FALSE: Has not completed or enrolled in 7 lower divs as a continuing transfer";
      }
    } else if (termsInAttendance > 7) { // applying with 4+ semesters at UC Berkeley
      return  `FALSE: Too many terms in attendance (${termsInAttendance} terms)`;
    } else { // this should never be reached, but just in case
      return "Something weird is happening with terms in attendance";
    }
  }
  return false;
}

// do the courses that applicants list meet DS upper divison major requirements?
// do the courses listed for domain emphasis belong to the same DE?
function coursesSatisfyDsReq(idInfo, courseInfo, domainMap, requirements) {
  const de1 = idInfo["1st DE"];
  const unverified = [];
  const oneOfThree = [];
  // const cidUnits = 0; put in when access to course API is granted
  const cidCourses = ["ASTRON 128", "BIOENG 142", "CHEM 142", "CHEM 191", "COMPSCI 191", "PHYSICS 191",
    "COMPSCI 161", "COMPSCI 162", "COMPSCI 164", "COMPSCI 168", "COMPSCI 169", "COMPSCI 169L", "COMPSCI 169A",
    "COMPSCI 169", "COMPSCI 169A", "COMPSCI 170", "INDENG 165", "DATA 101",
    "COMPSCI 186", "COMPSCI 186", "COMPSCI 188", "CPH 100", "DATA 146", "DATA 101", "DATA 144", "DATA 145",
    "ECON 140", "ECON 141", "EECS 127", "ELENG 120", "ELENG 122", "ELENG 123", "ELENG 129", "ENVECON 118",
    "IAS 118", "ESPM 174", "INDENG 115", "INDENG 135", "INDENG 142B", "INDENG 160", "INDENG 162", "INDENG 164",
    "INDENG 166", "INDENG 173", "INDENG 174", "INFO 159", "INFO 190-1", "MATH 156", "NUCENG 175", "PHYSICS 188",
    "STAT 135", "STAT 150", "STAT 151A", "STAT 152", "STAT 153", "STAT 158", "STAT 159", "STAT 165", "UGBA 142"
  ];
  let cid3, cid4;

  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("course") && requirements.some(req => colName.startsWith(req))) {
      const courseName = courseInfo[colName];
      const baseReqName = colName.replace(" course", "");
      // domain emphasis
      if (baseReqName === "LD #10 DE" || baseReqName === "DS UD#7" || baseReqName === "DS UD#8") {
        const emphasis = domainMap.get(de1); 
        if (!emphasis || !emphasis.has(courseName)) {
          unverified.push(`${courseName} may not satisfy ${baseReqName} for first choice domain emphasis (${de1})`);
        }
      // other upper division courses
      } else if (baseReqName === "DS UD#1") {
        if (courseName !== "DATA 100") {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      } else if (baseReqName === "DS UD#2") { // probability
        const acceptedProb = ["DATA 140", "STAT 140", "EECS 126", "ELENG 126", "INDENG 172", "MATH 106", "STAT 134"]
        if (!acceptedProb.includes(courseName)) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
        if (courseName === "EECS 126") {
          oneOfThree.push(courseName);
        }
      } else if (baseReqName === "DS UD#3") { // computational & inferential depth = 7 units
        if (!cidCourses.includes(courseName)) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
        cid3 = courseName;
        if (courseName === "INDENG 173" || courseName === "STAT 150") {
          oneOfThree.push(courseName);
        }
        // cidUnits += ;
      } else if (baseReqName === "DS UD#4") { // computational & inferential depth = 7 units
         if (!cidCourses.includes(courseName)) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
        cid4 = courseName;
        if (courseName === "INDENG 173" || courseName === "STAT 150") {
          oneOfThree.push(courseName);
        }
        // cidUnits += ;
      } else if (baseReqName === "DS UD#5") { // Modeling, Learning, and Decision-Making 
        const acceptedMod = ["DATA 182", "COMPSCI 182", "DATA 182L", "COMPSCI 182L", 
          "DATA 182", "COMPSCI 182", "COMPSCI 189", "DATA 102", "STAT 102", "INDENG 142A", "STAT 154"
        ];
        if (courseName === "DATA 188" && Number(courseInfo[baseReqName + " sem"]) !== 2262) {
           unverified.push(`${courseName} taken in ${courseInfo[baseReqName + " sem"]} may not satisfy ${baseReqName}`);
        } else if (!acceptedMod.includes(courseName)) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      } else if (baseReqName === "DS UD#6") { // HCE 
        const acceptedHCE = ["ANTHRO 168", "CYPLAN 101", "DATA 104", "HISTORY 184D", "STS 104", "DIGHUM 100",
          "ESPM 167", "PUB HLTH 160", "INFO 101", "INFO 188", "ISF 100J", "NWMEDIA 151AC", "PHILOS 121",
          "POLECON 159", 
        ];
        if (courseName === "BIOENG 100" && Number(courseInfo[baseReqName + " sem"]) > 2258) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        } else if (courseName === "AMERSTD 134" || courseName === "AFRICAM 134") {
          if ( Number(courseInfo[baseReqName + " sem"]) > 2262) {
            unverified.push(`${courseName} may not satisfy ${baseReqName}`);
          }
        } else if (!acceptedHCE.includes(courseName)) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      } 
    }
  });
  if (cid3 === cid4) {
    unverified.push(`The same class ${cid3} was listed for both Computational and Inferential Depth courses`);
  }
  if (oneOfThree.length > 1) {
    unverified.push(`Only one of the following can be used to satisfy major requirements, but ${oneOfThree} are listed`);
  }
  return unverified;
}

// https://docs.google.com/spreadsheets/d/17iOiE6Sfu6IZOPIHT0vadOHjPt34dNLiGLUTla3yAE8/edit?gid=0#gid=0
function meetsCSAdmitReq(idInfo, courseInfo, currSem, cs_gpa) {
  // no transfers are eligible for comprehensive review
  const isTransfer = idInfo["FY vs TR"] === "Transfer";
  if (isTransfer) return "FALSE: Is transfer";

  const gradesNotAcceptedCompleted = ["P", "NP", "PL", "D+", "D-", "D", "F", "NA", "ENROLLED BUT NO GRADE", "I"];
  const gradesNotAcceptedInProgress = ["P", "NP", "D+", "D-", "D", "F", "NA"];
  // LD 1, LD 2 completed
  if (gradesNotAcceptedCompleted.includes(courseInfo["LD #1 Calc 1 grade"]) || gradesNotAcceptedCompleted.includes(courseInfo["LD #2 Calc 2 grade"])) {
    return "FALSE: Has not completed LD 1 or LD 2";
  }
  // LD 4 passing grade or enrolled currSem
  // if physics 89 must have physics listed as major
  const ld4sem = courseInfo["LD #4 LinAlg sem"];
  const ld4isFuture = ld4sem !== "Transfer" && parseInt(ld4sem) > currSem;
  if (ld4sem === "Other") {
    return "More investigation needed, see LD4";
  }
  if (courseInfo["LD #4 LinAlg course"] === "PHYSICS 89" && !idInfo["Current Major"].includes("Physics")) {
    return "FALSE: Reports Physics 89 for LD 4 but is not reporting a Physics major";
  }
  if (gradesNotAcceptedInProgress.includes(courseInfo["LD #4 LinAlg grade"]) || ld4isFuture) {
    return "FALSE: Has not completed or enrolled in LD 4";
  } 
  // LD 6, LD 7, LD 9 must have 1 completed, 2 enrolled
  const lower_div = ["LD #6", "LD #7", "LD #9"];
  const numReqCompleted = countReqCompleted(courseInfo, lower_div);
  const numReqEnrolled = countReqEnrolled(courseInfo, lower_div, currSem);
  if (numReqCompleted < 1 || numReqCompleted + numReqEnrolled != 3) {
    return "FALSE: Does not have 1 completed, 2 enrolled of LD 6, LD 7, and LD 9";
  }
  // majorGPA must be >= 3.0
  if (cs_gpa >= 3.0) {
    return true;
  } else if (numReqEnrolled > 0 || courseInfo["LD #4 LinAlg grade"] === "PL") {
    return "CONDTIONAL: GPA below 3.0 with courses in progress";
  } else {
    return "FALSE: GPA below 3.0";
  }
}

// do the courses that applicants list meet CS upper divison major requirements?
function coursesSatisfyCsReq(courseInfo, techElectives) {
  const unverified = [];
  const courses = new Set();
  const numsNotAccepted = [199, 198, 197, 195];
  const numsMaybeNotAccepted = [194, 191, 190];
  Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("course") && colName.includes("CS UD")) {
      const courseName = courseInfo[colName];
      const baseReqName = colName.replace(" course", "");
      if (baseReqName === "CS UD#1") { // design course
        courses.add(courseName);
        const acceptedDesign = ["COMPSCI 152", "COMPSCI 160", "COMPSCI 161", "COMPSCI 162", "COMPSCI 164", 
          "COMPSCI 168", "COMPSCI 169A", "COMPSCI 169L", "COMPSCI 180", "COMPSCI 182",
          "COMPSCI 184", "COMPSCI 185", "COMPSCI 186", "COMPSCI 186", "ELENG 128", "ELENG 130",
          "ELENG 140", "ELENG 143", "ELENG 192", "EECS 106A", "EECS 106B", "EECS 149", "EECS 151"];
        if (!acceptedDesign.includes(courseName)) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      } else if (baseReqName === "CS UD#2" || baseReqName === "CS UD#3") { // upper div CS courses
        const [dept, num] = courseName.split(" ");
        if (dept !== "COMPSCI") {
          unverified.push(`${courseName} may not satisfy ${baseReqName} (CS Upper Div)`);
        } else if (numsNotAccepted.includes(Number(num))) {
          unverified.push(`${courseName} may not satisfy ${baseReqName} (CS Upper Div)`);
        } else if (numsMaybeNotAccepted.includes(Number(num))) {
          unverified.push(`${courseName} may not satisfy ${baseReqName} (CS Upper Div); course may not be technical`);
        }
      } else if (baseReqName === "CS UD#4" || baseReqName === "CS UD#5") { // CS/ELENG/EECS upper div 
        const [dept, num] = courseName.split(" ");
        if (dept !== "COMPSCI" && dept !== "ELENG" && dept !== "EECS" && dept !== "EE") {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        } else if (numsNotAccepted.includes(Number(num))) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        } else if (numsMaybeNotAccepted.includes(Number(num))) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}; course may not be technical`);
        }
      } else if (baseReqName === "CS UD#6") { //technical electives
        const notAcceptedTechElectives = [199, 198, 197, 196, 195, 194, 190];
        const [dept, num] = courseName.split(" ");
        if (techElectives["courses"].has(courseName)) {
          return;
        } else if (notAcceptedTechElectives.includes(Number(num))) {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        } else if (techElectives["depts"].has(dept)) {
          return;
        } else {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      }
    }
  });
  return unverified;
}

// https://docs.google.com/spreadsheets/d/17iOiE6Sfu6IZOPIHT0vadOHjPt34dNLiGLUTla3yAE8/edit?gid=1222050180#gid=1222050180
function meetsStAdmitReq(idInfo, courseInfo, currSem) {
  const isTransfer = idInfo["FY vs TR"] === "Transfer";
  const termsInAttendance = idInfo["Terms in attendance"];
  const gradesNotAcceptedCompleted = ["P", "NP", "PL", "D+", "D-", "D", "F", "NA", "ENROLLED BUT NO GRADE", "I"];
  if (!isTransfer) { // first year admit
    if (termsInAttendance < 3) { // first year
      // completed LD 1; LD 2, LD 5 enrolled
      if (gradesNotAcceptedCompleted.includes(courseInfo["LD #1 Calc 1 grade"])) {
        return "FALSE: Has not completed LD 1 as a first year";
      }
      const lower_div = ["LD #2", "LD #5"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      const numReqEnrolled = countReqEnrolled(courseInfo, lower_div, currSem);

      if (numReqCompleted + numReqEnrolled === 2) {
        return true;
      } else {
        return "FALSE: Has not completed or enrolled in LD 2 or LD 5 as a first year";
      }
    } else if (termsInAttendance < 5) { // second year
      // completed LD 1, LD 2, LD 5; LD 3 or LD 4 enrolled
      const lower_div = ["LD #1", "LD #2", "LD #5"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      if (numReqCompleted != lower_div.length) {
        return "FALSE: Has not completed LD 1, LD 2, or LD 5 as a second year";
      } 
      const lower_div2 = ["LD #3", "LD #4"];
      const numReqCompleted2 = countReqCompleted(courseInfo, lower_div2);
      const numReqEnrolled2 = countReqEnrolled(courseInfo, lower_div2, currSem);

      if (numReqCompleted2 + numReqEnrolled2 === lower_div2.length) {
        return true;
      } else {
        return "FALSE: Has not completed or enrolled in LD 3 or LD 4 as a second year";
      }
    } else if (termsInAttendance < 7) { // third year
      // completed LD 1, LD 2, LD 5
      const lower_div = ["LD #1", "LD #2", "LD #5"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      if (numReqCompleted != lower_div.length) {
        return "FALSE: Has not completed LD 1, LD 2, or LD 5 as a third year";
      } 
      // LD 3/LD 4 one completed, one enrolled
      const lower_div2 = ["LD #3", "LD #4"];
      const numReqCompleted2 = countReqCompleted(courseInfo, lower_div2);
      const numReqEnrolled2 = countReqEnrolled(courseInfo, lower_div2, currSem);
      if (numReqCompleted2 + numReqEnrolled2 !== lower_div2.length) {
        return "FALSE: Has not completed or enrolled in LD 3 or LD 4 as a third year";
      }
      // ST UD#2 enrolled 
      if (courseInfo["ST UD#2 grade"] == "PL" || !gradesNotAcceptedCompleted.includes(courseInfo["ST UD#2 grade"])) {
        return true;
      } else {
        return "FALSE: Has not completed or enrolled in Upper Div 2 as a third year";
      }
    } else if (termsInAttendance > 7) { // applying with 4+ semesters at UC Berkeley
      return  `FALSE: Too many terms in attendance (${termsInAttendance} terms)`;
    }
  } else { // transfer admit
      // LD 1, LD 2 completed
      const lower_div = ["LD #1", "LD #2"];
      const numReqCompleted = countReqCompleted(courseInfo, lower_div);
      if (numReqCompleted != lower_div.length) {
        return "FALSE: Has not completed LD 1 or LD 2 as a transfer";
      } 
      // LD 5 enrolled
      if (gradesNotAcceptedCompleted.includes(courseInfo["LD #5 DSc8/St20 grade"])) {
        return "FALSE: Has not completed or enrolled in LD 5 as a transfer";
      }
      // LD 3/LD 4 one completed, one enrolled
      const lower_div2 = ["LD #3", "LD #4"];
      const numReqCompleted2 = countReqCompleted(courseInfo, lower_div2);
      const numReqEnrolled2 = countReqEnrolled(courseInfo, lower_div2, currSem);

      if (numReqCompleted2 + numReqEnrolled2 === lower_div2.length) {
        return true;
      } else {
        return "FALSE: Does not has one completed, one enrolled (or both completed) of LD 3 or LD 4 as a transfer";
      }
  }
}

// do the courses that applicants list meet ST upper divison major requirements?
function coursesSatisfyStReq(courseInfo, statCluster) {
  const unverified = [];
  let electiveLab = false;
  const electives = new Set();
  const clusterDepts = new Set();
  const clusters = new Set();
    Object.keys(courseInfo).forEach(colName => {
    if (colName.includes("course") && colName.includes("ST UD")) {
      const courseName = courseInfo[colName];
      const baseReqName = colName.replace(" course", "");
      if (baseReqName === "ST UD#1") { // core: computing
        if (courseName === "STAT 133") {
          return;
        } else if (courseName === "DATA 100") {
          unverified.push("Student lists Data 100 for Concepts in Computing with Data UD requirement; Stat 33B also required");
        } else {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      } else if (baseReqName === "ST UD#2") { // core: probability
        if (courseName === "STAT 134" || courseName === "DATA 140" || courseName === "EECS 126" || courseName === "MATH 106") {
          return;
        } else {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      } else if (baseReqName === "ST UD#3") { // core: statistics 
        if (courseName !== "STAT 135") {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      } else if (baseReqName === "ST UD#4" || baseReqName === "ST UD#5" ||
        baseReqName === "ST UD#6") { // electives
          electives.add(courseName);
          const acceptedElectivesLab = ["DATA 102", "STAT 102", "STAT 151A",
            "STAT 152", "STAT 153", "STAT 154", "STAT 156", "STAT 158", "STAT 159"];
          const acceptedElectivesNoLab = ["STAT 150", "STAT 155", "STAT 157", "STAT 165"];
          if (acceptedElectivesLab.includes(courseName)) {
            electiveLab = true;
          } else if (!acceptedElectivesNoLab.includes(courseName)) {
            unverified.push(`${courseName} may not satisfy ${baseReqName}`);
          } 
      } else if (baseReqName === "ST UD#7" || baseReqName === "ST UD#8" ||
        baseReqName === "ST UD#9") { // cluster
        clusters.add(courseName);
        if (statCluster.has(courseName)) {
          clusterDepts.add(courseName.split(" ")[0]);
        } else {
          unverified.push(`${courseName} may not satisfy ${baseReqName}`);
        }
      }
    }
  });
  if (clusters.size < 3) {
    unverified.push(`Student choose duplicate courses for cluster: ${Array.from(clusters).join(", ")}`)
  }
  if (clusterDepts.has("ECON") && clusterDepts.has("UGBA")) {
    clusterDepts.delete("UGBA");
  }
  if (clusterDepts.has("EECS") && clusterDepts.has("COMPSCI")) {
    clusterDepts.delete("EECS");
  }
  if (clusterDepts.size > 2) {
    unverified.push(`Student choose cluster courses from more than two departments: ${Array.from(clusterDepts).join(", ")}`)
  }
  if (electives.has("STAT 157") && electives.has("STAT 165")) {
    unverified.push("Student choose both Stat 157 and Stat 165 which may overlap on the topic of Forecasting")
  }
  if (electives.size < 3) {
    unverified.push(`Student choose duplicate electives: ${Array.from(electives).join(", ")}`)
  }
  if (!electiveLab) {
    unverified.push("Student did not choose any electives with a lab");
  }
  return unverified;
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
// (IN PROGRESS) check if proposed courses meet major requirements
function majorFlags(idInfo, courseInfo, reqMap, currSem) {
  const flags = {};
  // determine which majors the student is applying to
  const majors = [idInfo['First Choice Major'], idInfo['Second Choice Major'], idInfo['Third Choice Major']];
  // helper to check if any of the three major slots contain the target major
  const hasMajor = (target) => majors.some(m => m && m.includes(target));
  let requirements;
  if (hasMajor("Data Science")) {
    requirements = ["LD #1", "LD #2", "LD #4", "LD #5", "LD #6", "LD #7", "LD #10", "DS UD"];
    flags.major_gpa_ds = calculateMajorGPA(courseInfo, requirements);
    flags.problem_grades_ds = identifyProblemGrades(courseInfo, requirements);
    flags.meets_ds_admit_requirements = meetsDSAdmitReq(idInfo, courseInfo, currSem);
    flags.ds_ud_courses_unable_to_verify_if_approved = coursesSatisfyDsReq(idInfo, courseInfo, reqMap.get("DS Domain Emphasis"), ["LD #10", "DS UD"]);
  }
  if (hasMajor("Computer Science")) {
    requirements = ["LD #1", "LD #2", "LD #4", "LD #6", "LD #7", "LD #8", "LD #9", "CS UD"];
    const cs_gpa = calculateMajorGPA(courseInfo, requirements);
    flags.major_gpa_cs = cs_gpa;
    flags.problem_grades_cs = identifyProblemGrades(courseInfo, requirements);
    flags.meets_cs_admit_requirements = meetsCSAdmitReq(idInfo, courseInfo, currSem, cs_gpa);
    flags.cs_ud_courses_unable_to_verify_if_approved = coursesSatisfyCsReq(courseInfo, reqMap.get("CS Technical Electives"));
  } 
  if (hasMajor("Statistics")) {
    requirements = ["LD #1", "LD #2", "LD #3", "LD #4", "LD #5", "ST UD"];
    flags.major_gpa_st = calculateMajorGPA(courseInfo, requirements);
    flags.problem_grades_st = identifyProblemGrades(courseInfo, requirements);
    flags.meets_st_admit_requirements = meetsStAdmitReq(idInfo, courseInfo, currSem);
    flags.st_ud_courses_unable_to_verify_if_approved = coursesSatisfyStReq(courseInfo, reqMap.get("Stat Cluster"));
  }
  return flags;
}

// flag for student plan doesn't meet major requirements, 
function studentPlanFlags(dataMap, currSem, reqListLongId) {
  const sids = Object.keys(dataMap);

  sids.forEach(sid => {
    dataMap[sid].egt_flags = [];
    const idInfo = dataMap[sid].identifying_info;
    const courseInfo = dataMap[sid].course_info;
    const reqMap = getReqListLong(reqListLongId);

    if (dataMap[sid].unable_to_verify === "Not able to verify anything") {
      return;
    }

    dataMap[sid].egt_flags = egtFlags(idInfo, courseInfo, currSem);
    dataMap[sid].major_flags = majorFlags(idInfo, courseInfo, reqMap, currSem);
  });
}