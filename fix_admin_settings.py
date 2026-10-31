#!/usr/bin/env python3
# -*- coding: utf-8 -*-

with open('client/src/pages/AdminSettings.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# The file has the HTML entity & (5 chars)
old = '              Grading, Gemini & market policy'
new = '              Grading, Extended Analysis & market policy'

print('Old in content:', old in content)
print('Old repr:', repr(old))
print('Line 341 repr:', repr(content.split('\n')[340]))

content = content.replace(old, new)

with open('client/src/pages/AdminSettings.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')