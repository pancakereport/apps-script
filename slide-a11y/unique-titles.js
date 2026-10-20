/**
 * Scans the presentation for duplicate slide titles,
 * appends " - Part 1", " - Part 2", etc., and dynamically
 * scales font sizes down to prevent text from being cut off.
 */
function fixDuplicateSlideTitles() {
  const presentation = SlidesApp.getActivePresentation();
  const slides = presentation.getSlides();
  
  const titleCounts = {};
  const slideTitleInfo = [];

  // Pass 1: Gather clean titles (removing previous " - Part X" if re-running)
  slides.forEach((slide) => {
    const titleShape = slide.getShapes().find(shape => {
      const type = shape.getPlaceholderType();
      return type === SlidesApp.PlaceholderType.TITLE ||
             type === SlidesApp.PlaceholderType.CENTERED_TITLE;
    });

    if (titleShape && titleShape.getText()) {
      const rawTitle = titleShape.getText().asString().trim();
      
      // Strip any existing " - Part X" pattern if user is re-running the script
      const cleanTitle = rawTitle.replace(/\s*-\s*Part\s*\d+$/i, '');
      
      if (cleanTitle.length > 0) {
        titleCounts[cleanTitle] = (titleCounts[cleanTitle] || 0) + 1;
        
        let fontSize = null;
        try {
          fontSize = titleShape.getText().getTextStyle().getFontSize();
        } catch (e) {
          // Fallback if mixed font sizes exist
        }

        slideTitleInfo.push({
          slide: slide,
          titleShape: titleShape,
          cleanTitle: cleanTitle,
          originalFontSize: fontSize
        });
      }
    }
  });

  const currentPartTracker = {};

  // Pass 2: Append part numbers and auto-scale font size
  let updatedCount = 0;
  slideTitleInfo.forEach((info) => {
    const title = info.cleanTitle;
    
    if (titleCounts[title] > 1) {
      currentPartTracker[title] = (currentPartTracker[title] || 0) + 1;
      const partNumber = currentPartTracker[title];
      
      const newTitle = `${title} - Part ${partNumber}`;
      const textRange = info.titleShape.getText();
      
      // Set new text
      textRange.setText(newTitle);
      
      // Auto-scale font size to prevent overflow / cut off
      if (info.originalFontSize) {
        const lengthRatio = info.cleanTitle.length / newTitle.length;
        // Calculate scaling factor (capped at minimum 70% scale and 12pt font)
        const scaleFactor = Math.min(1, Math.max(0.7, lengthRatio));
        const newFontSize = Math.max(12, Math.floor(info.originalFontSize * scaleFactor));
        
        textRange.getTextStyle().setFontSize(newFontSize);
      }
      
      updatedCount++;
    }
  });

  const ui = SlidesApp.getUi();
  if (updatedCount > 0) {
    ui.alert('Complete', `Successfully updated ${updatedCount} slide title(s) and adjusted font sizes.`, ui.ButtonSet.OK);
  } else {
    ui.alert('No Duplicates', 'No duplicate slide titles were found.', ui.ButtonSet.OK);
  }
}

/**
 * Uses Gemini (Multimodal) to analyze slide images, text, and notes
 * to generate distinct, context-aware titles.
 */
function disambiguateDuplicateTitlesWithGemini() {
  const ui = SlidesApp.getUi();
  
  // Retrieve API Key
  let apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    const response = ui.prompt(
      'Gemini API Key Required',
      'Please enter your Gemini / GCP API Key (or save it in Project Settings > Script Properties as GEMINI_API_KEY):',
      ui.ButtonSet.OK_CANCEL
    );
    if (response.getSelectedButton() !== ui.Button.OK) return;
    apiKey = response.getResponseText().trim();
    if (!apiKey) {
      ui.alert('Error', 'API Key is required to run this function.', ui.ButtonSet.OK);
      return;
    }
  }

  const presentation = SlidesApp.getActivePresentation();
  const slides = presentation.getSlides();

  // Group duplicate slides by clean title
  const titleGroups = {};

  slides.forEach((slide) => {
    const titleShape = getTitleShape(slide);

    if (titleShape && titleShape.getText()) {
      const rawTitle = titleShape.getText().asString().trim();
      const cleanTitle = rawTitle.replace(/\s*-\s*Part\s*\d+$/i, '');

      if (cleanTitle.length > 0) {
        let fontSize = null;
        try {
          fontSize = titleShape.getText().getTextStyle().getFontSize();
        } catch (e) {}

        if (!titleGroups[cleanTitle]) {
          titleGroups[cleanTitle] = [];
        }

        titleGroups[cleanTitle].push({
          slide: slide,
          titleShape: titleShape,
          originalTitle: cleanTitle,
          originalFontSize: fontSize
        });
      }
    }
  });

  let totalUpdated = 0;

  for (const [title, group] of Object.entries(titleGroups)) {
    if (group.length > 1) {
      try {
        const newTitles = generateUniqueTitlesWithGemini(title, group, apiKey);

        group.forEach((item, index) => {
          const proposedTitle = newTitles[index];
          const textRange = item.titleShape.getText();
          
          textRange.setText(proposedTitle);

          // Auto-scale font size
          if (item.originalFontSize) {
            const lengthRatio = item.originalTitle.length / proposedTitle.length;
            const scaleFactor = Math.min(1, Math.max(0.7, lengthRatio));
            const newFontSize = Math.max(12, Math.floor(item.originalFontSize * scaleFactor));
            textRange.getTextStyle().setFontSize(newFontSize);
          }

          totalUpdated++;
        });
      } catch (err) {
        ui.alert('Gemini Error', `Failed to rename slides for "${title}":\n\n${err.message}`, ui.ButtonSet.OK);
        return;
      }
    }
  }

  if (totalUpdated > 0) {
    ui.alert('Complete', `Gemini visually analyzed duplicates and updated ${totalUpdated} slide title(s).`, ui.ButtonSet.OK);
  } else {
    ui.alert('No Duplicates', 'No duplicate slide titles were found.', ui.ButtonSet.OK);
  }
}

