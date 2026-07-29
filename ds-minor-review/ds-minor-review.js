/**
 * Reads approved Data Science Major/Minor courses from a Google Sheet and groups 
 * formatted course strings into specific degree requirement categories.
 *
 * Requirements tracked:
 *  - Foundations (lower division)
 *  - Program Structures (lower division)
 *  - Probability (lower division)
 *  - Gateway (upper division)
 *  - Human Contexts and Ethics (upper division)
 *  - Electives (upper division)
 *
 * @returns {Object<string, Set<string>>|null} An object mapping each requirement category 
 *   to a Set of course code strings (e.g., "DATA C8"). Returns an empty object `{}` if 
 *   required headers or the target tab are missing, or `null` if the sheet lacks data rows.
 */
function getApprovedCourses() {
  // spreadsheet with approved courses for the DS Major/Minor
  const file = SpreadsheetApp.openById("1OS7gdYGkc3_qjy4EkyNl9V3aZYCFV7rGP9PAOze7q4Y");
  const sheet = file.getSheetByName("All Approved");

  if (!sheet) {
    Logger.log("Sheet tab 'All Approved' not found.");
    return {};
  }

  const data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    Logger.log("Sheet is empty or missing data rows.");
    return null;
  }

  const headers = data[0];
  const reqIndex = headers.indexOf("Requirement");
  const listingIndex = headers.indexOf("Course Listing");
  const numberIndex = headers.indexOf("Course Number");

  if (reqIndex === -1 || listingIndex === -1 || numberIndex === -1) {
    Logger.log("One or more required headers were not found.");
    return {};
  }

  // helper to standardize course code strings
  const formatCourse = (row) => {
    const listing = String(row[listingIndex]).trim();
    const number = String(row[numberIndex]).trim();
    return `${listing} ${number}`;
  };

  // initialize the object to hold course Sets grouped by category
  const approvedCourses = {
    "Foundations": new Set(),
    "Program Structures": new Set(),
    "Probability": new Set(),
    "Gateway": new Set(),
    "Human Contexts and Ethics": new Set(),
    "Electives": new Set(),
    "All": new Set()
  };

  data.slice(1).forEach(row => {
    const reqValue = String(row[reqIndex]).toLowerCase();
    const course = formatCourse(row);
    // grouping logic based on Requirement column content
    if (reqValue.includes("minor foundations")) {
      approvedCourses["Foundations"].add(course);
      // foundations not added to "All" set because it is treated separately during evaluation of applicant
    } else if (reqValue.includes("minor program structures")) {
      approvedCourses["Program Structures"].add(course);
      approvedCourses["All"].add(course);
    } else if (reqValue.includes("minor probability")) {
      approvedCourses["Probability"].add(course);
      approvedCourses["All"].add(course);
    } else if (reqValue.includes("minor gateway")) {
      approvedCourses["Gateway"].add(course);
      approvedCourses["All"].add(course);
    } else if (reqValue.includes("human contexts and ethics")) {
      approvedCourses["Human Contexts and Ethics"].add(course);
      approvedCourses["All"].add(course);
    } else if (reqValue.includes("minor elective")) {
      approvedCourses["Electives"].add(course);
      approvedCourses["All"].add(course);
    } 
  });

  return approvedCourses;
}

/**
 * Normalizes a raw course name string into a standardized "DEPT NUMBER" format.
 * 
 * Performs the following transformations:
 * 1. Converts input to uppercase, trims whitespace, and strips parentheses.
 * 2. Standardizes cross-listed prefixes (e.g., "DATA/STAT" -> "DATA").
 * 3. Maps department aliases/shorthands to canonical prefixes (e.g., "CS" -> "COMPSCI").
 * 4. Collapses multi-word department spaces (e.g., "IND ENG" -> "INDENG").
 * 5. Extracts and cleans the course number, stripping trailing non-alphanumeric text.
 * 
 * @param {*} name - The input course identifier (typically a String, but accepts any type with `.toString()`).
 * @returns {string} The normalized course identifier string (e.g., "COMPSCI 61A", "DATA 8"), or the cleaned string if no course pattern matches.
 * 
 * @example
 * normalizeCourseName("  (cs 61a) "); 
 * // Returns: "COMPSCI 61A"
 * 
 * normalizeCourseName("DATA / STAT 8 - Intro to Data Science"); 
 * // Returns: "DATA 8"
 * 
 * normalizeCourseName("ind eng 162"); 
 * // Returns: "INDENG 162"
 */
function normalizeCourseName(name) {
  if (name == null) return "";
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
  const parts = clean.match(/^([A-Z]+)\s*([A-Z]?\d\S*)/);
  // const parts = clean.match(/^([A-Z]+)\s*[CNW]?\s*(\d\S*)/);
  
  if (parts) {
    let dept = parts[1];
    let num = parts[2];
    // trim trailing punctuation and words while keeping the alphanumeric course num intact
    num = num.split(/[^A-Z0-9]/)[0];

    return dept + " " + num;
  }

  return clean;
}

