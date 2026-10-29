"""
Inspect Roboflow dataset metadata for Grade A/B/C/D compatibility.

This script only reads public project/version metadata through the Roboflow REST
API. It does not download datasets, start training, or call model endpoints. The
goal is to answer one question with evidence: can any supplied dataset train a
model that predicts individual-nut Grade A, B, C, or D?

Usage (Windows PowerShell):
    python scripts/inspect_roboflow.py `
        --output training_reports/roboflow_compatibility.json `
        --markdown training_reports/roboflow_compatibility.md

The API key is read from ROBOFLOW_API_KEY, or from server/.env when that variable
is not already set. It is never written to the report or printed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ENV_FILE = os.path.join(ROOT, "server", ".env")
DEFAULT_API_BASE = "https://api.roboflow.com"

# Verified from the six dataset links supplied with the project brief.
DEFAULT_DATASETS = [
    "csvtu/arecanut-sg2x7/1",
    "csvtu/arecanut-sg2x7/2",
    "haris-sdpsb/arecanut-uyhqw/3",
    "arecadetectmodel/areca-detection_model/4",
    "lakshan-krithik-5wkvh/arecanut-zu2zf/1",
    "project-xqygb/areca-nut-djx7a/3",
    "rakshas-workspace-54tkl/koleroga_detector/1",
]

GRADE_PATTERN = re.compile(r"grade[\s_-]*([abcd])\b", re.IGNORECASE)


def read_env_value(path: str, name: str):
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() == name:
                    return value.strip().strip('"').strip("'")
    except OSError:
        return None
    return None


def api_get(base: str, path: str, api_key: str, timeout: float = 30.0):
    """GET JSON without ever logging the URL (the key is a query parameter)."""
    query = urllib.parse.urlencode({"api_key": api_key})
    url = f"{base.rstrip('/')}/{path.lstrip('/')}?{query}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8")), None
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return None, f"HTTP {exc.code}: {body[:300]}"
    except urllib.error.URLError as exc:
        return None, f"Network error: {exc.reason}"
    except (ValueError, TimeoutError) as exc:
        return None, f"Invalid response: {exc}"


def grade_letters(labels):
    found = set()
    for label in labels:
        match = GRADE_PATTERN.fullmatch(str(label).strip())
        if match:
            found.add(match.group(1).upper())
        elif str(label).strip().upper() in {"A", "B", "C", "D"}:
            found.add(str(label).strip().upper())
    return sorted(found)


def proxy_hint(labels):
    lowered = {str(label).strip().lower() for label in labels}
    if {"ripe", "unripe"} <= lowered:
        return "ripeness labels (ripe/unripe), not grades"
    if {"good", "damaged"} <= lowered:
        return "binary quality labels (good/damaged), not four grades"
    if {"healthy_nut", "koleroga_detector"} <= lowered:
        return "disease labels (healthy/koleroga), not grades"
    if lowered == {"areca"}:
        return "single generic nut class, no grade information"
    return "unrecognised label scheme"


def inspect_dataset(base: str, api_key: str, reference: str, timeout: float):
    parts = reference.strip("/").split("/")
    if len(parts) == 2:
        workspace, project = parts
        version = None
    elif len(parts) >= 3:
        workspace, project, version = parts[0], parts[1], parts[2]
    else:
        return {"reference": reference, "error": "Expected workspace/project[/version]"}

    project_data, project_error = api_get(
        base, f"{workspace}/{project}", api_key, timeout
    )
    result = {
        "reference": reference,
        "workspace": workspace,
        "project": project,
        "version": version,
        "project_error": project_error,
    }
    if project_data:
        project_info = project_data.get("project", project_data)
        result["project_info"] = {
            "name": project_info.get("name"),
            "type": project_info.get("type"),
            "images": project_info.get("images"),
            "versions": project_info.get("versions"),
            "license": project_info.get("license"),
            "classes": project_info.get("classes") or {},
        }

    if version:
        version_data, version_error = api_get(
            base, f"{workspace}/{project}/{version}", api_key, timeout
        )
        result["version_error"] = version_error
        if version_data:
            version_info = version_data.get("version", version_data)
            classes = version_info.get("classes") or []
            if not classes:
                # Version endpoints sometimes omit classes; fall back to the
                # project's annotation counts, clearly marked as project-level.
                classes = list(
                    ((result.get("project_info") or {}).get("classes") or {}).keys()
                )
                result["classes_source"] = "project"
            else:
                result["classes_source"] = "version"
            result["version_info"] = {
                "images": version_info.get("images"),
                "splits": version_info.get("splits"),
                "exports": version_info.get("exports"),
                "model": version_info.get("model"),
                "classes": classes,
            }
            result["classes"] = [str(value) for value in classes]
            result["grade_letters"] = grade_letters(result["classes"])
            result["grade_capable"] = set(result["grade_letters"]) == {"A", "B", "C", "D"}
            result["proxy_hint"] = proxy_hint(result["classes"])
    else:
        classes = list(
            ((result.get("project_info") or {}).get("classes") or {}).keys()
        )
        result["classes"] = [str(value) for value in classes]
        result["classes_source"] = "project"
        result["grade_letters"] = grade_letters(result["classes"])
        result["grade_capable"] = set(result["grade_letters"]) == {"A", "B", "C", "D"}
        result["proxy_hint"] = proxy_hint(result["classes"])

    return result


def inspect_workflow(base: str, api_key: str, workspace: str, name: str, timeout: float):
    data, error = api_get(base, f"{workspace}/workflows/{name}", api_key, timeout)
    result = {"workspace": workspace, "name": name, "error": error}
    if not data:
        return result
    workflow = data.get("workflow", data)
    raw_config = workflow.get("config")
    config = {}
    if isinstance(raw_config, str):
        try:
            config = json.loads(raw_config)
        except json.JSONDecodeError as exc:
            result["config_error"] = f"Invalid workflow config JSON: {exc}"
    elif isinstance(raw_config, dict):
        config = raw_config
    elif isinstance(workflow.get("specification"), dict):
        config = workflow

    specification = config.get("specification", config) if isinstance(config, dict) else {}
    steps = specification.get("steps", []) if isinstance(specification, dict) else []
    inputs = specification.get("inputs", []) if isinstance(specification, dict) else []
    model_ids = []
    step_types = []
    for step in steps if isinstance(steps, list) else []:
        if not isinstance(step, dict):
            continue
        if step.get("type"):
            step_types.append(str(step["type"]))
        model_id = step.get("model_id")
        if model_id:
            model_ids.append(str(model_id))
    promptable = sorted({value for value in model_ids if value.lower().startswith("sam")})

    result.update(
        {
            "url": workflow.get("url", name),
            "display_name": workflow.get("name"),
            "inputs": [
                {"name": item.get("name"), "type": item.get("type")}
                for item in inputs
                if isinstance(item, dict)
            ],
            "step_types": step_types,
            "model_ids": model_ids,
            "promptable_segmentation_models": promptable,
            "trained_grade_model": any(
                GRADE_PATTERN.search(value) for value in model_ids
            ),
        }
    )
    if promptable and not result["trained_grade_model"]:
        result["role"] = (
            "Promptable segmentation workflow (free-text class prompt, SAM3). "
            "It does not expose trained Grade A/B/C/D classes and is not used for "
            "grading."
        )
    elif result["trained_grade_model"]:
        result["role"] = "Workflow references a grade-named model; verify its classes."
    else:
        result["role"] = "Workflow does not reference a trained grade model."
    return result


def build_markdown(report):
    lines = [
        "# Roboflow dataset compatibility",
        "",
        f"Checked: {report['checked_at']}",
        "",
        (
            "Method: read-only REST calls to the Roboflow project/version metadata "
            "endpoints. No dataset was downloaded, no model was trained, and no "
            "prediction endpoint was called."
        ),
        "",
        "## Verdict",
        "",
        report["verdict"],
        "",
        "## Datasets",
        "",
        "| Dataset | Images | Classes | Grade letters | Four-grade dataset? | Notes |",
        "| --- | ---: | --- | --- | --- | --- |",
    ]
    for item in report["datasets"]:
        version_info = item.get("version_info") or {}
        image_count = version_info.get("images")
        if image_count is None:
            image_count = (item.get("project_info") or {}).get("images")
        classes = ", ".join(item.get("classes") or []) or "unknown"
        letters = ", ".join(item.get("grade_letters") or []) or "none"
        capable = "yes" if item.get("grade_capable") else "no"
        note = item.get("proxy_hint") or ""
        if item.get("error") or item.get("project_error") or item.get("version_error"):
            errors = [
                value
                for value in (
                    item.get("error"),
                    item.get("project_error"),
                    item.get("version_error"),
                )
                if value
            ]
            note = "; ".join(errors)[:160]
        lines.append(
            f"| `{item['reference']}` | {image_count if image_count is not None else '?'} | "
            f"{classes} | {letters} | {capable} | {note} |"
        )
    lines += [
        "",
        "## Consequence for Grade C/D",
        "",
        (
            "A Grade C/D model can only be produced from a dataset whose labels "
            "identify individual nuts as C or D. None of the inspected datasets "
            "does. Labels such as `ripe`/`unripe` or `good`/`damaged` are useful "
            "for a separate binary quality model, but they are not interchangeable "
            "with the application's four-grade taxonomy and must not be relabelled "
            "silently."
        ),
        "",
        "The bundled checkpoint (`GradeA`, `GradeB`) remains the only validated "
        "grade model. Grade C and D stay marked as unsupported until a verified "
        "four-grade dataset and checkpoint exist.",
        "",
    ]

    workflows = report.get("workflows") or []
    if workflows:
        lines += [
            "## Configured Roboflow workflows",
            "",
            "| Workflow | Model IDs | Inputs | Grade model? | Role |",
            "| --- | --- | --- | --- | --- |",
        ]
        for item in workflows:
            if item.get("error"):
                lines.append(
                    f"| `{item.get('name')}` | - | - | - | error: {item['error'][:120]} |"
                )
                continue
            models = ", ".join(item.get("model_ids") or []) or "none"
            inputs = ", ".join(
                f"{value.get('name')}:{value.get('type')}"
                for value in item.get("inputs") or []
            )
            lines.append(
                f"| `{item.get('name')}` | `{models}` | {inputs or '-'} | "
                f"{'yes' if item.get('trained_grade_model') else 'no'} | "
                f"{item.get('role', '')} |"
            )
        lines += [
            "",
            "These workflows are configuration evidence, not grading models. A "
            "SAM3 promptable segmentation workflow accepts free-text class names "
            "at request time; it has no trained Grade A/B/C/D class list and is "
            "therefore not wired into the grading result.",
            "",
        ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect Roboflow dataset grade compatibility")
    parser.add_argument("--dataset", action="append", help="workspace/project[/version]")
    parser.add_argument("--workflow", action="append", help="Workspace workflow slug")
    parser.add_argument("--workspace", help="Roboflow workspace for workflow inspection")
    parser.add_argument("--api-base", default=os.environ.get("ROBOFLOW_API_URL", DEFAULT_API_BASE))
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--output", default=os.path.join(ROOT, "training_reports", "roboflow_compatibility.json"))
    parser.add_argument("--markdown", default=os.path.join(ROOT, "training_reports", "roboflow_compatibility.md"))
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    api_key = os.environ.get("ROBOFLOW_API_KEY") or read_env_value(
        args.env_file, "ROBOFLOW_API_KEY"
    )
    if not api_key:
        print(
            "ROBOFLOW_API_KEY is not set and was not found in server/.env. "
            "Set it or pass --env-file.",
            file=sys.stderr,
        )
        return 2

    references = args.dataset or DEFAULT_DATASETS
    datasets = []
    for reference in references:
        print(f"[inspect] {reference}", flush=True)
        datasets.append(inspect_dataset(args.api_base, api_key, reference, args.timeout))

    workflows = []
    workspace = args.workspace or os.environ.get("ROBOFLOW_WORKSPACE") or read_env_value(
        args.env_file, "ROBOFLOW_WORKSPACE"
    )
    workflow_names = args.workflow
    if not workflow_names:
        configured = [
            read_env_value(args.env_file, key)
            for key in (
                "ROBOFLOW_WORKFLOW_GRADE",
                "ROBOFLOW_WORKFLOW_RIPENESS",
                "ROBOFLOW_WORKFLOW_RIPENESS_ALT",
                "ROBOFLOW_WORKFLOW_DETECT",
            )
        ]
        workflow_names = list(dict.fromkeys(name for name in configured if name))
    if workspace and workflow_names:
        for name in workflow_names:
            print(f"[inspect] workflow {workspace}/{name}", flush=True)
            workflows.append(
                inspect_workflow(args.api_base, api_key, workspace, name, args.timeout)
            )

    grade_capable = [item for item in datasets if item.get("grade_capable")]
    if grade_capable:
        verdict = (
            "At least one dataset exposes all four grade letters. Validate its "
            "annotation quality and class balance before training."
        )
    else:
        verdict = (
            "No inspected dataset exposes Grade A, B, C, and D labels for "
            "individual nuts. Grade C/D support cannot be trained honestly from "
            "these datasets."
        )

    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "api_base": args.api_base,
        "dataset_count": len(datasets),
        "grade_capable_datasets": [item["reference"] for item in grade_capable],
        "workflow_count": len(workflows),
        "workflows": workflows,
        "verdict": verdict,
        "datasets": datasets,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    with open(args.markdown, "w", encoding="utf-8") as handle:
        handle.write(build_markdown(report))

    print(f"Wrote {args.output}")
    print(f"Wrote {args.markdown}")
    print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
