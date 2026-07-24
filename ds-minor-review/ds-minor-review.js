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
    "Foundations": new Set(["DATA C8", "STAT 20"]),
    "Program Structures": new Set(),
    "Probability": new Set(),
    "Gateway": new Set(),
    "Human Contexts and Ethics": new Set(),
    "Electives": new Set()
  };

  data.slice(1).forEach(row => {
    const reqValue = String(row[reqIndex]).toLowerCase();
    const course = formatCourse(row);
    // grouping logic based on Requirement column content
    if (reqValue.includes("minor foundations")) {
        approvedCourses["Foundations"].add(course);
    } else if (reqValue.includes("minor program structures")) {
      approvedCourses["Program Structures"].add(course);
    } else if (reqValue.includes("minor probability")) {
      approvedCourses["Probability"].add(course);
    } else if (reqValue.includes("minor gateway")) {
        approvedCourses["Gateway"].add(course);
    } else if (reqValue.includes("human contexts and ethics")) {
      approvedCourses["Human Contexts and Ethics"].add(course);
    } else if (reqValue.includes("minor elective")) {
      approvedCourses["Electives"].add(course);
    } 
  });

  return approvedCourses;
}