/**
 * Retrieves and filters form response rows from the "Form Responses 1" sheet.
 *
 * Filters the sheet data based on two main criteria:
 * 1. Submission date must be on or after May 26, 2026.
 * 2. "Type of Request" must NOT contain the word "drop" (case-insensitive).
 *
 * Assumes row[0] contains a parseable date/timestamp and row 1 contains headers.
 *
 * @returns {Array<Array<*>>} A 2D array of filtered data rows excluding the header row.
 */
function getRowsToProcess() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName("Form Responses 1"); 
  const data = inputSheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  // Set the start date (Year, Month Index [0-11], Day)
  const cutoffDate = new Date(2026, 4, 26);
  // Normalize to the very start of that day (00:00:00)
  cutoffDate.setHours(0, 0, 0, 0);

  const typeIndex = headers.indexOf("Type of Request");

  // filter for days including and after first day
  const filteredRows = rows.filter(row => {
    // filter for days including and after cutoffDate
    const rowTimestamp = new Date(row[0]);
    const isAfterCutoff = rowTimestamp >= cutoffDate;

    // filter for students dropping the minor
    const requestType = String(row[typeIndex] || "").toLowerCase();
    const isNotDrop = !requestType.includes("drop");

    return isAfterCutoff && isNotDrop;
  });
  
  return filteredRows;
}

/**
 * Finds the enrollment record matching course name and reported term,
 * falling back to the most recent record.
 *
 * @returns {Object|null} Enrollment record object containing grade and term information.
 */
function getRecordForTerm(enrollmentMap, courseName, termText) {
  if (!enrollmentMap || !enrollmentMap[courseName]) return null;
  
  const attempts = enrollmentMap[courseName];
  const targetTermId = parseTermToId(termText);

  if (targetTermId) {
    const match = attempts.find(attempt => attempt.termId === targetTermId);
    if (match) return match;
  }

  // default to most recent record
  return [...attempts].sort((a, b) => b.termId - a.termId)[0] || null;
}

/**
 * Normalizes semester input strings and converts them into Berkeley SIS numeric term IDs.
 * Accepts formats like: "Spring 2026", "spring2026", "sp2026", "sp 26", or "2026".
 * Defaults standalone years to the Spring semester.
 *
 * @param {string|number} term - The raw semester/term string.
 * @returns {number|null} The numeric SIS Term ID (e.g., 2262), or null if unparseable.
 */
function parseTermToId(term) {
  if (!term) return null;
  let s = String(term).toLowerCase().trim().replace(/\s+/g, " ");

  // standalone 4-digit year (e.g., "2026" or 2026) -> default to spring
  if (/^\d{4}$/.test(s)) {
    s = "sp" + s;
  }

  // extract semester and year
  const match = s.match(/^(sp|spring|su|summer|fa|fall)(\d{4})$/);
  if (!match) return null;

  const prefix = match[1];
  const yearFull = match[2];
  const yearShort = yearFull.slice(-2); // Take last 2 digits for SIS formula ("2026" -> "26")

  let semesterDigit;
  if (prefix.startsWith("sp")) {
    semesterDigit = "2";
  } else if (prefix.startsWith("su")) {
    semesterDigit = "5";
  } else if (prefix.startsWith("fa")) {
    semesterDigit = "8";
  }

  return Number("2" + yearShort + semesterDigit);
}

/**
 * Verifies if user reported grade matches API grade.
 */
function verifyGrade(reported, apiGrade) {
  if (!apiGrade) return false;
  
  const cleanReported = reported.trim().toUpperCase();
  const cleanApi = String(apiGrade).trim().toUpperCase();

  if ((cleanReported === "IP" || cleanReported === "IN PROGRESS") && cleanApi.includes("IN PROGRESS")) {
    return true;
  }

  return cleanReported === cleanApi;
}

/**
 * Processes student form responses to verify course selections and reported grades 
 * against official enrollment records and approved course lists.
 *
 * Reads header indexes directly from the active Google Sheet ("Form Responses 1")
 * and queries enrollment data per student ID.
 *
 * @param {Array<Array<*>>} rows - 2D array of form response rows (excluding header row).
 * @param {Object} approvedCourses - Lookup object containing approved course sets.
 *
 * @returns {Object.<string, Object>} Map of Student ID to verification results for 
 *   foundations, course1, course2, overall approval status, and grade verification.
 *
 * @requires fetchEnrollmentData - Helper to fetch official student record from API.
 * @requires normalizeCourseName - Helper to clean and format course strings.
 * @requires getRecordForTerm - Helper to pull a grade for a specific term/course combination.
 * @requires verifyGrade - Helper to compare reported vs. official API grades.
 * @requires parseTermToId - Helper that translates plain language to term ids used by API.
 */
