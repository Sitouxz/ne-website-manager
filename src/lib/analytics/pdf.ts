import type { jsPDF as JsPDF } from 'jspdf';

/**
 * Analytics PDF report (A4, vector text and shapes so it stays sharp at any
 * zoom and the text is selectable/searchable) laid out like a Google Analytics
 * export: header, KPI summary, daily trend chart, then ranked tables.
 *
 * Every figure is passed in already computed by the Analytics screen, so the
 * PDF can never disagree with what is on screen.
 */
export type ReportRow = { name: string; count: number };

export type AnalyticsReport = {
  clientName: string;
  /** e.g. "24 Sep 2026 – 30 Sep 2026" */
  rangeLabel: string;
  rangeDays: number;
  generatedAt: Date;
  includesBots: boolean;
  kpis: { label: string; value: string; sub: string }[];
  trend: { label: string; count: number }[];
  pages: ReportRow[];
  referrers: ReportRow[];
  countries: ReportRow[];
  devices: ReportRow[];
  browsers: ReportRow[];
  eventTypes: ReportRow[];
  posts: { title: string; path: string; views: number }[];
};

const BLUE: [number, number, number] = [29, 78, 216];
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const SOFT: [number, number, number] = [248, 250, 252];

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16; // page margin (mm)
const CONTENT_W = PAGE_W - M * 2;

