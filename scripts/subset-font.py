"""Build lossless variable-font subsets; this tool is never shipped to browsers."""

import io
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

plan = json.loads(Path(sys.argv[1]).read_text())
output = Path(plan["output"])
output.mkdir(parents=True, exist_ok=True)
options = subset.Options()
options.layout_features = ["*"]
options.recalc_timestamp = False
# Canvas line metrics need the Latin face's original global bounds.
recalc_bounds = not plan.get("preserveBounds", False)

# Subset the full source once; individual groups then operate on a small font.
base = TTFont(plan["source"], recalcTimestamp=False, recalcBBoxes=recalc_bounds)
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes={point for group in plan["subsets"] for point in group})
subsetter.subset(base)
buffer = io.BytesIO()
base.save(buffer)
groups = []
for index, points in enumerate(plan["subsets"]):
    font = TTFont(io.BytesIO(buffer.getvalue()), recalcTimestamp=False, recalcBBoxes=recalc_bounds)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    font.flavor = "woff2"
    file = output / f"{index}.woff2"
    font.save(file)
    groups.append({"file": str(file), "points": sorted(font.getBestCmap())})
print(json.dumps(groups))