function processRows(rows, approvedCourses) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName("Form Responses 1"); 
  const headers = inputSheet.getRange(1, 1, 1, inputSheet.getLastColumn()).getValues()[0];

  const sidIndex = headers.indexOf("UC Berkeley Student ID Number:");
  const d8termIndex = headers.indexOf("In which term did you complete Data C8 (COMPSCI/STAT C8) or Stat 20? (e.g. Fall 2024)");
  const d8gradeIndex = headers.indexOf("What was your final grade in Data C8 or Stat 20?")
  const c1Index = headers.indexOf("What is the first course that you have completed or have in progress toward the minor?");
  const c1TermIndex = headers.indexOf("In which term did you complete or will you complete Course #1? (e.g. Fall 2024)")
  const c1GradeIndex = headers.indexOf("If completed, what is your grade in Course #1? (if still in progress, list IP)");
  const c2Index = headers.indexOf("What is the second course that you have completed or have in progress toward the minor?");
  const c2TermIndex = headers.indexOf("In which term did you complete or will you complete Course #2? (e.g. Fall 2024)");
  const c2GradeIndex = headers.indexOf("If completed, what is your grade in Course #2? (if still in progress, list IP)");

  const resultsByStudent = {};
  const allApprovedSet = approvedCourses['All'];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sid = String(row[sidIndex] || "").trim();

    if (!sid) continue; // skip rows missing a Student ID
    const enrollment = fetchEnrollmentData(sid);

    // foundations course processing
    const reportedD8Grade = String(row[d8gradeIndex] || "").trim().toUpperCase();
    const d8TermText = d8termIndex !== -1 ? row[d8termIndex] : "";
    const d8TermId = parseTermToId(d8TermText);

    // Candidate course codes for Data 8 / Stat 20 cross-listings
    const foundationCourses = approvedCourses['Foundations'];
    let apiD8Grade = null;
    let apiD8Term = null;
    let d8MatchedCourse = "";

    if (enrollment) {
      for (const candidate of foundationCourses) {
        const attempt = getRecordForTerm(enrollment, candidate, d8TermText);
        if (attempt) {
          apiD8Grade = attempt.grade || null;
          apiD8Term = attempt.term || attempt.termId || null; // captures term name or ID
          d8MatchedCourse = candidate;
          break; 
        }
      }
    }

    const d8GradeMatches = verifyGrade(reportedD8Grade, apiD8Grade);

    // extract course fields
    const rawC1 = row[c1Index];
    const reportedC1Grade = String(row[c1GradeIndex] || "").trim().toUpperCase();
    const c1TermText = c1TermIndex !== -1 ? row[c1TermIndex] : "";
    const c1TermId = parseTermToId(c1TermText);
    const rawC2 = row[c2Index];
    const reportedC2Grade = String(row[c2GradeIndex] || "").trim().toUpperCase();
    const c2TermText = c2TermIndex !== -1 ? row[c2TermIndex] : "";
    const c2TermId = parseTermToId(c2TermText);

    // normalize course names
    const c1Normalized = rawC1 ? normalizeCourseName(rawC1) : "";
    const c2Normalized = rawC2 ? normalizeCourseName(rawC2) : "";

    // verify courses are on the approved list 
    const c1Approved = allApprovedSet.has(c1Normalized);
    const c2Approved = allApprovedSet.has(c2Normalized);

    // lookup API grade for matching term or most recent record
    const apiC1record = getRecordForTerm(enrollment, c1Normalized, c1TermText);
    const apiC2record = getRecordForTerm(enrollment, c2Normalized, c2TermText);

    const apiC1Grade = apiC1record?.grade || null;
    const apiC1Term = apiC1record?.term || apiC1record?.termId || null;

    const apiC2Grade = apiC2record?.grade || null;
    const apiC2Term = apiC2record?.term || apiC2record?.termId || null;

    const c1GradeMatches = verifyGrade(reportedC1Grade, apiC1Grade);
    const c2GradeMatches = verifyGrade(reportedC2Grade, apiC2Grade);

    const passingGrades = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'];
    const d8PassingGrade = passingGrades.includes(apiD8Grade) ? true : false;
    const c1PassingGrade = passingGrades.includes(apiC1Grade) ? true : false;
    const c2PassingGrade = passingGrades.includes(apiC2Grade) ? true : false;

    const allApproved = c1Approved && c2Approved;
    const allGradesVerified = c1GradeMatches && c2GradeMatches && d8GradeMatches;
    const allPassing = d8PassingGrade && c1PassingGrade && c2PassingGrade;
    const allVerified = allApproved && allGradesVerified && allPassing;

    // record results for this ID
    resultsByStudent[sid] = {
      sid: sid,
      foundations: {
        reportedTerm: d8TermId,
        reportedGrade: reportedD8Grade,
        apiGrade: apiD8Grade,
        apiTerm: apiD8Term,
        apiCourse: d8MatchedCourse, // records whether "DATA C8" or "STAT 20" was found
        gradeMatches: d8GradeMatches,
        passingGrade: d8PassingGrade,
        verified: d8GradeMatches && d8PassingGrade
      },
      course1: {
        raw: rawC1,
        normalized: c1Normalized,
        reportedTerm: c1TermId,
        reportedGrade: reportedC1Grade,
        apiGrade: apiC1Grade,
        apiTerm: apiC1Term,
        isApproved: c1Approved,
        gradeMatches: c1GradeMatches,
        passingGrade: c1PassingGrade,
        verified: c1Approved && c1GradeMatches && c1PassingGrade
      },
      course2: {
        raw: rawC2,
        normalized: c2Normalized,
        reportedTerm: c2TermId,
        reportedGrade: reportedC2Grade,
        apiGrade: apiC2Grade,
        apiTerm: apiC2Term,
        isApproved: c2Approved,
        gradeMatches: c2GradeMatches,
        passingGrade: c2PassingGrade,
        verified: c2Approved && c2GradeMatches && c2PassingGrade
      },
      allApproved: allApproved,
      allGradesVerified: allGradesVerified,
      allPassing: allPassing,
      allVerified: allVerified
    };
  }
  return resultsByStudent
}


