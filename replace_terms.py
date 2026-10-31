#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script to replace Gemini/AI terminology in the Arecanut Quality Grading System.
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

# AdminSettings.jsx replacements
admin_settings_replacements = [
    # Page title
    ('Grading, Gemini & market policy', 'Grading, Extended Analysis & Market Policy'),
    # Status pill
    ('Gemini {policy.geminiEnabled ? \'on\' : \'off\'}', 'Extended Analysis {policy.geminiEnabled ? \'on\' : \'off\'}'),
    # Master prediction description
    ('Global switch for every AI grading output and price estimate.', 'Global switch for every automated grading output and price estimate.'),
    # Grade C/D description
    ('No validated C/D detector is installed. This requires Gemini-assisted visual review and still does not create per-nut counts.', 
     'No validated C/D detector is installed. This requires Extended Grading Analysis and still does not create per-nut counts.'),
    # Toggle label
    ('Gemini-assisted analysis', 'Extended Grading Analysis'),
    # Toggle description
    ('Advisory image-level review for C/D hints and enabled defect categories. Gemini is never used as an object detector and never creates counts or bounding boxes.',
     'Advisory image-level review for C/D hints and enabled defect categories. This analysis is never used as an object detector and never creates counts or bounding boxes.'),
    # Defect detection description
    ('Gemini reviews the original uploaded image for visible defect appearance.',
     'Extended analysis reviews the original uploaded image for visible defect appearance.'),
    # Limitation text
    ('Gemini cannot establish verified affected-nut counts, defect locations, bounding boxes,',
     'Extended analysis cannot establish verified affected-nut counts, defect locations, bounding boxes,'),
    # Card title
    ('Gemini advisory', 'Extended Grading Analysis'),
    # Warning message
    ('No Gemini key is configured. Grade C/D review and defect analysis cannot run until a server-side GEMINI_API_KEY is added and the backend is restarted.',
     'No grading service key is configured. Grade C/D review and defect analysis cannot run until a server-side service key is added and the backend is restarted.'),
    # Save button
    ('Save Gemini', 'Save Extended Analysis'),
    # Model issue message
    ('Grade C/D requires Gemini-assisted review. Enable the Gemini switch or turn C/D off.',
     'Grade C/D requires Extended Grading Analysis. Enable the Extended Analysis switch or turn C/D off.'),
    # Defect issue message
    ('Defect review is powered by Gemini. With Gemini-assisted analysis off, enabled defect categories will show "Analysis unavailable" rather than "Not detected".',
     'Defect review is powered by the grading service. With Extended Grading Analysis off, enabled defect categories will show "Analysis unavailable" rather than "Not detected".'),
    # Toast messages
    ('Gemini settings saved.', 'Extended Analysis settings saved.'),
    ('Could not save Gemini settings.', 'Could not save Extended Analysis settings.'),
]

# Dashboard.jsx replacements
dashboard_replacements = [
    ('Grade C/D stay uncounted unless a validated C/D detector is installed. Gemini',
     'Grade C/D stay uncounted unless a validated C/D detector is installed. Extended analysis'),
    ('Gemini image-level review across analysed images. These are status counts, not',
     'Extended image-level review across analysed images. These are status counts, not'),
]

# PolicyNotice.jsx replacements
policy_notice_replacements = [
    ('Grade {advisoryGrades.join(\' / Grade \')} is enabled for Gemini-assisted visual review',
     'Grade {advisoryGrades.join(\' / Grade \')} is enabled for Extended Grading Analysis visual review'),
    ('only. Gemini is not an object detector: it does not create per-nut counts, bounding',
     'only. This analysis is not an object detector: it does not create per-nut counts, bounding'),
]

# History.jsx replacements
history_replacements = [
    ('Gemini image-level review across matching predictions. Counts show how many stored',
     'Extended image-level review across matching predictions. Counts show how many stored'),
]