/**
 * Safely flattens all page elements on a slide, recursively unwrapping grouped elements.
 */
function getAllPageElements(container) {
  let elements = [];
  const children = container.getPageElements ? container.getPageElements() : container.getChildren();

  children.forEach((el) => {
    if (el.getPageElementType() === SlidesApp.PageElementType.GROUP) {
      elements = elements.concat(getAllPageElements(el.asGroup()));
    } else {
      elements.push(el);
    }
  });

  return elements;
}

/**
 * Safely locates the primary title shape of a slide without type exceptions.
 */
function getTitleShape(slide) {
  const elements = getAllPageElements(slide);
  for (const el of elements) {
    if (el.getPageElementType() === SlidesApp.PageElementType.SHAPE) {
      const shape = el.asShape();
      const type = shape.getPlaceholderType();
      if (type === SlidesApp.PlaceholderType.TITLE || type === SlidesApp.PlaceholderType.CENTERED_TITLE) {
        return shape;
      }
    }
  }
  return null;
}

/**
 * Extracts slide text AND encodes embedded images as base64 parts with correct REST fields.
 */
function extractSlideParts(slide) {
  const parts = [];
  const elements = getAllPageElements(slide);

  // 1. Gather text content (shapes, tables, notes)
  const textParts = [];

  elements.forEach((el) => {
    const type = el.getPageElementType();

    if (type === SlidesApp.PageElementType.SHAPE) {
      const shape = el.asShape();
      if (shape.getText()) {
        const txt = shape.getText().asString().trim();
        if (txt) textParts.push(txt);
      }
    } else if (type === SlidesApp.PageElementType.TABLE) {
      const table = el.asTable();
      for (let r = 0; r < table.getNumRows(); r++) {
        for (let c = 0; c < table.getNumColumns(); c++) {
          const txt = table.getCell(r, c).getText().asString().trim();
          if (txt) textParts.push(txt);
        }
      }
    }
  });

  try {
    const notes = slide.getNotesPage().getSpeakerNotes().getText().asString().trim();
    if (notes) textParts.push(`[Speaker Notes: ${notes}]`);
  } catch (e) {}

  if (textParts.length > 0) {
    parts.push({ text: `Slide Text:\n${textParts.join('\n')}` });
  }

  // 2. Gather slide images with correct REST field names (inline_data and mime_type)
  let imgIdx = 1;
  elements.forEach((el) => {
    if (el.getPageElementType() === SlidesApp.PageElementType.IMAGE) {
      try {
        const img = el.asImage();
        const blob = img.getBlob();
        let mimeType = blob.getContentType();

        if (!mimeType || !mimeType.startsWith('image/')) {
          mimeType = 'image/png';
        }

        const base64Data = Utilities.base64Encode(blob.getBytes());

        // Cap per-image base64 size (~2.5MB) to keep payload within UrlFetch limits
        if (base64Data.length < 2.5 * 1024 * 1024) {
          parts.push({ text: `[Slide Image ${imgIdx}:]` });
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          });
          imgIdx++;
        }
      } catch (e) {
        Logger.log(`Failed to process slide image: ${e.message}`);
      }
    }
  });

  return parts;
}

/**
 * Sends multimodal payload to Gemini 3.8 Flash.
 */
function generateUniqueTitlesWithGemini(originalTitle, group, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  const promptText = `You are a professional presentation editor.
The following ${group.length} slides currently share the exact same title: "${originalTitle}".

Analyze the provided slide images, diagrams, charts, and text content for each slide. 
Identify what visual content, subtopic, or focus sets each slide apart.
Generate ${group.length} unique, concise, descriptive titles (6-9 words max) that differentiate each slide based on its visual or text focus.

Return ONLY a valid JSON object formatted as:
{
  "titles": ["Title for Slide 1", "Title for Slide 2"]
}`;

  const contentsParts = [{ text: promptText }];

  group.forEach((item, idx) => {
    contentsParts.push({ text: `\n=== SLIDE ${idx + 1} ===` });
    const slideParts = extractSlideParts(item.slide);
    if (slideParts.length === 0) {
      contentsParts.push({ text: `(No text or images found on this slide)` });
    } else {
      contentsParts.push(...slideParts);
    }
  });

  const payload = {
    contents: [{ parts: contentsParts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(endpoint, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`HTTP ${responseCode}: ${responseText}`);
  }

  const json = JSON.parse(responseText);

  if (json.error) {
    throw new Error(`Gemini API Error: ${json.error.message || JSON.stringify(json.error)}`);
  }

  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0].text) {
    const rawText = json.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed.titles) && parsed.titles.length === group.length) {
      return parsed.titles;
    } else {
      throw new Error(`Gemini returned an invalid title count. Expected ${group.length}, got: ${rawText}`);
    }
  }

  throw new Error(`Unexpected Gemini response format: ${responseText}`);
}

/**
 * Adds custom menu items to Google Slides menu bar.
 */
function onOpen() {
  const ui = SlidesApp.getUi();
  ui.createMenu('Slide Tools')
    .addItem('Fix Duplicate Titles (Part 1, 2...)', 'fixDuplicateSlideTitles')
    .addItem('Smart Rename Duplicates (Gemini AI)', 'disambiguateDuplicateTitlesWithGemini')
    .addToUi();
}