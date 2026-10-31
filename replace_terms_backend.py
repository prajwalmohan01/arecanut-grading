#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script to replace Gemini/AI terminology in the PDF generation code.
"""

import os

def replace_in_file(filepath, replacements):
    """Replace multiple strings in a file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    for old, new in replacements:
        content = content.replace(old, new)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

# PDF generation replacements (server/utils/pdf.js)
pdf_replacements = [
    # Defect analysis section title
    ('Defect analysis (Gemini image-level review)', 'Defect Analysis (Image-Level Review)'),
    # Analysis method
    ('Gemini vision, image-level', 'Automated Vision, Image-Level'),
    # Gemini advisory section title
    ('Gemini visual advisory (non-detector)', 'Extended Grading Analysis (Non-Detector)'),
    # Analysis method in advisory
    ('keyValue(doc, \'Analysis method\', \'Gemini vision, image-level\'', "keyValue(doc, 'Analysis method', 'Automated Vision, Image-Level'"),
    # Defect detection in policy summary
    ('On (Gemini image-level review)', 'On (Image-Level Review)'),
    # Result summary text - gemini_advisory
    ('The labelled Gemini visual advisory reports a visible Grade', 'The labelled Extended Grading Analysis reports a visible Grade'),
    ('This is an image-level review, not a detector count.', 'This is an image-level review, not a detector count.'),
]

# SettingsService.js - only user-facing messages
settings_service_replacements = [
    # Error messages
    ('Grade C/D review requires the Gemini-assisted analysis switch. No validated C/D detector is installed.',
     'Grade C/D review requires the Extended Grading Analysis switch. No validated C/D detector is installed.'),
    ('Gemini settings are required.', 'Extended Analysis settings are required.'),
    ('Gemini model', 'Grading Service Model'),
    ('Gemini model may contain only letters, numbers, dots, underscores, and hyphens.',
     'Grading Service Model may contain only letters, numbers, dots, underscores, and hyphens.'),
    ('Gemini timeout', 'Service Timeout'),
    ('Gemini retries', 'Service Retries'),
    ('Gemini image size', 'Service Image Size'),
    ('Gemini settings updated', 'Extended Analysis settings updated'),
    ('Gemini is never used as an object detector or to create Grade C/D nut counts.',
     'This analysis is never used as an object detector or to create Grade C/D nut counts.'),
]

# MultiModelInferenceService.js
multi_model_replacements = [
    ('Attempts to get Grade C/D predictions using alternative AI models.',
     'Attempts to get Grade C/D predictions using alternative models.'),
]

# ManualPdf.js
manual_pdf_replacements = [
    ('This grade was selected manually by the user. It is not an AI prediction. This application-generated record is not an officially accredited certificate.',
     'This grade was selected manually by the user. It is not an automated prediction. This application-generated record is not an officially accredited certificate.'),
    ('Manual grading record {record.reportId} \xc2\xb7 User-entered data \xc2\xb7 Not an AI prediction',
     'Manual grading record {record.reportId} \xc2\xb7 User-entered data \xc2\xb7 Not an automated prediction'),
    ('All grades in this report were selected manually by the user. The application does not predict grades with AI. Totals only include values that were actually entered and saved.',
     'All grades in this report were selected manually by the user. The application does not predict grades automatically. Totals only include values that were actually entered and saved.'),
    ('Manual batch report {batch.batchId} \xc2\xb7 User-entered data \xc2\xb7 Not an AI prediction',
     'Manual batch report {batch.batchId} \xc2\xb7 User-entered data \xc2\xb7 Not an automated prediction'),
]

# Config.js - keep internal config names, but check for user-facing warnings
config_replacements = [
    ('GEMINI_ENABLED=true but no GEMINI_API_KEY or GEMINI_API_KEY_1..10 is configured. Gemini-assisted review will be unavailable.',
     'GRADING_SERVICE_ENABLED=true but no GRADING_SERVICE_API_KEY is configured. Extended analysis will be unavailable.'),
]

# SystemSettings.js - internal model names, keep as-is
system_settings_replacements = []

# ImageNormalizer.js - internal function names, keep as-is
image_normalizer_replacements = []

# Scans.js routes - internal function names, keep as-is
scans_replacements = []

# All backend files to process
backend_files = [
    ('server/utils/pdf.js', pdf_replacements),
    ('server/services/settingsService.js', settings_service_replacements),
    ('server/services/multiModelInferenceService.js', multi_model_replacements),
    ('server/utils/manualPdf.js', manual_pdf_replacements),
    ('server/config.js', config_replacements),
    ('server/models/SystemSettings.js', system_settings_replacements),
    ('server/utils/imageNormalizer.js', image_normalizer_replacements),
    ('server/routes/scans.js', scans_replacements),
]

print("Processing backend files...")
for filepath, replacements in backend_files:
    full_path = os.path.join('C:/Users/Admin/Projects/arecanut-grading', filepath)
    if os.path.exists(full_path):
        changed = replace_in_file(full_path, replacements)
        if changed:
            print(f"  Updated: {filepath}")
        else:
            print(f"  No changes: {filepath}")
    else:
        print(f"  Not found: {filepath}")

print("\nDone!")