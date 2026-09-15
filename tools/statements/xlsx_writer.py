# -*- coding: utf-8 -*-
"""Writes one company-prepared workbook per relationship.

The source workbook is opened and only CELL VALUES are changed. Every style used
in an output cell is copied, byte for byte, from a cell of the source workbook
(openpyxl StyleArray copy), so fonts, fills, borders, number formats, alignment
and the merged two-period layout are preserved. A third money column (I:J,
"Change") is added, styled from the source's second period column (G:H).
"""
import json, os, sys
from copy import copy
import openpyxl

DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(DIR, 'template-workbook.xlsx')

# archetype rows in the source workbook, by sheet and by row role
ARCH = {
 'Balance Sheet':   dict(group=5, sub=4, detail=6, detail_last=13, subtotal=14, total=15,
                         title=1, period=3),
 'Income Statement': dict(group=11, sub=11, detail=5, detail_last=7, subtotal=25, total=48,
                          title=1, period=3),
}
COLS = list('ABCDEFGHIJ')

def style_row(ws, src, target_row, arch_row):
    """Copy the A..H styles of arch_row into target_row; mirror G,H into I,J."""
    for i, c in enumerate(COLS):
        srccol = c if i < 8 else COLS[i - 2]          # I<-G, J<-H
        s = src[f'{srccol}{arch_row}']
        t = ws[f'{c}{target_row}']
        t._style = copy(s._style)

def write_sheet(ws, src, sheet, title, rows, period_labels, max_row, label_in_header=False):
    a = ARCH[sheet]
    # clear every value in the working area
    for r in range(1, ws.max_row + 1):
        for c in COLS:
            cell = ws[f'{c}{r}']
            if cell.__class__.__name__ != 'MergedCell':
                cell.value = None
    # extend the merged layout to the new Change column
    for r in range(2, max_row + 1):
        try: ws.unmerge_cells(f'I{r}:J{r}')
        except Exception: pass
        ws.merge_cells(f'I{r}:J{r}')
    try: ws.unmerge_cells('E2:H2')
    except Exception: pass
    ws.merge_cells('E2:J2')
    ws.column_dimensions['I'].width = 16
    ws.column_dimensions['J'].width = 4

    style_row(ws, src, 1, a['title']); ws['D1'] = title
    style_row(ws, src, 2, a['title']); ws['E2'] = 'Total'
    ws['E2']._style = copy(src['E2']._style)
    style_row(ws, src, 3, a['period'])

    ws['E3'], ws['G3'], ws['I3'] = period_labels[0], period_labels[1], 'Change'
    ws['I3']._style = copy(src['G3']._style)
    if label_in_header and rows and rows[0][1] == 'group':
        # the source carries the top level section label on the period header row
        ws['A3'] = rows[0][0]
        ws['A3']._style = copy(src[f"A{ARCH[sheet]['group']}"]._style)
        rows = rows[1:]

    r = 4
    for label, role, v25, v24 in rows:
        if r > max_row: raise SystemExit(f'{sheet}: out of rows at {label}')
        style_row(ws, src, r, a[role])
        ws[f'A{r}'] = label
        if v25 is not None:
            ws[f'E{r}'] = round(float(v25), 2)
            ws[f'G{r}'] = round(float(v24), 2)
            ws[f'I{r}'] = round(float(v25) - float(v24), 2)
        r += 1
    return r - 1

def build(rel, outpath):
    wb = openpyxl.load_workbook(SRC)
    src = openpyxl.load_workbook(SRC)['Balance Sheet']
    srci = openpyxl.load_workbook(SRC)['Income Statement']
    name = rel['legalName']
    write_sheet(wb['Balance Sheet'], src, 'Balance Sheet', name,
                [tuple(x) for x in rel['xlsx']['balance']],
                ('As of Dec 31,2025', 'As of Dec 31,2024'), 64, label_in_header=True)
    write_sheet(wb['Income Statement'], srci, 'Income Statement', name,
                [tuple(x) for x in rel['xlsx']['income']],
                ('As of Dec 31,2025', 'As of Dec 31,2024'), 58)
    wb.save(outpath)

if __name__ == '__main__':
    facts = json.load(open(sys.argv[1]))
    outdir = sys.argv[2]
    for rel in facts['relationships']:
        d = os.path.join(outdir, rel['folder']); os.makedirs(d, exist_ok=True)
        p = os.path.join(d, f"{rel['legalName']} - Company Prepared Financial Statements FY2025.xlsx")
        build(rel, p)
        print(f"xlsx {rel['folder']:10s} {os.path.getsize(p):>7,} bytes")
