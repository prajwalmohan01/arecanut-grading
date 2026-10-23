# Dataset inspection report

Generated: 2026-10-23T07:52:14.112833+00:00
KaggleHub: 1.0.3

## Summary

| Dataset | Images | Readable | Annotation files | Label level | A/B/C/D labels | Boxes (classes) |
| --- | ---: | ---: | --- | --- | --- | --- |
| duvacs/new-arecanut | 1167 | 1167 | 0 | image-level (folder/class labels) | none | no |
| subrahmanya090/arecanut | 424 (archive, lower bound) | 0 | 0 | image-level (folder/class labels) | none | no |
| tejpaviraj/arecanut | 2107 (archive, lower bound) | 0 | 0 | image-level (folder/class labels) | none | no |
| alwyndsouza21092/arecanut | 4501 | 4501 | 2 | individual-nut (VIA boxes; classes: areca_fruit) | none | 2435 (areca_fruit) |
| alwyndsouza21092/arecanut-detection-dataset-1 | 10650 (annotation file; images not downloaded) | — | 1 | individual-nut (VIA boxes; classes: areca_fruit) | none | 8374 (areca_fruit) |

## Per-dataset details

### duvacs/new-arecanut

- Resolved path: `~/.cache/kagglehub/datasets/duvacs/new-arecanut/versions/1`
- Total files: 1167
- Image files: 1167
- Readable images: 1167
- Unreadable images: 0
- Annotation files: 0
- Annotation formats: none
- Label level: image-level (folder/class labels)
- Explicit grade labels found: none
- Top folders: Unripen (629), Ripenes (538)
- Limitation: No YOLO/VIA/COCO/VOC bounding-box annotations were found. Object-detection training is not supported by this dataset as delivered; labels are image-level folder names only.

### subrahmanya090/arecanut

- Resolved path: `~/.cache/kagglehub/datasets/subrahmanya090/arecanut`
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
- Limitation: No YOLO/VIA/COCO/VOC bounding-box annotations were found. Object-detection training is not supported by this dataset as delivered; labels are image-level folder names only.

### tejpaviraj/arecanut

- Resolved path: `~/.cache/kagglehub/datasets/tejpaviraj/arecanut`
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
- Limitation: No YOLO/VIA/COCO/VOC bounding-box annotations were found. Object-detection training is not supported by this dataset as delivered; labels are image-level folder names only.

### alwyndsouza21092/arecanut

- Resolved path: `~/.cache/kagglehub/datasets/alwyndsouza21092/arecanut/versions/1`
- Total files: 4503
- Image files: 4501
- Readable images: 4501
- Unreadable images: 0
- Annotation files: 2
- Annotation formats: .csv, .json
- VIA annotation files: detection_combined_annotations_csv (1).csv, training_images-20240405T112216Z-001\training_images\via_project_25Mar2024_15h0m.json
- VIA image records: 1704 (1531 with boxes, 173 without boxes)
- VIA boxes: 2435
- VIA class values: areca_fruit (2435)
- Annotation class names: areca_fruit
- Label level: individual-nut (VIA boxes; classes: areca_fruit)
- Explicit grade labels found: none
- Top folders: training_images (1704), class_3 (526), class_0 (482), class_2 (474), class_1 (444), class_6 (310), class_5 (307), class_4 (254)
- Limitation: VIA annotations contain 2435 individual-nut box(es) with class name(s) areca_fruit, not GradeA/GradeB/GradeC/GradeD. They can train a single-class nut localizer, not the application's grade head.
- Limitation: Folder labels are opaque (class_0, class_1, class_2, class_3, class_4, class_5, class_6). Their meanings are not documented, so they are not mapped to GradeA/GradeB/GradeC/GradeD.

### alwyndsouza21092/arecanut-detection-dataset-1

- Resolved path: `~/.cache/kagglehub/datasets/alwyndsouza21092/arecanut-detection-dataset-1/versions/1`
- Total files: 1
- Image files: 0
- Readable images: 0
- Unreadable images: 0
- Annotation files: 1
- Annotation formats: .csv
- VIA annotation files: detection_data_1_csv (1).csv
- VIA image records: 10650 (5986 with boxes, 4664 without boxes)
- VIA boxes: 8374
- VIA class values: areca_fruit (8374)
- Annotation class names: areca_fruit
- Label level: individual-nut (VIA boxes; classes: areca_fruit)
- Explicit grade labels found: none
- Limitation: VIA annotations contain 8374 individual-nut box(es) with class name(s) areca_fruit, not GradeA/GradeB/GradeC/GradeD. They can train a single-class nut localizer, not the application's grade head.

## Grade C/D conclusion

No inspected dataset provides explicit Grade A/B/C/D labels on individual nuts. The alwyndsouza21092 datasets provide real VIA bounding boxes, but every box is the single class areca_fruit: they can train a nut localizer, not a grade classifier. Their class_0...class_6 classification folders are undocumented and are not mapped to grades. The older datasets are image-level ripeness/plant-disease folders. Grade C/D cannot be trained from these files without fabricating labels. The current GradeA/GradeB detector is preserved. To enable C/D, annotate individual nuts with YOLO boxes labelled GradeA/GradeB/GradeC/GradeD, put the dataset in datasets/arecanut_grades (see datasets/README.md), then run scripts/prepare_dataset.py, scripts/train_model.py and scripts/evaluate_model.py.
