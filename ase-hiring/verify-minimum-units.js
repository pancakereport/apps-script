// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('1. Verify Minimum Units', 'verifyMinimumUnits')
    .addSeparator()
    .addItem('2. Email ASEs Not Meeting Requirement', 'emailUnmetRequirement')
    .addToUi();
}

// placeholder email, {first}, {units}, {minimum}, {college} are replaced per student
const EMAIL_SUBJECT = "Action needed: ASE minimum unit enrollment requirement";
const EMAIL_BODY =
  "Hi {first},\n\n" +
  "Our records show you are currently enrolled in {units} units this term (waitlisted units don't count). " +
  "Academic student employees in {college} must be enrolled in at least {minimum} units " +
  "to hold an ASE appointment.\n\n" +
  "Please update your enrollment as soon as possible, or reply to this email if you believe " +
  "this is in error or have an approved Reduced Course Load.\n\n" +
  "Thank you.";

// students whose only college is CDSS and who graduate this term are RCL exempt.
// compared with normalizeCollege, so case, "&"/"and", and "College of" don't matter
const RCL_EXEMPT_COLLEGES = [
  "Clg of Comp Data Sci & Society",
  "College of Computing, Data Science & Society"
];

const OUTPUT_HEADERS = [
  "First name", "Last name", "Email", "Student ID", "EGT", "Home College",
  "Enrolled units", "Waitlisted units", "Total units",
  "Unit requirement met?", "RCL exempt?", "Notified"
];

// #############################
// ## CREATE THE OUTPUT SHEET ##
// #############################
function verifyMinimumUnits(verbose = false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("Fetching enrollment data...", "Process Started", -1);

  const termId = readTermId("Semester Input");
  const students = readStudents("SID Input");
  const minimums = readMinimums("Minimum Units by College");

  // keep RCL exempt / Notified values entered on a previous Output sheet
  const previous = readPreviousOutput("Output");

  // look up each SID once, even if it appears on multiple rows
  const unitsMap = {};
  const studentMap = {};
  for (const student of students) {
    const sid = student.sid;
    if (!(sid in unitsMap)) {
      unitsMap[sid] = fetchEnrollmentData(sid, termId, verbose);
    }
    // student API gives EGT (and the college if the input sheet doesn't have it)
    if (!(sid in studentMap)) {
      studentMap[sid] = fetchStudentInfo(sid, verbose);
    }
  }

  const rows = students.map(student => {
    const sid = student.sid;
    const units = unitsMap[sid];
    // shown even if it isn't on the minimum units sheet. If the student API
    // didn't find a college, show why, e.g. "[Student API: HTTP 403]"
    const info = studentMap[sid] || {};
    // use the input sheet's college when it's provided, otherwise the student API's
    const college = hasCollege(student.college) ? student.college : (info.college || "");
    const prev = previous[sid] || {};
    // input sheet first, then what was on Output last run, then auto-exempt
    let rcl = toBoolOrEmpty(student.rcl !== "" ? student.rcl : prev.rcl);
    if (rcl === "" && isAutoRclExempt(college, info.egt, termId)) rcl = true;

    // blank units = API error, -1 = API returned 404
    let enrolled = "", waitlisted = "", total = "", met = "";
    if (units) {
      enrolled = units.enrolled;
      waitlisted = units.waitlisted;
      total = units.notFound ? -1 : units.enrolled + units.waitlisted;
      const minimum = lookupMinimum(college, minimums);
      // blank if college isn't on the minimum units sheet
      if (minimum !== null) {
        // only enrolled units count, not waitlisted (-1 from a 404 is never met)
        met = units.enrolled >= minimum;
      }
    }
    // name and email: input sheet, then the API, then what was on Output last
    // run (so values typed into Output aren't lost when the API has nothing)
    const first = student.first || units?.first || prev.first || "";
    const last = student.last || units?.last || prev.last || "";
    const email = student.email || units?.email || prev.email || "";
    // met the requirement last run but not now, so clear Notified to email them again
    const notified = (prev.met === true && met === false) ? "" : (prev.notified || "");
    return [first, last, email, sid, info.egt || "", college,
            enrolled, waitlisted, total, met, rcl, notified];
  });

  writeOutput(rows, "Output");

  const collegeCol = OUTPUT_HEADERS.indexOf("Home College");
  const totalCol = OUTPUT_HEADERS.indexOf("Total units");
  const metCol = OUTPUT_HEADERS.indexOf("Unit requirement met?");
  const failed = rows.filter(r => r[totalCol] === "").length;
  const notFound = rows.filter(r => r[totalCol] === -1).length;
  const noCollege = rows.filter(r => r[collegeCol] === "" || String(r[collegeCol]).startsWith("[")).length;
  const unmatched = rows.filter(r => r[collegeCol] !== "" && !String(r[collegeCol]).startsWith("[") &&
    r[totalCol] !== "" && r[metCol] === "").length;
  const unmet = rows.filter(r => r[metCol] === false).length;
  let msg = `Checked ${rows.length} students for term ${termId}. ${unmet} below minimum.`;
  if (notFound) msg += ` ${notFound} had no enrollment found (units = -1).`;
  if (failed) msg += ` ${failed} enrollment lookups failed (blank units).`;
  if (noCollege) msg += ` ${noCollege} had no Home College found (see Home College column for why).`;
  if (unmatched) msg += ` ${unmatched} had a Home College not on "Minimum Units by College".`;
  Logger.log(msg);
  ss.toast(msg, "Process Complete", 10);
}

