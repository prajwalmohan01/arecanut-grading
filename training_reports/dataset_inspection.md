# Dataset inspection report

Generated: 2026-10-22T16:59:54.665572+00:00
KaggleHub: 1.0.3

## Summary

| Dataset | Images | Readable | Annotations | Label level | A/B/C/D labels | Bounding boxes |
| --- | ---: | ---: | --- | --- | --- | --- |
| duvacs/new-arecanut | 1167 | 1167 | 0 | image-level (folder/class labels) | none | no |
| subrahmanya090/arecanut | 424 (archive, lower bound) | 0 | 0 | image-level (folder/class labels) | none | no |
| tejpaviraj/arecanut | 2107 (archive, lower bound) | 0 | 0 | image-level (folder/class labels) | none | no |

## Per-dataset details

### duvacs/new-arecanut

- Resolved path: `C:\Users\Admin\.cache\kagglehub\datasets\duvacs\new-arecanut\versions\1`
- Total files: 1167
- Image files: 1167
- Readable images: 1167
- Unreadable images: 0
- Annotation files: 0
- Annotation formats: none
- Label level: image-level (folder/class labels)
- Explicit grade labels found: none
- Top folders: Unripen (629), Ripenes (538)
- Limitation: No YOLO/COCO/VOC bounding-box annotations were found. Object-detection training is not supported by this dataset as delivered; labels are image-level folder names only.

### subrahmanya090/arecanut

- Resolved path: `C:\Users\Admin\.cache\kagglehub\datasets\subrahmanya090\arecanut`
- Total files: 1
- Image files: 0
- Readable images: 0
- Unreadable images: 0
- Annotation files: 0
- Annotation formats: none
- Label level: image-level (folder/class labels)
- Explicit grade labels found: none
- Top folders: Bette (424)
- Archive `1.archive`: 424 entries streamed (truncated=True); lower-bound counts only.
- Limitation: Only archive files were found; KaggleHub did not extract them. Archive entries were streamed from the local headers, but the file has no end-of-central-directory record, so it is incomplete/truncated and the reported counts are a lower bound, not the full dataset.
- Limitation: No YOLO/COCO/VOC bounding-box annotations were found. Object-detection training is not supported by this dataset as delivered; labels are image-level folder names only.

### tejpaviraj/arecanut

- Resolved path: `C:\Users\Admin\.cache\kagglehub\datasets\tejpaviraj\arecanut`
- Total files: 1
- Image files: 0
- Readable images: 0
- Unreadable images: 0
- Annotation files: 0
- Annotation formats: none
- Label level: image-level (folder/class labels)
- Explicit grade labels found: none
- Top folders: Mahali_Koleroga (641), Healthy_Nut (472), Healthy_Trunk (359), yellow leaf disease (261), Healthy_Leaf (152), stem cracking (135), Stem_bleeding (38), bud borer (36), healthy_foot (13)
- Archive `2.archive`: 2107 entries streamed (truncated=True); lower-bound counts only.
- Limitation: Only archive files were found; KaggleHub did not extract them. Archive entries were streamed from the local headers, but the file has no end-of-central-directory record, so it is incomplete/truncated and the reported counts are a lower bound, not the full dataset.
- Limitation: No YOLO/COCO/VOC bounding-box annotations were found. Object-detection training is not supported by this dataset as delivered; labels are image-level folder names only.

## Grade C/D conclusion

No inspected dataset provides both explicit Grade C/D labels and individual-nut bounding boxes. The delivered datasets are image-level classifications (ripeness and plant-disease folders) with no nut-level grade annotations. Grade C/D cannot be trained from these files without fabricating labels. The current GradeA/GradeB detector is preserved. To enable C/D, annotate individual nuts with YOLO boxes labelled GradeA/GradeB/GradeC/GradeD, point scripts/prepare_dataset.py at that dataset, then run scripts/train_model.py and scripts/evaluate_model.py.