# LotDetail.jsx replacements
lot_detail_replacements = [
    ('uncounted unless a four-class detector is installed; Gemini advisories never create',
     'uncounted unless a four-class detector is installed; extended advisories never create'),
]

# Result.jsx replacements
result_replacements = [
    ('Gemini visual advisory — image-level review only; no per-nut count or confidence.',
     'Extended Grading Analysis — image-level review only; no per-nut count or confidence.'),
    ('Gemini advisory reports a visible example. Gemini is never used as an object',
     'Extended Grading Analysis reports a visible example. This analysis is never used as an object'),
    ('Gemini visual advisory',
     'Extended Grading Analysis'),
    ('Gemini image-level review. Findings are separate from grading and never',
     'Extended image-level review. Findings are separate from grading and never'),
    ('No defect analysis is stored for this prediction. Use retry to run Gemini against',
     'No defect analysis is stored for this prediction. Use retry to run extended analysis against'),
    ('Gemini-assisted analysis is disabled by the administrator. Ask an administrator',
     'Extended Grading Analysis is disabled by the administrator. Ask an administrator'),
]

# Upload.jsx replacements
upload_replacements = [
    ('AI grading is disabled by the administrator. Predictions are not run while master prediction is off.',
     'Automated grading is disabled by the administrator. Predictions are not run while master prediction is off.'),
    ('C / D grades (Gemini advisory only, never counted)',
     'C / D grades (Extended Grading Analysis only, never counted)'),
]

# AppLayout.jsx replacements
app_layout_replacements = [
    ('AI estimates and manual grades are decision-support only — not certified commercial grades',
     'Automated estimates and manual grades are decision-support only — not certified commercial grades'),
]

# Profile.jsx replacements
profile_replacements = [
    ('© 2026 Prajwal Mohan | Arecanut Quality Grading System | AI-Powered Detection & Grading | Contact: +91 76767 59149',
     '© 2026 Prajwal Mohan | Arecanut Quality Grading System | Automated Detection & Grading | Contact: +91 76767 59149'),
]

# ManualDashboard.jsx replacements
manual_dashboard_replacements = [
    ('<Badge tone="neutral">No AI prediction</Badge>',
     '<Badge tone="neutral">No automated prediction</Badge>'),
]

# ManualNew.jsx replacements
manual_new_replacements = [
    ('<Badge tone="neutral">No AI inference</Badge>',
     '<Badge tone="neutral">No automated inference</Badge>'),
    ('The grade is stored exactly as you selected it. This is not an AI prediction,',
     'The grade is stored exactly as you selected it. This is not an automated prediction,'),
]

# VerifyAssessment.jsx replacements
verify_replacements = [
    ('was selected by a person, not predicted by an AI model.',
     'was selected by a person, not predicted by an automated model.'),
]

# Format.js - internal logic, keep as-is but check for user-facing text
format_replacements = []

# All frontend files to process
frontend_files = [
    ('client/src/pages/AdminSettings.jsx', admin_settings_replacements),
    ('client/src/pages/Dashboard.jsx', dashboard_replacements),
    ('client/src/components/PolicyNotice.jsx', policy_notice_replacements),
    ('client/src/pages/History.jsx', history_replacements),
    ('client/src/pages/LotDetail.jsx', lot_detail_replacements),
    ('client/src/pages/Result.jsx', result_replacements),
    ('client/src/pages/Upload.jsx', upload_replacements),
    ('client/src/layouts/AppLayout.jsx', app_layout_replacements),
    ('client/src/pages/Profile.jsx', profile_replacements),
    ('client/src/pages/manual/ManualDashboard.jsx', manual_dashboard_replacements),
    ('client/src/pages/manual/ManualNew.jsx', manual_new_replacements),
    ('client/src/pages/VerifyAssessment.jsx', verify_replacements),
    ('client/src/utils/format.js', format_replacements),
]

print("Processing frontend files...")
for filepath, replacements in frontend_files:
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