/** Read the term id from cell A1 of the semester sheet
 * Returns a string like "2262" (2 + 2-digit year + 2 Spring/5 Summer/8 Fall)
 * */
function readTermId(semesterSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(semesterSheetName);
  if (!sheet) {
    throw new Error(`Sheet not found. Ensure that a sheet called '${semesterSheetName}' exists`);
  }
  const termId = String(sheet.getRange("A1").getDisplayValue()).trim();
  if (!termId) {
    throw new Error(`Put the term id (e.g. 2262) in cell A1 of '${semesterSheetName}'.`);
  }
  return termId;
}

/** Read the input data
 * Returns a list of [{sid, first, last, email, college, rcl}, ...], one per row
 * (duplicate SIDs are kept). Only "Student ID" is required, other columns are
 * filled in if they exist (Admin Sheet or Supplemental column names).
 * */
function readStudents(inputSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName(inputSheetName);
  if (!inputSheet) {
    throw new Error(`Sheet with SIDs not found. Ensure that a sheet called '${inputSheetName}' exists`);
  }
  const data = inputSheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const rows = data.slice(1);

  // first matching header name wins
  const findIndex = names => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };
  const sidIndex = findIndex(["Student ID", "Student ID Number", "SID"]);
  const firstIndex = findIndex(["First name", "First Name"]);
  const lastIndex = findIndex(["Last name", "Last Name"]);
  const emailIndex = findIndex(["Email", "Email Address"]);
  const collegeIndex = findIndex(["Home College", "College"]);
  const rclIndex = findIndex(["RCL exempt?", "RCL exempt", "RCL Exempt"]);
  if (sidIndex === -1) {
    throw new Error(`Column "Student ID" not found on '${inputSheetName}'.`);
  }

  const getValue = (row, index) => index === -1 ? "" : String(row[index]).trim();
  const students = [];
  rows.forEach(row => {
    const sid = getValue(row, sidIndex);
    if (!sid) return;
    students.push({
      sid: sid,
      first: getValue(row, firstIndex),
      last: getValue(row, lastIndex),
      email: getValue(row, emailIndex),
      college: getValue(row, collegeIndex),
      rcl: rclIndex === -1 ? "" : row[rclIndex]
    });
  });
  return students;
}

/** Read the minimum units sheet
 * Returns a list of [{college: normalized name, units: number}, ...]
 * */
