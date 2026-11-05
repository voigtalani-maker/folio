// Folio documents: PDF import, exports (PDF, image, text, Word, PowerPoint), sharing, note locks.
(function () {
  'use strict';
  var Store = Folio.Store, Ink = Folio.Ink;
  var PW = Ink.PW;
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('The PDF reader needs an internet connection to load.')); };
      document.head.appendChild(s);
    });
  }

  function canvasBlob(c, type, quality) {
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('Could not create the image.')); }, type, quality);
    });
  }

  // Every PDF page becomes a Folio page: the PDF sits on the paper, and you write over it.
  // Returns {pages, text}. Wide slides leave the space below them free for notes.
  function pdfToPages(file, noteId, progress) {
    return loadPdfJs().then(function (lib) {
      return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; });
    }).then(function (pdf) {
      var pages = [], text = [];
      function next(n) {
        if (n > pdf.numPages) return Promise.resolve({ pages: pages, text: text.join(' ') });
        if (progress) progress(n, pdf.numPages);
        return pdf.getPage(n).then(function (p) {
          var base = p.getViewport({ scale: 1 });
          var vp = p.getViewport({ scale: Math.min(3, 1600 / base.width) });
          var c = document.createElement('canvas');
          c.width = Math.round(vp.width);
          c.height = Math.round(vp.height);
          return p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
            return p.getTextContent();
          }).then(function (tc) {
            text.push(tc.items.map(function (i) { return i.str; }).join(' '));
            return canvasBlob(c, 'image/webp', 0.82);
          }).then(function (blob) {
            var id = Ink.uid();
            return Store.put('assets', { id: id, blob: blob }).then(function () {
              var h = c.height / c.width * PW;
              var pageH = Math.max(Ink.PH, Math.ceil(h));
              pages.push({
                id: Ink.uid(), noteId: noteId, paper: 'blank', h: pageH, items: [],
                bg: { asset: id, x: 0, y: 0, w: PW, h: h }
              });
              p.cleanup();
              return next(n + 1);
            });
          });
        });
      }
      return next(1);
    });
  }

  function importPdf(file, folderId, progress) {
    var now = Date.now();
    var note = {
      id: Ink.uid(), title: file.name.replace(/\.pdf$/i, ''), folderId: folderId || null, paper: 'blank',
      favourite: false, created: now, updated: now, pageIds: []
    };
    return pdfToPages(file, note.id, progress).then(function (r) {
      note.pageIds = r.pages.map(function (p) { return p.id; });
      note.pdfText = r.text.slice(0, 500000);
      note.searchText = note.pdfText;
      return Store.putMany('pages', r.pages).then(function () { return Store.put('notes', note); });
    }).then(function () { return note; });
  }

  // ---------- Rendering pages for export ----------

  function loadAssets(pages) {
    var ids = {}, out = {};
    pages.forEach(function (p) {
      if (p.bg) ids[p.bg.asset] = true;
      p.items.forEach(function (it) { if (it.type === 'image') ids[it.asset] = true; });
    });
    return Promise.all(Object.keys(ids).map(function (id) {
      return Store.get('assets', id).then(function (a) {
        if (!a) return null;
        return createImageBitmap(a.blob).then(function (bmp) { out[id] = bmp; });
      });
    })).then(function () { return out; });
  }

  function renderPage(page, assets, width) {
    var height = page.h || Ink.PH, c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * height / PW);
    var ctx = c.getContext('2d'), s = width / PW;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    Ink.drawPage(ctx, page, assets);
    return c;
  }

  // A small picture of a page, which is what Claude reads when asked to look at handwriting.
  function pagePreview(page) {
    return loadAssets([page]).then(function (assets) {
      return renderPage(page, assets, 800).toDataURL('image/webp', 0.62);
    });
  }

  function pageJpegs(pages, width) {
    return loadAssets(pages).then(function (assets) {
      return Promise.all(pages.map(function (page) {
        var c = renderPage(page, assets, width);
        return canvasBlob(c, 'image/jpeg', 0.9).then(function (b) { return b.arrayBuffer(); }).then(function (buf) {
          return { bytes: new Uint8Array(buf), w: c.width, h: c.height };
        });
      }));
    });
  }

  var enc = new TextEncoder();
  function concat(parts) {
    var len = parts.reduce(function (s, p) { return s + p.length; }, 0), out = new Uint8Array(len), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  function buildPdf(images) {
    var parts = [], offset = 0, xref = [];
    function push(x) {
      var b = typeof x === 'string' ? enc.encode(x) : x;
      parts.push(b);
      offset += b.length;
    }
    function obj(n, body, stream) {
      xref[n] = offset;
      push(n + ' 0 obj\n' + body + '\n');
      if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
      push('endobj\n');
    }
    push('%PDF-1.4\n');
    var kids = images.map(function (_, i) { return (3 + i * 3) + ' 0 R'; }).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + images.length + ' >>');
    images.forEach(function (im, i) {
      var pn = 3 + i * 3, cn = pn + 1, xn = pn + 2, pw = 595, ph = +(595 * im.h / im.w).toFixed(2);
      obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Contents ' + cn + ' 0 R ' +
        '/Resources << /XObject << /I ' + xn + ' 0 R >> >> >>');
      var draw = enc.encode('q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /I Do Q');
      obj(cn, '<< /Length ' + draw.length + ' >>', draw);
      obj(xn, '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>', im.bytes);
    });
    var size = 3 + images.length * 3, start = offset, table = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (var n = 1; n < size; n++) table += ('0000000000' + xref[n]).slice(-10) + ' 00000 n \n';
    push(table + 'trailer\n<< /Size ' + size + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n');
    return new Blob([concat(parts)], { type: 'application/pdf' });
  }

  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // A plain, uncompressed ZIP, which is all Word and PowerPoint files need to be.
  function buildZip(files, type) {
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, v >> 8 & 255]; }
    function u32(v) { return [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var head = new Uint8Array([0x50, 0x4B, 3, 4].concat(common));
      parts.push(head, name, data);
      central.push(new Uint8Array([0x50, 0x4B, 1, 2].concat(u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += head.length + name.length + data.length;
    });
    var dir = concat(central);
    var end = new Uint8Array([0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(dir.length), u32(offset), u16(0)));
    return new Blob([concat(parts), dir, end], { type: type });
  }

  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var PKG_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var DOC_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

  function buildDocx(images) {
    var cx = 5760000, body = '', rels = '', files = [];
    images.forEach(function (im, i) {
      var n = i + 1, cy = Math.min(8400000, Math.round(cx * im.h / im.w)), w = Math.round(cy * im.w / im.h);
      rels += '<Relationship Id="rId' + n + '" Type="' + DOC_RELS + '/image" Target="media/p' + n + '.jpg"/>';
      files.push({ name: 'word/media/p' + n + '.jpg', data: im.bytes });
      body += '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + w + '" cy="' + cy + '"/>' +
        '<wp:docPr id="' + n + '" name="Page ' + n + '"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + n + '" name="Page ' + n + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId' + n + '"/>' +
        '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + w + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    });
    return buildZip([
      { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: XML + '<Relationships xmlns="' + PKG_RELS + '"><Relationship Id="rId1" Type="' + DOC_RELS + '/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', data: XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' + DOC_RELS + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="' + A + '" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>' },
      { name: 'word/_rels/document.xml.rels', data: XML + '<Relationships xmlns="' + PKG_RELS + '">' + rels + '</Relationships>' }
    ].concat(files), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  var THEME = XML + '<a:theme xmlns:a="' + A + '" name="Folio"><a:themeElements><a:clrScheme name="Folio"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="4A3023"/></a:dk2><a:lt2><a:srgbClr val="E6F1F8"/></a:lt2><a:accent1><a:srgbClr val="6B4630"/></a:accent1><a:accent2><a:srgbClr val="5B8FB0"/></a:accent2><a:accent3><a:srgbClr val="7F9A76"/></a:accent3><a:accent4><a:srgbClr val="C9A24B"/></a:accent4><a:accent5><a:srgbClr val="C46F4A"/></a:accent5><a:accent6><a:srgbClr val="8A6A94"/></a:accent6><a:hlink><a:srgbClr val="5B8FB0"/></a:hlink><a:folHlink><a:srgbClr val="8A6A94"/></a:folHlink></a:clrScheme><a:fontScheme name="Folio"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Folio"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
  var EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  var NS = 'xmlns:a="' + A + '" xmlns:r="' + DOC_RELS + '" xmlns:p="' + P + '"';

  function buildPptx(images) {
    var W = 7560000, H = 10692000, files = [], overrides = '', ids = '', rels = '';
    images.forEach(function (im, i) {
      var n = i + 1, h = Math.min(H, Math.round(W * im.h / im.w)), w = Math.round(h * im.w / im.h), x = Math.round((W - w) / 2);
      overrides += '<Override PartName="/ppt/slides/slide' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
      ids += '<p:sldId id="' + (255 + n) + '" r:id="rId' + (n + 10) + '"/>';
      rels += '<Relationship Id="rId' + (n + 10) + '" Type="' + DOC_RELS + '/slide" Target="slides/slide' + n + '.xml"/>';
      files.push({ name: 'ppt/media/p' + n + '.jpg', data: im.bytes });
      files.push({ name: 'ppt/slides/slide' + n + '.xml', data: XML + '<p:sld ' + NS + '><p:cSld><p:spTree>' + EMPTY_TREE + '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ' + n + '"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + x + '" y="0"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>' });
      files.push({ name: 'ppt/slides/_rels/slide' + n + '.xml.rels', data: XML + '<Relationships xmlns="' + PKG_RELS + '"><Relationship Id="rId1" Type="' + DOC_RELS + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + DOC_RELS + '/image" Target="../media/p' + n + '.jpg"/></Relationships>' });
    });
    return buildZip([
      { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + overrides + '</Types>' },
      { name: '_rels/.rels', data: XML + '<Relationships xmlns="' + PKG_RELS + '"><Relationship Id="rId1" Type="' + DOC_RELS + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>' },
      { name: 'ppt/presentation.xml', data: XML + '<p:presentation ' + NS + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + ids + '</p:sldIdLst><p:sldSz cx="' + W + '" cy="' + H + '"/><p:notesSz cx="' + H + '" cy="' + W + '"/></p:presentation>' },
      { name: 'ppt/_rels/presentation.xml.rels', data: XML + '<Relationships xmlns="' + PKG_RELS + '"><Relationship Id="rId1" Type="' + DOC_RELS + '/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="' + DOC_RELS + '/theme" Target="theme/theme1.xml"/>' + rels + '</Relationships>' },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: XML + '<p:sldMaster ' + NS + '><p:cSld><p:spTree>' + EMPTY_TREE + '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>' },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: XML + '<Relationships xmlns="' + PKG_RELS + '"><Relationship Id="rId1" Type="' + DOC_RELS + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + DOC_RELS + '/theme" Target="../theme/theme1.xml"/></Relationships>' },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: XML + '<p:sldLayout ' + NS + ' type="blank"><p:cSld name="Blank"><p:spTree>' + EMPTY_TREE + '</p:spTree></p:cSld></p:sldLayout>' },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: XML + '<Relationships xmlns="' + PKG_RELS + '"><Relationship Id="rId1" Type="' + DOC_RELS + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>' },
      { name: 'ppt/theme/theme1.xml', data: THEME }
    ].concat(files), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }

  function typedText(note, pages) {
    var out = [note.title || 'Untitled note', ''];
    pages.forEach(function (p, i) {
      var words = p.items.filter(function (it) { return it.type === 'text' && it.text; })
        .sort(function (a, b) { return a.y - b.y; }).map(function (it) { return it.text; });
      if (words.length) out.push('Page ' + (i + 1), words.join('\n'), '');
    });
    return new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
  }

  // format: pdf | png | txt | docx | pptx. Resolves to {blob, name}.
  function exportNote(note, pages, format, pageIndex) {
    var safe = (note.title || 'Untitled note').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Note';
    if (format === 'txt') return Promise.resolve({ blob: typedText(note, pages), name: safe + '.txt' });
    if (format === 'png') {
      return loadAssets([pages[pageIndex]]).then(function (assets) {
        return canvasBlob(renderPage(pages[pageIndex], assets, 2000), 'image/png');
      }).then(function (blob) { return { blob: blob, name: safe + ' - page ' + (pageIndex + 1) + '.png' }; });
    }
    return pageJpegs(pages, 1600).then(function (images) {
      if (format === 'docx') return { blob: buildDocx(images), name: safe + '.docx' };
      if (format === 'pptx') return { blob: buildPptx(images), name: safe + '.pptx' };
      return { blob: buildPdf(images), name: safe + '.pdf' };
    });
  }

  // ---------- Opening any file ----------
  // PDFs, images and audio open as they are. Word, PowerPoint, Excel and text files open as
  // editable text, with the original kept on the first page. Anything else is kept as an attachment.

  var CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
  function loadScript(src, global) {
    if (window[global]) return Promise.resolve(window[global]);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(window[global]); };
      s.onerror = function () { reject(new Error('Opening this file type needs an internet connection the first time.')); };
      document.head.appendChild(s);
    });
  }
  function loadZip() { return loadScript(CDN + 'jszip/3.10.1/jszip.min.js', 'JSZip'); }

  function escapeHtml(text) {
    var d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function newNoteShell(title, folderId) {
    var now = Date.now();
    return {
      id: Ink.uid(), title: title, folderId: folderId || null, paper: 'blank',
      favourite: false, created: now, updated: now, pageIds: []
    };
  }

  function extensionOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function saveNote(note, pages, text) {
    note.pageIds = pages.map(function (p) { return p.id; });
    note.searchText = String(text || '').slice(0, 500000);
    return Store.putMany('pages', pages).then(function () { return Store.put('notes', note); }).then(function () { return note; });
  }

  // Flows blocks of formatted text down the pages, starting a new page when one is full.
  function flowPages(noteId, blocks, firstY) {
    var ctx = document.createElement('canvas').getContext('2d'), pages = [], current = '', top = firstY || 70;
    function item(html) {
      var d = document.createElement('div');
      d.innerHTML = html;
      return { id: Ink.uid(), type: 'text', text: d.innerText || d.textContent || '', html: html, x: 70, y: top, w: 860, size: 24, color: '#111111' };
    }
    function finish() {
      if (!current) return;
      var it = item(current), page = { id: Ink.uid(), noteId: noteId, paper: 'blank', items: [it] };
      var bottom = it.y + Ink.bbox(it, ctx).h + 60;
      if (bottom > Ink.PH) { page.layout = 'long'; page.h = Math.ceil(bottom); }
      pages.push(page);
      current = '';
      top = 70;
    }
    blocks.forEach(function (block) {
      var clean = Ink.cleanHtml(block);
      if (!clean) return;
      var attempt = current + clean, probe = item(attempt);
      if (current && probe.y + Ink.bbox(probe, ctx).h > Ink.PH - 80) finish();
      current += clean;
    });
    finish();
    return pages;
  }

  function textBlocks(text) {
    return String(text).replace(/\r\n/g, '\n').split('\n').map(function (line) {
      return line.trim() ? '<div>' + escapeHtml(line) + '</div>' : '<div><br></div>';
    });
  }

  function attachOriginal(file) {
    var id = Ink.uid();
    return Store.put('assets', { id: id, blob: file }).then(function () {
      return { id: Ink.uid(), type: 'attach', kind: 'file', asset: id, name: file.name || 'File', x: 70, y: 30, w: 620, h: 70 };
    });
  }

  function emptyPage(noteId) {
    return { id: Ink.uid(), noteId: noteId, paper: 'blank', items: [] };
  }

  function textDocument(file, folderId, blocks, plain) {
    var note = newNoteShell(file.name.replace(/\.[^.]+$/, ''), folderId);
    return attachOriginal(file).then(function (attach) {
      var pages = flowPages(note.id, blocks, 130);
      if (!pages.length) pages = [emptyPage(note.id)];
      pages[0].items.unshift(attach);
      return saveNote(note, pages, plain);
    });
  }

  function openWord(file, folderId) {
    return loadScript(CDN + 'mammoth/1.6.0/mammoth.browser.min.js', 'mammoth').then(function (mammoth) {
      return file.arrayBuffer().then(function (buf) {
        return mammoth.convertToHtml({ arrayBuffer: buf }, { convertImage: mammoth.images.imgElement(function () { return Promise.resolve({ src: '' }); }) });
      });
    }).then(function (result) {
      var doc = new DOMParser().parseFromString(result.value, 'text/html'), blocks = [];
      Array.prototype.forEach.call(doc.body.children, function (el) {
        var heading = /^H[1-6]$/.test(el.tagName);
        blocks.push(heading ? '<div><b><font size="' + (el.tagName === 'H1' ? 6 : 5) + '">' + el.innerHTML + '</font></b></div>' : el.outerHTML);
      });
      return textDocument(file, folderId, blocks, doc.body.textContent);
    });
  }

  function xmlDoc(text) { return new DOMParser().parseFromString(text, 'application/xml'); }
  function numbered(name) { return parseInt(/(\d+)\.xml$/.exec(name)[1], 10); }

  function openPowerPoint(file, folderId) {
    return loadZip().then(function (Zip) { return Zip.loadAsync(file); }).then(function (zip) {
      var names = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
        .sort(function (a, b) { return numbered(a) - numbered(b); });
      return Promise.all(names.map(function (n) { return zip.file(n).async('string'); }));
    }).then(function (slides) {
      var plain = [], blocks = [];
      slides.forEach(function (xml, i) {
        blocks.push('<div><b><font size="5">Slide ' + (i + 1) + '</font></b></div>');
        Array.prototype.forEach.call(xmlDoc(xml).getElementsByTagNameNS('*', 'p'), function (para) {
          var text = Array.prototype.map.call(para.getElementsByTagNameNS('*', 't'), function (t) { return t.textContent; }).join('');
          if (text.trim()) { blocks.push('<div>' + escapeHtml(text) + '</div>'); plain.push(text); }
        });
        blocks.push('<div><br></div>');
      });
      return textDocument(file, folderId, blocks, plain.join(' '));
    });
  }

  function columnIndex(ref) {
    var letters = /^[A-Z]+/.exec(ref || 'A')[0], n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64;
    return n - 1;
  }

  function openExcel(file, folderId) {
    var zip;
    return loadZip().then(function (Zip) { return Zip.loadAsync(file); }).then(function (z) {
      zip = z;
      var shared = zip.file('xl/sharedStrings.xml');
      return shared ? shared.async('string') : '';
    }).then(function (sharedXml) {
      var strings = sharedXml ? Array.prototype.map.call(xmlDoc(sharedXml).getElementsByTagNameNS('*', 'si'), function (si) {
        return Array.prototype.map.call(si.getElementsByTagNameNS('*', 't'), function (t) { return t.textContent; }).join('');
      }) : [];
      var names = Object.keys(zip.files).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
        .sort(function (a, b) { return numbered(a) - numbered(b); });
      return Promise.all(names.map(function (n) { return zip.file(n).async('string'); })).then(function (sheets) {
        var blocks = [], plain = [];
        sheets.forEach(function (xml, s) {
          blocks.push('<div><b><font size="5">Sheet ' + (s + 1) + '</font></b></div>');
          var rows = Array.prototype.slice.call(xmlDoc(xml).getElementsByTagNameNS('*', 'row'), 0, 500), html = '';
          rows.forEach(function (row, r) {
            var cells = [];
            Array.prototype.forEach.call(row.getElementsByTagNameNS('*', 'c'), function (c) {
              var v = c.getElementsByTagNameNS('*', 'v')[0], t = c.getAttribute('t'), text = '';
              if (t === 's' && v) text = strings[+v.textContent] || '';
              else if (t === 'inlineStr') text = c.textContent;
              else if (v) text = v.textContent;
              cells[columnIndex(c.getAttribute('r'))] = text;
              if (text) plain.push(text);
            });
            var tds = '';
            for (var i = 0; i < Math.min(cells.length, 12); i++) tds += '<td>' + escapeHtml(cells[i] || '') + '</td>';
            html += '<tr>' + (tds || '<td></td>') + '</tr>';
            if ((r + 1) % 25 === 0 || r === rows.length - 1) {
              blocks.push('<table><tbody>' + html + '</tbody></table>');
              html = '';
            }
          });
        });
        return textDocument(file, folderId, blocks, plain.join(' '));
      });
    });
  }

  function openImage(file, folderId) {
    var note = newNoteShell((file.name || 'Image').replace(/\.[^.]+$/, ''), folderId), id = Ink.uid();
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return canvasBlob(c, 'image/webp', 0.86).then(function (blob) {
        return Store.put('assets', { id: id, blob: blob });
      }).then(function () {
        var w = 900, h = w * c.height / c.width, page = emptyPage(note.id);
        if (h > 1300) { w = w * 1300 / h; h = 1300; }
        page.items.push({ id: Ink.uid(), type: 'image', asset: id, x: (PW - w) / 2, y: 50, w: w, h: h });
        return saveNote(note, [page], '');
      });
    });
  }

  function openAudio(file, folderId) {
    var note = newNoteShell((file.name || 'Audio').replace(/\.[^.]+$/, ''), folderId), id = Ink.uid();
    return Store.put('assets', { id: id, blob: file }).then(function () {
      note.recordings = [{ id: Ink.uid(), asset: id, name: file.name || 'Audio', duration: 0, created: Date.now() }];
      return saveNote(note, [emptyPage(note.id)], '');
    });
  }

  function openOther(file, folderId) {
    var note = newNoteShell((file.name || 'File').replace(/\.[^.]+$/, ''), folderId);
    return attachOriginal(file).then(function (attach) {
      var page = emptyPage(note.id);
      page.items.push(attach);
      return saveNote(note, [page], file.name);
    });
  }

  var TEXT_EXT = { txt: 1, md: 1, markdown: 1, csv: 1, tsv: 1, log: 1, json: 1, xml: 1, rtf: 0 };

  // Resolves to the new note. The result says whether the contents could be shown.
  function openFile(file, folderId) {
    var ext = extensionOf(file.name), type = file.type || '';
    function attempt() {
      if (ext === 'pdf' || type === 'application/pdf') return importPdf(file, folderId);
      if (type.indexOf('image/') === 0 && ext !== 'svg') return openImage(file, folderId);
      if (type.indexOf('audio/') === 0) return openAudio(file, folderId);
      if (ext === 'docx') return openWord(file, folderId);
      if (ext === 'pptx') return openPowerPoint(file, folderId);
      if (ext === 'xlsx') return openExcel(file, folderId);
      if (ext === 'html' || ext === 'htm') {
        return file.text().then(function (t) {
          var page = new DOMParser().parseFromString(t, 'text/html');
          Array.prototype.forEach.call(page.querySelectorAll('script,style,noscript'), function (x) { x.remove(); });
          var text = page.body.textContent;
          return textDocument(file, folderId, textBlocks(text), text);
        });
      }
      if (TEXT_EXT[ext] || type.indexOf('text/') === 0) {
        return file.text().then(function (t) { return textDocument(file, folderId, textBlocks(t), t); });
      }
      return openOther(file, folderId).then(function (note) { note.keptAsFile = true; return note; });
    }
    return attempt().catch(function (err) {
      // A file that can't be read is still kept, so it is never lost.
      return openOther(file, folderId).then(function (note) { note.keptAsFile = true; note.openError = err.message; return note; });
    });
  }

  // Files sent through Android's Share menu wait in this cache for the app to collect them.
  function takeSharedFiles() {
    if (!window.caches) return Promise.resolve([]);
    return caches.open('folio-incoming').then(function (cache) {
      return cache.keys().then(function (keys) {
        return Promise.all(keys.map(function (req) {
          return cache.match(req).then(function (res) {
            return res.blob().then(function (blob) {
              var name = decodeURIComponent(res.headers.get('x-file-name') || 'Shared file');
              return cache.delete(req).then(function () { return new File([blob], name, { type: blob.type }); });
            });
          });
        }));
      });
    });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  // Opens the tablet's share sheet where it can, and otherwise saves the file.
  function deliver(file, share) {
    var f = new File([file.blob], file.name, { type: file.blob.type });
    if (share && navigator.canShare && navigator.canShare({ files: [f] })) {
      return navigator.share({ files: [f], title: file.name }).then(function () { return 'shared'; }, function (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
        download(file.blob, file.name);
        return 'saved';
      });
    }
    download(file.blob, file.name);
    return Promise.resolve('saved');
  }

  // ---------- Note locks ----------
  // This hides a note behind a password in the app. The contents are not encrypted on the device.

  function toHex(buf) {
    return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function derive(password, saltHex) {
    var salt = new Uint8Array(saltHex.match(/../g).map(function (h) { return parseInt(h, 16); }));
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' }, key, 256);
    }).then(toHex);
  }
  function makeLock(password) {
    var salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    return derive(password, salt).then(function (hash) { return { salt: salt, hash: hash }; });
  }
  function checkLock(lock, password) {
    return derive(password, lock.salt).then(function (hash) { return hash === lock.hash; });
  }

  window.Folio = window.Folio || {};
  window.Folio.Docs = {
    importPdf: importPdf, pdfToPages: pdfToPages, pagePreview: pagePreview, openFile: openFile, takeSharedFiles: takeSharedFiles, exportNote: exportNote, deliver: deliver, download: download,
    makeLock: makeLock, checkLock: checkLock
  };
})();