/**
 * Fetches course enrollment history and calculates the earliest graded term for a given Berkeley student 
 * using the SIS Enrollment API v3.
 *
 * @param {string|number} studentId - The UC Berkeley Student ID (SID) to query.
 * @param {boolean} [verbose=false] - Optional. If true, logs the transformed enrollment 
 * mapping to Google Apps Script Logger.
 * 
 * @returns {Object<string, string|number>|null} A flat dictionary containing 
 * up to 3 most recent attempts per course (keyed by course name, attempt index, 
 * and attribute name). Returns `null` if the SID is missing or if the API request fails.
 *
 * @throws {Error} Implicitly caught internally; logs exceptions and returns `null`.
 */
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
      // Group enrollments by Course Display Name 
      const coursesMap = {};
      enrollments.forEach(e => {
        const termId = parseInt(e?.classSection?.class?.session?.term?.id);
        const grade = e?.grades?.[0]?.mark;
        const courseName = e?.classSection?.class?.course?.displayName;
        const units = e?.enrolledUnits?.taken;

        if (!courseName) return;
        
        if (!coursesMap[courseName]) coursesMap[courseName] = [];
        coursesMap[courseName].push({
          termId: parseInt(termId || 0),
          grade: grade || "IN PROGRESS",
          units:  units || 0 
        });
      });
      if (verbose) {
        Logger.log(`Mapping for ${studentId}: ` + JSON.stringify(coursesMap, null, 2));
      }
      return coursesMap;
    } else {
      Logger.log(`Enrollment API Error for ${studentId}: HTTP ${responseCode}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Enrollment API Exception for ${studentId}: ${error.toString()}`);
    return null;
  }
}


/**
 * Fetches undergraduate academic status (Expected Graduation Term and declared majors)
 * for a given Berkeley student using the SIS Student API v2.
 *
 * @param {string|number} studentId - The UC Berkeley Student ID (SID) to query.
 * @param {boolean} [verbose=false] - Optional. If true, logs the extracted student payload to Google Apps Script Logger.
 * 
 * @returns {Object|null} An object containing the student's graduation term and majors, 
 *                        or `null` if the SID is invalid, missing undergrad status, or if the API call fails.
 * @returns {string|null} return.egt - Expected Graduation Term ID (e.g., "2248"), or null if not found.
 * @returns {Array<string>} return.majors - List of formal major descriptions (e.g., ["Data Science BA", "Computer Science BA"]).
 *
 * @throws {Error} Implicitly caught internally; logs exceptions and returns `null`.
 */
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
        egt: null,
        majors: [],
      };
      
      if (student.academicStatuses && Array.isArray(student.academicStatuses)) {
        // confirm an active undergraduate status
        const undergradCareer = student.academicStatuses.find(status => 
          status.studentCareer?.academicCareer?.code === "UGRD"
        );
        if (undergradCareer) {
          // record major, college for each major plan and egt (egt should be the same if double major??)
          undergradCareer.studentPlans.forEach(plan => {
            if (plan.academicPlan?.type?.code !== "MAJ") return;
            studentData.egt = plan.expectedGraduationTerm?.id || null;
            studentData.majors.push(plan.academicPlan?.plan?.formalDescription);
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

function testProcess() {
  const approvedCourses = getApprovedCourses();
  const rows = getRowsToProcess();
  processRows(rows, approvedCourses);
}