'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/**
 * Reads a PDF inside the page on any device, including Android phones whose browser cannot show a PDF in a frame.
 * Pages are drawn only when they come near the screen, so a long PDF opens quickly.
 * The reader's helper file is public/pdfjs/pdf.worker.min.mjs: copy it again from
 * node_modules/pdfjs-dist/legacy/build/ whenever the pdfjs-dist version changes.
 */
export function PdfView({ data, name, onFail }: { data: ArrayBuffer; name: string; onFail: () => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(1.414);   // page height ÷ width, from the first page (A4 until known)
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);
  const failed = useRef(onFail);
  useEffect(() => { failed.current = onFail; });

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        // The reader takes the bytes it is given, so it gets its own copy.
        const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
        stop = () => { void task.destroy(); };
        const d = await task.promise;
        if (!alive) return;
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        if (!alive) return;
        setRatio(first.height / first.width);
        setDoc(d);
      } catch { if (alive) failed.current(); }
    })();
    return () => { alive = false; stop?.(); };
  }, [data]);

  // Pages are as wide as the space they are in.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.floor(el.clientWidth - 24)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.round(width * zoom);
  return (
    <div className="wk-pdf">
      <div className="wk-pdf-bar">
        <span className="crm-sub" aria-live="polite">{doc ? `${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}` : 'Opening…'}</span>
        <span className="wk-pdf-zoom">
          <button type="button" className="wk-tb-btn" aria-label="Smaller" title="Smaller" disabled={zoom <= 0.6} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}><Minus size={16} /></button>
          <button type="button" className="wk-pdf-fit" onClick={() => setZoom(1)} aria-label={`Zoom ${Math.round(zoom * 100)} percent. Press to fit the width.`}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="wk-tb-btn" aria-label="Bigger" title="Bigger" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(1)))}><Plus size={16} /></button>
        </span>
      </div>
      <div className="wk-pdf-pages" ref={wrap} tabIndex={0} role="document" aria-label={name}>
        {doc && width > 0 && Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc} n={i + 1} width={pageWidth} ratio={ratio} />
        ))}
      </div>
    </div>
  );
}

function PdfPage({ doc, n, width, ratio }: { doc: PDFDocumentProxy; n: number; width: number; ratio: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(n <= 2);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setNear(true); }, { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !width) return;
    let alive = true;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const page = await doc.getPage(n);
        const c = canvas.current;
        if (!alive || !c) return;
        const base = page.getViewport({ scale: 1 });
        const sharp = Math.min(window.devicePixelRatio || 1, 2);   // crisp on phones without using too much memory
        const vp = page.getViewport({ scale: (width / base.width) * sharp });
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        setHeight(Math.round(width * (base.height / base.width)));
        const ctx = c.getContext('2d');
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
      } catch { /* drawing was stopped because the size changed or the file was closed */ }
    })();
    return () => { alive = false; task?.cancel(); };
  }, [doc, n, near, width]);

  const h = height ?? Math.round(width * ratio);
  return (
    <div ref={holder} className="wk-pdf-page" style={{ width, height: h }} aria-label={`Page ${n}`}>
      {near && <canvas ref={canvas} style={{ width, height: h }} />}
    </div>
  );
}
