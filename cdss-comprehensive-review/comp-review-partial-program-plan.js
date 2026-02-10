// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Test Work So Far', 'fullFunction')
    .addToUi();
}

function fullFunction() {
  const currSem = 2262;
  const dataMap = getInput();
  const enrollmentTruth = fetchEnrollmentDataAllStudents(dataMap);
  const flaggedCurrentEnrollment = verifyCurrentEnrollmentAllStudents(dataMap, enrollmentTruth, currSem);
}

/** Read the input data
 * Returns a map of {SID: { SID: 1234, ResponseId: 2345,
 *                          semId1: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                          semId2: [{course: courseName, grade: grade}, {course: courseName, grade: grade}, ...], 
 *                          ...}}
 * To be used by later functions
 * */
function getInput(verbose=false) {
  // read data
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName("Input"); 
  const data = inputSheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);
  // track the 3 columns for a single requirement together
  const courseGroups = {}; // Structure: { "LD #1 Calc": { courseIdx: 5, gradeIdx: 6, semIdx: 7 } }
  // rename headers
  const updatedHeaders = headers.map((header, index) => {
    if (header === "Basic Info_4") return "SID";
    // rename Lower Division: "LD N: <Requirement>#X_1" -> "LD N Requirement course|grade|sem"
    const ldMatch = header.match(/^LD (\d+)[: \-]+(.+)#(\d+)_1/);
    if (ldMatch) {
      const ldNum = ldMatch[1];     
      const reqName = ldMatch[2].trim(); 
      const typeCode = ldMatch[3];  
      const groupKey = `LD #${ldNum} ${reqName}`;
      const suffix = typeCode === "1" ? "course" : typeCode === "2" ? "grade" : "sem";
      if (!courseGroups[groupKey]) courseGroups[groupKey] = {};
      courseGroups[groupKey][suffix] = index;

      return `${groupKey} ${suffix}`;
    }
    return header;
  });
  // list of headers to keep in identifying_info
  const sidIndex = updatedHeaders.indexOf("SID");
  const respIdIndex = updatedHeaders.indexOf("ResponseId");
  const dataMap = {};

  // SID Map with SID, ResponseId, and course data partitioned by semester 
 rows.forEach(row => {
    const sid = row[sidIndex];
    if (!sid) return;

    dataMap[sid] = {
      SID: sid,
      ResponseId: row[respIdIndex]
    };

    // process course groups
    Object.keys(courseGroups).forEach(groupKey => {
      const indices = courseGroups[groupKey];
      const course = row[indices.course];
      const grade = row[indices.grade];
      const semId = row[indices.sem];

    // only add if data exists
      if (course && grade && semId) {
        // init semester array
        if (!dataMap[sid][semId]) {
          dataMap[sid][semId] = [];
        }

        dataMap[sid][semId].push({
          course: normalizeCourseName(course),
          grade: grade
        });
      }
    });
  });
  verbose && console.log(JSON.stringify(dataMap, null, 2));
  return dataMap;
}

// helper function to get course names that will more closely match API
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

// grab student enrollment data in the same format returned by getInput()
function fetchEnrollmentDataSingleStudent(studentId, verbose = false) {
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
      const enrollments = json?.apiResponse?.response?.enrollmentsByStudent?.studentEnrollments || [];

      let studentSemesters = {};

      enrollments.forEach(e => {
        const semId = e?.classSection?.class?.session?.term?.id;
        const courseName = e?.classSection?.class?.course?.displayName;
        const grade = e?.grades?.[0]?.mark || "ENROLLED";
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
        Logger.log(`Student API response for ${studentId}: ` + JSON.stringify(studentData, null, 2));
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
