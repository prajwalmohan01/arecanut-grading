# Roboflow dataset compatibility

Checked: 2026-10-29T05:14:46.736018+00:00

Method: read-only REST calls to the Roboflow project/version metadata endpoints. No dataset was downloaded, no model was trained, and no prediction endpoint was called.

## Verdict

No inspected dataset exposes Grade A, B, C, and D labels for individual nuts. Grade C/D support cannot be trained honestly from these datasets.

## Datasets

| Dataset | Images | Classes | Grade letters | Four-grade dataset? | Notes |
| --- | ---: | --- | --- | --- | --- |
| `csvtu/arecanut-sg2x7/1` | 741 | ripe, unripe | none | no | ripeness labels (ripe/unripe), not grades |
| `csvtu/arecanut-sg2x7/2` | 741 | ripe, unripe | none | no | ripeness labels (ripe/unripe), not grades |
| `haris-sdpsb/arecanut-uyhqw/3` | 1931 | ripe, unripe | none | no | ripeness labels (ripe/unripe), not grades |
| `arecadetectmodel/areca-detection_model/4` | 319 | areca | none | no | single generic nut class, no grade information |
| `lakshan-krithik-5wkvh/arecanut-zu2zf/1` | 2385 | damaged, good | none | no | binary quality labels (good/damaged), not four grades |
| `project-xqygb/areca-nut-djx7a/3` | 5475 | ., damaged, good | none | no | binary quality labels (good/damaged), not four grades |
| `rakshas-workspace-54tkl/koleroga_detector/1` | 312 | Healthy_nut, Koleroga_detector | none | no | disease labels (healthy/koleroga), not grades |

## Consequence for Grade C/D

A Grade C/D model can only be produced from a dataset whose labels identify individual nuts as C or D. None of the inspected datasets does. Labels such as `ripe`/`unripe` or `good`/`damaged` are useful for a separate binary quality model, but they are not interchangeable with the application's four-grade taxonomy and must not be relabelled silently.

The bundled checkpoint (`GradeA`, `GradeB`) remains the only validated grade model. Grade C and D stay marked as unsupported until a verified four-grade dataset and checkpoint exist.

## Configured Roboflow workflows

| Workflow | Model IDs | Inputs | Grade model? | Role |
| --- | --- | --- | --- | --- |
| `general-segmentation-api-2` | `sam3/sam3_final` | classes:WorkflowParameter, image:InferenceImage | no | Promptable segmentation workflow (free-text class prompt, SAM3). It does not expose trained Grade A/B/C/D classes and is not used for grading. |
| `general-segmentation-api-3` | `sam3/sam3_final` | classes:WorkflowParameter, image:InferenceImage | no | Promptable segmentation workflow (free-text class prompt, SAM3). It does not expose trained Grade A/B/C/D classes and is not used for grading. |
| `general-segmentation-api-5` | `sam3/sam3_final` | classes:WorkflowParameter, image:InferenceImage | no | Promptable segmentation workflow (free-text class prompt, SAM3). It does not expose trained Grade A/B/C/D classes and is not used for grading. |

These workflows are configuration evidence, not grading models. A SAM3 promptable segmentation workflow accepts free-text class names at request time; it has no trained Grade A/B/C/D class list and is therefore not wired into the grading result.
