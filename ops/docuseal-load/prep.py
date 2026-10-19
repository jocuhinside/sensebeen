#!/usr/bin/env python3
"""Rev D package -> filled DOCX, PDF, and a DocuSeal template payload per document.

Fills only what facts.local.json states, converts with LibreOffice, then finds every
signature/fill line in the rendered PDF (underscore runs, [___] blanks, bare By:/Date:
labels) and turns each into a DocuSeal field placed on that line, assigned to the party
whose signature block it sits in. Run with python3 -I.

  python3 -I prep.py PACKAGE.zip|DIR --facts facts.local.json --out WORK
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from docx import Document
from PIL import Image, ImageDraw

PT_GAP = 30          # word gap (pt) that splits a pdftotext line into column segments
SIG_H, TXT_H = 26, 14
LABELS = {"by", "signature", "sign", "/s/", "name", "printed name", "print name", "title", "date", "initials", "its"}
BLANK_RE = re.compile(r"_{4,}|\[_+\]")
REPORT_RE = re.compile(r"\[[^\]]{1,80}\]|_{4,}")
NS = "{http://www.w3.org/1999/xhtml}"


# ---------- fill ----------

def iter_paragraphs(doc):
    """Yield (paragraph, caption) for body, tables (recursively) and headers/footers.
    caption = first non-empty paragraph of the enclosing table cell, else last all-caps body line."""
    def cell_pars(cell):
        cap = next((p.text.strip() for p in cell.paragraphs if p.text.strip()), "")
        for p in cell.paragraphs:
            yield p, cap
        for t in cell.tables:
            yield from table_pars(t)

    def table_pars(t):
        for row in t.rows:
            seen = set()
            for cell in row.cells:
                if id(cell._tc) in seen:
                    continue
                seen.add(id(cell._tc))
                yield from cell_pars(cell)

    cap = ""
    body = doc.element.body
    for child in body.iterchildren():
        tag = child.tag.split("}")[1]
        if tag == "p":
            from docx.text.paragraph import Paragraph
            p = Paragraph(child, doc)
            t = p.text.strip()
            if t and is_caption(t):
                cap = t
            yield p, cap
        elif tag == "tbl":
            from docx.table import Table
            yield from table_pars(Table(child, doc))
    for s in doc.sections:
        for hf in (s.header, s.footer, s.first_page_header, s.first_page_footer):
            for p in hf.paragraphs:
                yield p, ""


def para_replace(p, old, new):
    n, start = 0, 0
    while True:
        runs = p.runs
        full = "".join(r.text for r in runs)
        i = full.find(old, start)
        if i < 0 or not runs:
            return n
        pos, sr = 0, None
        for k, r in enumerate(runs):
            L = len(r.text)
            if sr is None and i < pos + L:
                sr, so = k, i - pos
            if sr is not None and i + len(old) <= pos + L:
                er, eo = k, i + len(old) - pos
                break
            pos += L
        else:
            return n  # match spans non-run content (hyperlink/field); leave it
        if sr == er:
            runs[sr].text = runs[sr].text[:so] + new + runs[sr].text[eo:]
        else:
            runs[sr].text = runs[sr].text[:so] + new
            for k in range(sr + 1, er):
                runs[k].text = ""
            runs[er].text = runs[er].text[eo:]
        start, n = i + len(new), n + 1


def fill_docx(src, dst, doc_key, rules):
    doc = Document(src)
    applied, blanks = [], []
    for p, cap in iter_paragraphs(doc):
        for r in rules:
            if r.get("docs") and not any(doc_key.startswith(d) for d in r["docs"]):
                continue
            if r.get("caption") and not re.search(r["caption"], cap, re.I):
                continue
            if r["find"] in p.text:
                n = para_replace(p, r["find"], r["replace"])
                if n:
                    applied.append({"find": r["find"], "replace": r["replace"], "caption": cap, "count": n})
        for m in REPORT_RE.finditer(p.text):
            blanks.append({"blank": m.group(0)[:40], "caption": cap[:60], "context": p.text.strip()[:160]})
    doc.save(dst)
    return applied, blanks


# ---------- detect ----------

def is_caption(t):
    letters = [c for c in t if c.isalpha()]
    if len(letters) < 3 or "_" in t or t.endswith(":"):
        return False
    if t.split(":")[0].strip().lower() in LABELS:
        return False
    return sum(c.isupper() for c in letters) / len(letters) > 0.8


def pdf_segments(pdf, tmp):
    html = tmp / (pdf.stem + ".bbox.html")
    subprocess.run(["pdftotext", "-bbox-layout", str(pdf), str(html)], check=True)
    root = ET.parse(html).getroot()
    pages = []
    for pg in root.iter(NS + "page"):
        W, H = float(pg.get("width")), float(pg.get("height"))
        segs = []
        for line in pg.iter(NS + "line"):
            words = [dict(t=w.text or "", x0=float(w.get("xMin")), y0=float(w.get("yMin")),
                          x1=float(w.get("xMax")), y1=float(w.get("yMax"))) for w in line.iter(NS + "word")]
            cur = []
            for w in words:
                if cur and w["x0"] - cur[-1]["x1"] > PT_GAP:
                    segs.append(cur)
                    cur = []
                cur.append(w)
            if cur:
                segs.append(cur)
        segs = [dict(words=s, text=" ".join(w["t"] for w in s), x0=s[0]["x0"], x1=s[-1]["x1"],
                     y0=min(w["y0"] for w in s), y1=max(w["y1"] for w in s)) for s in segs]
        pages.append(dict(W=W, H=H, segs=segs))
    return pages


def classify(label):
    l = label.lower()
    if "initial" in l:
        return "initials"
    if "date" in l:
        return "date"
    if l.startswith("by") or "/s/" in l or "signature" in l or l.startswith("sign"):
        return "signature"
    return "text"


def block_context(segs, seg, cap_window=140, above=90, below=110):
    """Party evidence around a line, same column: the all-caps caption heading its block, and the
    other lines nearby ordered by distance (a bare line's name sits just below it, a Date line's just above)."""
    col = seg["x0"]
    same = [s for s in segs if s is not seg and abs(s["x0"] - col) < 45]
    caps = [s for s in same if s["y1"] <= seg["y0"] + 1 and seg["y0"] - s["y1"] < cap_window and is_caption(s["text"])]
    cap = max(caps, key=lambda s: s["y1"])["text"] if caps else ""
    near = [(seg["y0"] - s["y1"], s["text"]) for s in same if 0 <= seg["y0"] - s["y1"] < above]
    near += [(s["y0"] - seg["y1"], s["text"]) for s in same if 0 <= s["y0"] - seg["y1"] < below]
    return cap, [t for _, t in sorted(near)]


def find_role(cap, near, roles, key, use_caption=True):
    """roles: [pattern, role] or [pattern, role, [doc keys]]. A block caption that names a party wins
    (By: under NJOYA ENGINEERING is Njoya even if Name: says Giles); otherwise the nearest matching line."""
    live = [r for r in roles if len(r) < 3 or not r[2] or key in r[2]]
    for text in ([cap] if use_caption and cap else []) + near:
        for r in live:
            if re.search(r[0], text, re.I):
                return r[1]
    return None


def detect_fields(pages, roles, sender_role, key):
    fields, open_items = [], []
    for pno, pg in enumerate(pages, 1):
        W, H = pg["W"], pg["H"]
        for seg in pg["segs"]:
            ws = seg["words"]
            hits = []
            for i, w in enumerate(ws):
                m = BLANK_RE.search(w["t"])
                if not m:
                    continue
                cw = (w["x1"] - w["x0"]) / max(len(w["t"]), 1)
                x0 = w["x0"] + cw * m.start()
                x1 = w["x0"] + cw * len(w["t"].rstrip(".,;)"))
                label = " ".join(v["t"] for v in ws[:i]) + " " + w["t"][:m.start()]
                hits.append((x0, x1, w, label.strip()))
            # bare label with nothing after it (line drawn as a border, not underscores)
            if not hits and len(ws) == 1 and ws[0]["t"].rstrip(":").lower() in {"by", "signature", "date", "name", "title", "initials"} and ws[0]["t"].endswith(":"):
                w = ws[0]
                hits.append((w["x1"] + 4, min(w["x1"] + 200, W - 36), w, w["t"]))
            for x0, x1, w, label in hits:
                key = label.split(":")[0].strip().lower() if ":" in label else label.lower()
                last = label.split()[-1].rstrip(":").lower() if label else ""
                in_block = key in LABELS or last in LABELS or label == "" or label.lower().startswith("/s/")
                ftype = classify(label) if in_block else "text"
                if label == "":
                    ftype = "signature"
                cap, near = block_context(pg["segs"], seg)
                role = find_role(cap, near, roles, key, use_caption=label != "") if in_block else None
                note = None
                if role is None:
                    role = sender_role
                    note = "body blank: assigned to sender, prefill before sending" if not in_block else f"no party match (caption '{cap[:40]}'): assigned to sender"
                h = SIG_H if ftype in ("signature", "initials") else TXT_H
                y1 = w["y1"] - 1
                area = dict(x=round(x0 / W, 5), y=round(max(y1 - h, 0) / H, 5),
                            w=round((x1 - x0) / W, 5), h=round(h / H, 5), page=pno)
                fields.append(dict(type=ftype, role=role, label=label, caption=cap, area=area,
                                   context=seg["text"][:120], note=note))
                if note:
                    open_items.append(dict(page=pno, label=label or "(line)", context=seg["text"][:120], note=note))
    return fields, open_items


def to_payload(name, ext_id, folder, pdf_path, fields, role_order, date_format):
    order = {r: i for i, r in enumerate(role_order)}
    fields = sorted(fields, key=lambda f: (order.get(f["role"], 99), f["area"]["page"], f["area"]["y"]))
    seen, out = {}, []
    for f in fields:
        if f["note"] and f["note"].startswith("body"):
            words = re.sub(r"\[_+\]|_{4,}", "", f["label"]).split()[-4:]
            nm = "Prefill: " + (" ".join(words) or "blank")
        else:
            base = {"signature": "Signature", "date": "Date", "initials": "Initials"}.get(f["type"]) \
                or (f["label"].split(":")[0].strip().title() if f["label"] else "Text") or "Text"
            nm = f"{f['role']} {base}"
        seen[nm] = seen.get(nm, 0) + 1
        if seen[nm] > 1:
            nm = f"{nm} {seen[nm]}"
        fd = {"name": nm, "type": f["type"], "role": f["role"], "required": f["type"] != "text" or f["note"] is None,
              "areas": [f["area"]]}
        if f["type"] == "date":
            fd["preferences"] = {"format": date_format}
        if f["note"]:
            fd["description"] = f"{f['note']}. Context: {f['context']}"
        out.append(fd)
    return {"name": name, "external_id": ext_id, "folder_name": folder,
            "documents": [{"name": name, "file": f"@file:{pdf_path}", "fields": out}]}


# ---------- QA ----------

COLORS = ["#d1495b", "#2e86ab", "#3c9d5d", "#e09f3e", "#7b4fa0", "#555555"]


def overlay(pdf, fields, role_order, outdir, dpi=70):
    roles = role_order + sorted({f["role"] for f in fields} - set(role_order))
    col = {r: COLORS[i % len(COLORS)] for i, r in enumerate(roles)}
    pages = sorted({f["area"]["page"] for f in fields})
    shots = []
    for p in pages:
        stem = outdir / f"{pdf.stem}.p{p}"
        subprocess.run(["pdftoppm", "-png", "-r", str(dpi), "-f", str(p), "-l", str(p), "-singlefile", str(pdf), str(stem)], check=True)
        im = Image.open(f"{stem}.png").convert("RGB")
        d = ImageDraw.Draw(im)
        for f in fields:
            a = f["area"]
            if a["page"] != p:
                continue
            box = [a["x"] * im.width, a["y"] * im.height, (a["x"] + a["w"]) * im.width, (a["y"] + a["h"]) * im.height]
            d.rectangle(box, outline=col[f["role"]], width=2)
            d.text((box[0] + 2, box[1] - 10), f"{f['role']}:{f['type']}", fill=col[f["role"]])
        im.save(f"{stem}.png")
        shots.append(f"{stem}.png")
    return shots


def doc_key(stem):
    m = re.match(r"(UAT-\d+[A-Z]?)", stem)
    return m.group(1) if m else stem


def pretty_name(stem, rev):
    k = doc_key(stem)
    rest = re.sub(r"^UAT-\d+[A-Z]?_", "", stem)
    rest = re.sub(r"_?Rev[-_ ]?D[0-9.]*$", "", rest, flags=re.I).replace("_", " ")
    return f"{k} {rest} (Rev {rev})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("package")
    ap.add_argument("--facts", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    facts = json.load(open(a.facts))
    out = Path(a.out)
    for d in ("src", "filled", "pdf", "qa", "tmp"):
        (out / d).mkdir(parents=True, exist_ok=True)

    src = Path(a.package)
    if src.suffix == ".zip":
        with zipfile.ZipFile(src) as z:
            for n in z.namelist():
                if n.endswith(".docx") and not n.startswith("__MACOSX"):
                    (out / "src" / Path(n).name).write_bytes(z.read(n))
        docs = sorted((out / "src").glob("*.docx"))
    elif src.suffix == ".docx":
        docs = [src]
    else:
        docs = sorted(src.rglob("*.docx"))

    skip = facts.get("skip", [])
    roles = facts["roles"]
    manifest, report = [], {"skipped": [], "docs": []}
    for d in docs:
        key = doc_key(d.stem)
        if any(key == s or d.stem.startswith(s) for s in skip):
            report["skipped"].append(d.name)
            continue
        filled = out / "filled" / d.name
        applied, blanks = fill_docx(d, filled, key, facts.get("fill", []))
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(out / "pdf"), str(filled)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pdf = out / "pdf" / (d.stem + ".pdf")
        pages = pdf_segments(pdf, out / "tmp")
        fields, open_items = detect_fields(pages, roles, facts["sender_role"], key)
        name = pretty_name(d.stem, facts.get("rev", "D.2"))
        ext = f"{key.lower()}-{facts.get('rev', 'D.2').lower().replace('.', '')}"
        payload = to_payload(name, ext, facts.get("folder", "Rev D"), str(pdf.resolve()), fields,
                             facts.get("role_order", []), facts.get("date_format", "MM/DD/YYYY"))
        pj = out / f"{d.stem}.payload.json"
        json.dump(payload, open(pj, "w"), indent=1)
        shots = overlay(pdf, fields, facts.get("role_order", []), out / "qa") if fields else []
        sig_roles = sorted({f["role"] for f in fields if f["type"] == "signature"})
        if not fields:
            report["skipped"].append(d.name + " (no lines found)")
            pj.unlink()
            continue
        manifest.append(str(pj.resolve()))
        report["docs"].append(dict(file=d.name, template=name, external_id=ext, pages=len(pages),
                                   fields=len(fields), signers=sig_roles, filled=applied,
                                   open_blanks=[b for b in blanks if not b["blank"].startswith("_")],
                                   needs_review=open_items, qa=shots))
        print(f"{key}: {len(fields)} fields, signers {sig_roles}, {len(applied)} fills, {len(open_items)} to review")
    json.dump(manifest, open(out / "manifest.json", "w"), indent=1)
    json.dump(report, open(out / "report.json", "w"), indent=1)
    shutil.rmtree(out / "tmp", ignore_errors=True)
    print(f"{len(manifest)} templates ready, {len(report['skipped'])} skipped -> {out / 'report.json'}")


if __name__ == "__main__":
    sys.exit(main())
