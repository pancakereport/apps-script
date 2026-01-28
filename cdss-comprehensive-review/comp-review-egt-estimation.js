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
  // verifyInfo(dataMap);
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
    "Current College", "Current Major", "Change or Add",
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
  const headers = [...Object.keys(sample.identifying_info), ...Object.keys(sample.course_info)];

  // dataMap -> 2D Array
  const rows = sids.map(sid => {
    const student = dataMap[sid];
    return headers.map(h => student.identifying_info[h] ?? student.course_info[h] ?? "");
  });

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

// students enter their course names, these need to be cleaned for
// LD #10 and all upper division
function cleanCourses(dataMap) {
  const sids = Object.keys(dataMap);
  sids.forEach(sid => {
    const courseInfo = dataMap[sid].course_info;
    const courseColumns = Object.keys(courseInfo);
    courseColumns.forEach(colName => {
      // target "course" columns for LD 10 or Upper Div
      if (colName.includes("course") && (colName.includes("LD #10") || colName.includes("Upper Division"))) {
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

function normalizeCourseName(name) {
  // capitalize and trim
  let clean = name.toString().toUpperCase().trim();
  // "DATA/STAT" -> "DATA"
  clean = clean.replace(/^DATA\/STAT\s?/, "DATA ");

  // ensure space between department and number while accounting
  // for cross listed courses (C) and online (W)
  clean = clean.replace(/([A-Z]+)\s*([CW]?\d[A-Z0-9]*).*/, "$1 $2");

  // common department shorthand
  const mapping = {
    "^CS\\b": "COMPSCI",
    "^COMP SCI\\b": "COMPSCI",
    "^EE\\b": "EECS",
    "^SOCIOLOGY\\b": "SOCIOL",
    "^STATISTICS\\b": "STAT"
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

/** Verify information in dataMap using SID
 * - 1st Sem
 * - EGT
 * - CGPA 
 * - (maybe) Current College
 * - (maybe) Current Major
 * - Courses if any of course, grade, or sem don't line up, flag
 *   excluding transfer courses and test scores
 * 
 * Returns dataMap with a new value:
 * {SID: { identifying_info: {col: val, ...}, 
 *         course_info: {col: val, ...},
 *         unable_to_verify: [col1, col2, ...]}}
 */ 
function verifyInfo(dataMap) {

}
