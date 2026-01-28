// put buttons on the sheet for easy use
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Actions')
    .addItem('Test Work So Far', 'fullFunction')
    .addToUi();
}

function fullFunction() {
  const dataMap = getInput(false, true); // make both false later
  cleanCourses(dataMap);
  updateSheetWithCleanedData(dataMap); // remove later
  // verifyInfo(dataMap);
}

/* Read the input data
   Returns a map of {SID: { identifying_info: {col: val, ...}, 
                            course_info: {col: val, ...}}}
  To be used by later functions
*/
function getInput(verbose=false, write=false) {
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
    "Current College", "Current Major", "Change or Add", "CDSS Major", 
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
  });

  // output to a new sheet
  if (write) {
    let outputSheet = ss.getSheetByName("Intermediate Processed Data");
    if (!outputSheet) {
      outputSheet = ss.insertSheet("Intermediate Processed Data");
    } else {
      outputSheet.clear(); // clear old data before writing fresh results
    }
    outputSheet.getRange(1, 1, 1, updatedHeaders.length).setValues([updatedHeaders]);
    outputSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

    verbose && console.log(JSON.stringify(dataMap, null, 2));
  }
  return dataMap;
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

function updateSheetWithCleanedData(dataMap) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Intermediate Processed Data");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const sidIndex = headers.indexOf("SID");
  
  // skip headers
  const updatedRows = data.slice(1).map(row => {
    const sid = row[sidIndex];
    const studentData = dataMap[sid];
    
    if (!studentData) return row; // skip if SID not in map

    // create a new row based on the cleaned data in the map
    return headers.map(header => {
      // check if the value exists in course_info or identifying_info
      if (studentData.course_info.hasOwnProperty(header)) {
        return studentData.course_info[header];
      } else if (studentData.identifying_info.hasOwnProperty(header)) {
        return studentData.identifying_info[header];
      }
      return ""; // Fallback for columns not in map
    });
  });

  // write the cleaned 2D array back to the sheet starting at row 2
  sheet.getRange(2, 1, updatedRows.length, headers.length).setValues(updatedRows);
}

/* Verify information in dataMap using SID
   - 1st Sem
   - EGT
   - CGPA 
   - (maybe) Current College
   - (maybe) Current Major
   - Courses if any of course, grade, or sem don't line up, flag
     excluding transfer courses and test scores
  
  Returns dataMap with a new value:
   {SID: { identifying_info: {col: val, ...}, 
          course_info: {col: val, ...},
          unable_to_verify: [col1, col2, ...]}}
*/
function verifyInfo(dataMap) {

}