function readMinimums(minimumsSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(minimumsSheetName);
  if (!sheet) {
    throw new Error(`Sheet not found. Ensure that a sheet called '${minimumsSheetName}' exists`);
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const collegeIndex = headers.indexOf("College");
  const unitsIndex = headers.indexOf("Units");
  if (collegeIndex === -1 || unitsIndex === -1) {
    throw new Error(`'${minimumsSheetName}' needs "College" and "Units" columns.`);
  }
  return data.slice(1)
    .filter(row => row[collegeIndex] !== "" && row[unitsIndex] !== "")
    .map(row => ({ college: normalizeCollege(row[collegeIndex]), units: Number(row[unitsIndex]) }));
}

/** Read RCL exempt, Notified, Unit requirement met?, and name/email from a previous run so reruns keep them
 * Returns a map of {SID: {rcl: val, notified: val, met: val, first: val, last: val, email: val}}
 * */
function readPreviousOutput(outputSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(outputSheetName);
  const previous = {};
  if (!sheet) return previous;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return previous;
  const headers = data[0];
  const sidIndex = headers.indexOf("Student ID");
  const rclIndex = headers.indexOf("RCL exempt?");
  const notifiedIndex = headers.indexOf("Notified");
  const metIndex = headers.indexOf("Unit requirement met?");
  const firstIndex = headers.indexOf("First name");
  const lastIndex = headers.indexOf("Last name");
  const emailIndex = headers.indexOf("Email");
  if (sidIndex === -1) return previous;
  const getText = (row, index) => index === -1 ? "" : String(row[index]).trim();
  data.slice(1).forEach(row => {
    previous[String(row[sidIndex]).trim()] = {
      rcl: rclIndex === -1 ? "" : row[rclIndex],
      notified: notifiedIndex === -1 ? "" : row[notifiedIndex],
      met: metIndex === -1 ? "" : row[metIndex],
      first: getText(row, firstIndex),
      last: getText(row, lastIndex),
      email: getText(row, emailIndex)
    };
  });
  return previous;
}

// write output to sheet
function writeOutput(rows, outputSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let outputSheet = ss.getSheetByName(outputSheetName);
  // in case the sheet is holding data from a previous run, clear it here.
  if (outputSheet) {
    outputSheet.clear();
  } else {
    outputSheet = ss.insertSheet(outputSheetName);
  }
  outputSheet.getRange(1, 1, 1, OUTPUT_HEADERS.length).setValues([OUTPUT_HEADERS]);
  if (rows.length > 0) {
    outputSheet.getRange(2, 1, rows.length, OUTPUT_HEADERS.length).setValues(rows);
    // SIDs as plain text so leading zeros aren't dropped, EGT so term ids aren't numbers/dates
    ["Student ID", "EGT"].forEach(header => {
      outputSheet.getRange(2, OUTPUT_HEADERS.indexOf(header) + 1, rows.length, 1).setNumberFormat("@");
    });
  }
  // Formatting: Bold headers and freeze top row
  outputSheet.getRange(1, 1, 1, OUTPUT_HEADERS.length).setFontWeight("bold");
  outputSheet.setFrozenRows(1);
}

// ######################
// ## SIS API REQUESTS ##
// ######################

// test a single SID, check the Execution log for the full API output
function testSID() {
  const sid = "";
  Logger.log(JSON.stringify(fetchEnrollmentData(sid, readTermId("Semester Input"), true)));
  Logger.log(JSON.stringify(fetchStudentInfo(sid, true)));
}

/**
 * Sums enrolled and waitlisted units for a student in the given term, and
 * gets their name and email.
 * @param {string} studentId The student's ID.
 * @param {string} termId The SIS term id, e.g. "2262".
 * @returns {{enrolled: number, waitlisted: number, notFound: boolean,
 *            first: string, last: string, email: string}|null}
 *   -1 units with notFound = true (and no name/email) on a 404, null on any other error.
 */
function fetchEnrollmentData(studentId, termId, verbose = false) {
  if (!studentId) {
    Logger.log("You appear to have passed in an empty SID (enrollment API). Further investigation may be needed.")
    return null;
  }
  const url = `https://gateway.api.berkeley.edu/sis/v3/enrollments/students/${studentId}?term-id=${termId}&primary-only=true`;
  // same credentials as combine-data.js
  const scriptProps = PropertiesService.getScriptProperties();
  const app_id = scriptProps.getProperty('app_id');
  const app_key = scriptProps.getProperty('app_key');
  if (!app_id || !app_key) {
    throw new Error("Ensure Script Properties are Set for the API id and key");
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

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    // no enrollments found for this student/term
    if (responseCode === 404) {
      Logger.log(`No enrollment found for ${studentId} in ${termId} (HTTP 404)`);
      return { enrolled: -1, waitlisted: -1, notFound: true, first: "", last: "", email: "" };
    }
    if (responseCode === 200) {
      const json = JSON.parse(response.getContentText());
      const enrollments = json?.apiResponse?.response?.enrollmentsByStudent?.studentEnrollments || [];
      let enrolled = 0;
      let waitlisted = 0;
      enrollments.forEach(e => {
        // E = enrolled, W = waitlisted, D = dropped
        const status = e?.enrollmentStatus?.status?.code;
        const units = Number(e?.enrolledUnits?.taken) || 0;
        if (status === "E") enrolled += units;
        else if (status === "W") waitlisted += units;
      });
      if (verbose) {
        Logger.log(`Units for ${studentId}: enrolled ${enrolled}, waitlisted ${waitlisted}`);
      }
      // use the lived name (PRI), then preferred (PRF), then whatever is first
      const student = json?.apiResponse?.response?.enrollmentsByStudent?.student || {};
      const names = student.names || [];
      const name = names.find(n => n?.type?.code === "PRI") ||
        names.find(n => n?.type?.code === "PRF") || names[0] || {};
      // use the primary email, then campus email, then whatever is first
      const emails = student.emails || [];
      const email = emails.find(e => e?.primary) ||
        emails.find(e => e?.type?.code === "CAMP") || emails[0] || {};

      return {
        enrolled: enrolled,
        waitlisted: waitlisted,
        notFound: false,
        first: name.givenName || "",
        last: name.familyName || "",
        email: email.emailAddress || ""
      };
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
 * Gets the home college and expected graduation term (EGT) for each of a
 * student's majors, across all careers (undergrad and grad). Multiple
 * colleges / EGTs are joined with "; ".
 * If no college is found, college is a note in brackets saying why so it shows
 * up on the Output sheet, e.g. "[Student API: HTTP 403]", and EGT is blank.
 * @param {string} studentId The student's ID.
 * @returns {{college: string, egt: string}} e.g.
 *   {college: "College of Engineering", egt: "2268"}
 */
function fetchStudentInfo(studentId, verbose = false) {
  // on any error, show why in the college column
  const error = reason => ({ college: `[Student API: ${reason}]`, egt: "" });
  if (!studentId) {
    Logger.log("You appear to have passed in an empty SID (student API). Further investigation may be needed.")
    return error("empty SID");
  }
  const scriptProps = PropertiesService.getScriptProperties();
  const app_id = scriptProps.getProperty('APP_ID_STUDENT');
  const app_key = scriptProps.getProperty('APP_KEY_STUDENT');
  // student API is optional if the input sheet has a "Home College" column
  if (!app_id || !app_key) {
    Logger.log(`No Student API credentials set, no Home College or EGT for ${studentId}.`);
    return error("APP_ID_STUDENT / APP_KEY_STUDENT not set");
  }
  const url = `https://gateway.api.berkeley.edu/sis/v2/students/${studentId}?id-type=student-id&inc-acad=true&inc-cntc=false&inc-regs=false&inc-attr=false&inc-dmgr=false&inc-work=false&inc-dob=false&inc-gndr=false`;
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
      const student = json?.apiResponse?.response || {};
      if (verbose) {
        Logger.log(`Student API response for ${studentId}: ` + JSON.stringify(student, null, 2));
      }
      // ASEs can be grad students, so check every career (UGRD, GRAD, ...)
      const plans = [];
      const gradPlans = new Set();
      (student.academicStatuses || []).forEach(status => {
        (status.studentPlans || []).forEach(plan => {
          plans.push(plan);
          if (isGradPlan(plan, status)) gradPlans.add(plan);
        });
      });
      // record college for each major plan, or any plan if there are no majors
      const majorPlans = plans.filter(plan => plan.academicPlan?.type?.code === "MAJ");
      const usePlans = majorPlans.length > 0 ? majorPlans : plans;
      // undergrads: academicGroup is their college. grads: academicGroup is
      // "Graduate Division", so use the organization that owns the plan instead
      const colleges = [];
      collegesFromPlans(usePlans.filter(plan => !gradPlans.has(plan)), UNDERGRAD_LEVELS)
        .concat(collegesFromPlans(usePlans.filter(plan => gradPlans.has(plan)), GRAD_LEVELS))
        .forEach(college => {
          if (!colleges.includes(college)) colleges.push(college);
        });
      // EGT is a term id, e.g. "2268", same as pull-transcript-grades.js
      const egts = [];
      usePlans.forEach(plan => {
        const egt = plan.expectedGraduationTerm?.id;
        if (egt && !egts.includes(egt)) egts.push(egt);
      });
      // if the response isn't shaped as expected, take any academicGroup in it
      if (colleges.length === 0) {
        findAcademicGroups(student).forEach(college => {
          if (!colleges.includes(college)) colleges.push(college);
        });
      }
      if (colleges.length === 0) {
        // show the raw plan data so you can see where the college is
        const raw = plans.length > 0 ? JSON.stringify(plans) : JSON.stringify(student);
        Logger.log(`No college found for ${studentId}. Plans: ${raw}`);
        return { college: `[Student API: no college found. ${plans.length} plans: ${raw.slice(0, 2000)}]`, egt: egts.join("; ") };
      }
      if (verbose) {
        Logger.log(`Colleges for ${studentId}: ${colleges.join("; ")}, EGT: ${egts.join("; ")}`);
      }
      return { college: colleges.join("; "), egt: egts.join("; ") };
    } else {
      Logger.log(`Student API Error for ${studentId}: HTTP ${responseCode}`);
      return error(`HTTP ${responseCode}`);
    }
  } catch (e) {
    Logger.log(`Student API Exception for ${studentId}: ${e.toString()}`);
    return error(e.toString());
  }
}

// helpers to get colleges from a student's plans. Tries each level across
// all plans before moving to the next, so a plan missing its college doesn't
// add a major/department next to another plan's college.
// academicProgram is nested in academicPlan, i.e.
// studentPlans[].academicPlan.academicProgram.academicGroup
const programOf = plan => plan?.academicPlan?.academicProgram || plan?.academicProgram;
const groupOf = plan => programOf(plan)?.academicGroup;
const programLevel = plan => programOf(plan)?.program;
const ownerLevel = plan => plan?.academicPlan?.ownedBy?.[0]?.organization;

// undergrads:
// 1. academicGroup (e.g. "College of Engineering" or code "COE")
// 2. academicProgram (e.g. "Undergrad Engineering")
// 3. the organization that owns the plan (e.g. "Industrial Engineering and Operations Research")
const UNDERGRAD_LEVELS = [groupOf, programLevel, ownerLevel];

// grads: academicGroup is "Graduate Division", so
// 1. the organization that owns the plan (e.g. "College of Engineering")
// 2. academicGroup, unless it's Graduate Division
// 3. academicProgram
const GRAD_LEVELS = [
  ownerLevel,
  plan => isGraduateDivision(groupOf(plan)) ? null : groupOf(plan),
  programLevel
];

function collegesFromPlans(plans, levels) {
  for (const getField of levels) {
    const colleges = [];
    plans.forEach(plan => {
      const field = getField(plan) || {};
      const college = field.formalDescription || field.description || field.code;
      if (college && !colleges.includes(college)) colleges.push(college);
    });
    if (colleges.length > 0) return colleges;
  }
  return [];
}

// helper to check if a plan is a grad plan, from its career (GRAD) or
// because its academicGroup is Graduate Division
function isGradPlan(plan, status) {
  const careers = [
    status?.studentCareer?.academicCareer?.code,
    status?.academicCareer?.code,
    programOf(plan)?.academicCareer?.code
  ];
  return careers.includes("GRAD") || isGraduateDivision(groupOf(plan));
}

// helper to check if an academicGroup is Graduate Division
function isGraduateDivision(group) {
  if (!group) return false;
  return [group.formalDescription, group.description, group.code]
    .some(v => /^grad(uate)?\s*div(ision)?$|^graddiv$/i.test(String(v ?? "").trim()));
}

// helper to find every academicGroup (college) anywhere in an API response
function findAcademicGroups(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach(item => findAcademicGroups(item, found));
    return found;
  }
  for (const key of Object.keys(node)) {
    const group = node[key];
    if (key === "academicGroup" && (group?.formalDescription || group?.description || group?.code)) {
      found.push(group.formalDescription || group.description || group.code);
    } else {
      findAcademicGroups(group, found);
    }
  }
  return found;
}

// ########################
// ## COMPARE TO MINIMUM ##
// ########################

/**
 * Minimum units for a college. Matches exactly after normalizing, then by
 * substring (so "Engineering" matches "College of Engineering").
 * If a student belongs to more than one college ("A; B"), the highest minimum applies.
 * @returns {number|null} null when no college matches.
 */
function lookupMinimum(college, minimums) {
  // blank, or a "[Student API: ...]" note
  if (!college || String(college).startsWith("[")) return null;
  const found = [];
  String(college).split(";").forEach(c => {
    const key = normalizeCollege(c);
    if (!key) return;
    const match = minimums.find(m => m.college === key) ||
      minimums.find(m => m.college.includes(key) || key.includes(m.college));
    if (match) found.push(match.units);
  });
  return found.length > 0 ? Math.max(...found) : null;
}

// helper to check if a student is RCL exempt because their only college is
// CDSS and their EGT is the term being checked ("A; B" means more than one college)
function isAutoRclExempt(college, egt, termId) {
  const colleges = String(college ?? "").split(";").map(normalizeCollege).filter(c => c);
  const exempt = RCL_EXEMPT_COLLEGES.map(normalizeCollege);
  const egts = String(egt ?? "").split(";").map(e => e.trim()).filter(e => e);
  return colleges.length === 1 && exempt.includes(colleges[0]) &&
    egts.length > 0 && egts.every(e => e === String(termId).trim());
}

// helper to check if the input sheet has a college for a student,
// i.e. it's not blank or a placeholder ("N/A", "-", ...)
function hasCollege(college) {
  const placeholders = ["", "n/a", "#n/a", "na", "-", "none", "unknown", "tbd"];
  return !placeholders.includes(String(college ?? "").trim().toLowerCase());
}

// helper to compare college names
// "College of Letters & Science" -> "letters and science"
function normalizeCollege(college) {
  return String(college).toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(college|school|of|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// helper to turn "TRUE"/"yes"/"FALSE"/"no" etc. into true/false/""
function toBoolOrEmpty(val) {
  if (val === true || val === false) return val;
  const s = String(val ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return "";
}

// #################
// ## SEND EMAILS ##
// #################

// Emails every row where "Unit requirement met?" is FALSE, "RCL exempt?" is
// not TRUE, and "Notified" is empty. Stamps "Notified" with the send time so
// re-running doesn't double-send (clear the cell to resend).
function emailUnmetRequirement() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName("Output");
  if (!sheet) {
    throw new Error(`Run "Verify Minimum Units" first to create the 'Output' sheet.`);
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const firstIndex = headers.indexOf("First name");
  const emailIndex = headers.indexOf("Email");
  const sidIndex = headers.indexOf("Student ID");
  const collegeIndex = headers.indexOf("Home College");
  const enrolledIndex = headers.indexOf("Enrolled units");
  const metIndex = headers.indexOf("Unit requirement met?");
  const rclIndex = headers.indexOf("RCL exempt?");
  const notifiedIndex = headers.indexOf("Notified");
  if ([firstIndex, emailIndex, sidIndex, collegeIndex, enrolledIndex, metIndex, rclIndex, notifiedIndex].includes(-1)) {
    throw new Error("Missing one or more columns on 'Output'. Rerun Verify Minimum Units.");
  }
  const minimums = readMinimums("Minimum Units by College");

  // rows to email (index in data)
  const toEmail = [];
  const noEmail = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[metIndex] !== false || row[rclIndex] === true || row[notifiedIndex] !== "") continue;
    if (!row[emailIndex]) {
      noEmail.push(row[sidIndex]);
      continue;
    }
    toEmail.push(i);
  }
  if (noEmail.length > 0) {
    Logger.log(`No email address for: ${noEmail.join(", ")}`);
  }

  if (toEmail.length === 0) {
    ui.alert("No students to email." + (noEmail.length ? ` ${noEmail.length} below minimum have no email address.` : ""));
    return;
  }

  const remaining = MailApp.getRemainingDailyQuota();
  if (toEmail.length > remaining) {
    ui.alert(`${toEmail.length} emails needed but only ${remaining} remain in today's quota. Aborting.`);
    return;
  }

  const confirm = ui.alert(
    "Send emails?",
    `Send the unit requirement notice to ${toEmail.length} student(s)?` +
      (noEmail.length ? `\n\n${noEmail.length} below minimum have no email and will be skipped.` : ""),
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  let sent = 0;
  toEmail.forEach(i => {
    const row = data[i];
    const minimum = lookupMinimum(row[collegeIndex], minimums);
    const body = EMAIL_BODY
      .replace(/{first}/g, row[firstIndex] || "there")
      // -1 (no enrollment found) shows as 0
      .replace(/{units}/g, Math.max(0, Number(row[enrolledIndex])))
      .replace(/{minimum}/g, minimum ?? "the required number of")
      .replace(/{college}/g, row[collegeIndex] || "your college");
    try {
      MailApp.sendEmail(String(row[emailIndex]).trim(), EMAIL_SUBJECT, body);
      sheet.getRange(i + 1, notifiedIndex + 1).setValue(new Date());
      sent++;
    } catch (error) {
      Logger.log(`Failed to email ${row[emailIndex]}: ${error.toString()}`);
    }
  });
  ui.alert(`Sent ${sent} of ${toEmail.length} emails.`);
}
