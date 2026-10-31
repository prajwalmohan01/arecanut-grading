#!/usr/bin/env python3
# -*- coding: utf-8 -*-

with open('client/src/pages/AdminSettings.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and replace the line containing "Grading, Gemini"
for i, line in enumerate(lines):
    if 'Grading, Gemini' in line:
        print(f'Found on line {i+1}: {repr(line.rstrip())}')
        # Replace "Gemini" with "Extended Analysis" on this line
        lines[i] = line.replace('Gemini', 'Extended Analysis')
        print(f'Changed to: {repr(lines[i].rstrip())}')
        break

with open('client/src/pages/AdminSettings.jsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Done')