const fmt = (n: number) => n.toLocaleString('en-US');

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Round a max value up to a "nice" axis ceiling (1, 2, 5 × 10ⁿ). */
function niceCeil(value: number) {
  if (value <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export async function buildAnalyticsPdf(report: AnalyticsReport): Promise<JsPDF> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Analytics report – ${report.clientName}`, subject: report.rangeLabel, creator: 'NE Website Manager' });

  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? M;
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const ensureSpace = (y: number, needed: number) => {
    if (y + needed <= PAGE_H - 18) return y;
    doc.addPage();
    return M;
  };

  // ── Header ───────────────────────────────────────────────────────────────
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, PAGE_W, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setColor(INK);
  doc.text('Analytics report', M, 20);
  doc.setFontSize(12);
  setColor(BLUE);
  doc.text(report.clientName, M, 27);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setColor(MUTED);
  doc.text(report.rangeLabel, PAGE_W - M, 20, { align: 'right' });
  doc.text(`Last ${report.rangeDays} days · UTC days`, PAGE_W - M, 25, { align: 'right' });
  doc.text(
    `Generated ${report.generatedAt.toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    PAGE_W - M, 30, { align: 'right' },
  );
  doc.setDrawColor(...LINE);
  doc.line(M, 34, PAGE_W - M, 34);

  // ── KPI cards ────────────────────────────────────────────────────────────
  const gap = 4;
  const cardW = (CONTENT_W - gap * (report.kpis.length - 1)) / report.kpis.length;
  report.kpis.forEach((kpi, i) => {
    const x = M + i * (cardW + gap);
    doc.setFillColor(...SOFT);
    doc.setDrawColor(...LINE);
    doc.roundedRect(x, 40, cardW, 26, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    setColor(INK);
    doc.text(kpi.value, x + 4, 55);
    doc.setFontSize(9);
    setColor(BLUE);
    doc.text(kpi.label.toUpperCase(), x + 4, 47);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setColor(MUTED);
    doc.text(kpi.sub, x + 4, 61.5, { maxWidth: cardW - 8 });
  });

  // ── Trend chart ──────────────────────────────────────────────────────────
  let y = 76;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setColor(INK);
  doc.text('Page views by day', M, y);
  y += 4;

  const chartX = M + 9;
  const chartW = CONTENT_W - 9;
  const chartH = 52;
  const chartTop = y + 2;
  const chartBottom = chartTop + chartH;
  const axisMax = niceCeil(Math.max(1, ...report.trend.map((b) => b.count)));

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i <= 4; i++) {
    const gy = chartBottom - (chartH * i) / 4;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.15);
    doc.line(chartX, gy, chartX + chartW, gy);
    setColor(MUTED);
    doc.text(fmt(Math.round((axisMax * i) / 4)), chartX - 2, gy + 1, { align: 'right' });
  }

  const n = report.trend.length;
  const slot = chartW / n;
  const barW = Math.max(0.6, slot * (n > 45 ? 0.8 : 0.62));
  const labelEvery = n <= 10 ? 1 : n <= 31 ? 3 : 7;
  report.trend.forEach((bucket, i) => {
    const h = (bucket.count / axisMax) * chartH;
    const bx = chartX + slot * i + (slot - barW) / 2;
    doc.setFillColor(...BLUE);
    if (h > 0) doc.rect(bx, chartBottom - h, barW, h, 'F');
    if (n <= 14 && bucket.count > 0) {
      doc.setFontSize(7);
      setColor(INK);
      doc.text(String(bucket.count), bx + barW / 2, chartBottom - h - 1.2, { align: 'center' });
    }
    if (i % labelEvery === 0 || i === n - 1) {
      doc.setFontSize(7);
      setColor(MUTED);
      doc.text(bucket.label, bx + barW / 2, chartBottom + 4, { align: 'center' });
    }
  });
  y = chartBottom + 12;

  // ── Ranked tables ────────────────────────────────────────────────────────
  const total = (rows: ReportRow[]) => rows.reduce((sum, r) => sum + r.count, 0);

  const rankedTable = (title: string, col: string, rows: ReportRow[], limit: number, map: (name: string) => string = (s) => s) => {
    y = ensureSpace(y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setColor(INK);
    doc.text(title, M, y);
    const sum = Math.max(1, total(rows));
    const shown = rows.slice(0, limit);
    autoTable(doc, {
      startY: y + 2,
      margin: { left: M, right: M, bottom: 18 },
      head: [[col, 'Views', '% of total']],
      body: shown.length
        ? shown.map((r) => [map(r.name), fmt(r.count), `${((r.count / sum) * 100).toFixed(1)}%`])
        : [[{ content: 'No data for this period', colSpan: 3, styles: { halign: 'center', textColor: MUTED } }]],
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 } },
      headStyles: { fontStyle: 'bold', textColor: MUTED, fontSize: 7.5, fillColor: SOFT },
      alternateRowStyles: { fillColor: [252, 253, 254] },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 24 }, 2: { halign: 'right', cellWidth: 26 } },
      didParseCell: (d) => {
        if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right';
      },
    });
    y = lastY() + 9;
  };

  rankedTable('Top pages', 'Page path', report.pages, 15);
  rankedTable('Traffic sources (referrers)', 'Source', report.referrers, 10);
  rankedTable('Countries', 'Country', report.countries, 10, countryName);
  rankedTable('Devices', 'Device', report.devices, 5);
  rankedTable('Browsers', 'Browser', report.browsers, 8);
  rankedTable('Event types', 'Event', report.eventTypes, 8);

  // Top posts
  y = ensureSpace(y, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setColor(INK);
  doc.text('Top posts', M, y);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: M, right: M, bottom: 18 },
    head: [['Post', 'Path', 'Views']],
    body: report.posts.length
      ? report.posts.map((p) => [p.title, p.path, fmt(p.views)])
      : [[{ content: 'No posts with a computable path', colSpan: 3, styles: { halign: 'center', textColor: MUTED } }]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 }, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', textColor: MUTED, fontSize: 7.5, fillColor: SOFT },
    columnStyles: { 0: { cellWidth: 70 }, 1: { textColor: MUTED, cellWidth: 'auto' }, 2: { halign: 'right', cellWidth: 20 } },
    didParseCell: (d) => {
      if (d.section === 'head' && d.column.index === 2) d.cell.styles.halign = 'right';
    },
  });

  // ── Footer on every page ─────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.line(M, PAGE_H - 13, PAGE_W - M, PAGE_H - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setColor(MUTED);
    doc.text(
      `${report.clientName} · ${report.rangeLabel} · ${report.includesBots ? 'Includes bot traffic' : 'Bot traffic excluded'}`,
      M, PAGE_H - 8,
    );
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 8, { align: 'right' });
  }

  return doc;
}
