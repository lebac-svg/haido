/**
 * `haido viz` — the human window (SPEC US6): one self-contained dark HTML page,
 * zero dependencies, works from file://. Force-directed map of files; node color =
 * top-level directory (validated categorical palette, fixed order, >8 folds into
 * "Khác"); memory presence = white ring + count; needs-review = status-warning ring
 * plus an icon+label in the panel (status is never color-alone).
 *
 * Anti-hairball rules (user feedback 2026-07-11, m_boot_011): edges are AMBIENT
 * (faint) by default; hovering/clicking a node spotlights ONLY its incident edges
 * (with arrowheads showing import direction) and neighbors while everything else
 * recedes; each directory gets a soft territory hull so clusters read as regions.
 */
export function buildVizHtml(dataJson: string, repoName: string): string {
  const safeJson = dataJson.replaceAll('<', '\\u003c');
  return TEMPLATE.replace('__REPO_NAME__', escapeHtml(repoName)).replace(
    '"__HAIDO_DATA__"',
    safeJson,
  );
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const TEMPLATE = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hải Đồ — __REPO_NAME__</title>
<style>
  :root {
    --page: #0d0d0d; --surface: #1a1a19;
    --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #898781;
    --hair: #2c2c2a; --border: rgba(255,255,255,0.10);
    --warn: #fab219;
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: var(--page); color: var(--ink-2);
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; overflow: hidden;
  }
  header {
    padding: 10px 14px; border-bottom: 1px solid var(--hair);
    display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; background: var(--surface);
  }
  header h1 { font-size: 14px; color: var(--ink); font-weight: 600; margin-right: 4px; }
  header .stats { color: var(--ink-3); }
  header label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
  header input[type="search"] {
    background: var(--page); border: 1px solid var(--hair); color: var(--ink);
    border-radius: 6px; padding: 4px 8px; width: 200px; outline: none;
  }
  header input[type="search"]:focus { border-color: var(--ink-3); }
  #legend { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
  #legend .chip { display: inline-flex; align-items: center; gap: 5px; color: var(--ink-2); }
  #legend .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  #legend .ring { width: 9px; height: 9px; border-radius: 50%; display: inline-block;
    border: 2px solid var(--ink); background: transparent; }
  #legend .ring.warn { border-color: var(--warn); }
  main { flex: 1; display: flex; min-height: 0; }
  #map { flex: 1; position: relative; background: var(--surface); }
  canvas { position: absolute; inset: 0; cursor: grab; }
  canvas.dragging { cursor: grabbing; }
  #tip {
    position: absolute; pointer-events: none; display: none; max-width: 340px;
    background: var(--page); border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 10px; color: var(--ink-2); box-shadow: 0 4px 18px rgba(0,0,0,.5);
  }
  #tip b { color: var(--ink); font-weight: 600; }
  #panel {
    width: 340px; border-left: 1px solid var(--hair); background: var(--surface);
    overflow-y: auto; padding: 14px; display: none;
  }
  #panel.open { display: block; }
  #panel h2 { font-size: 13px; color: var(--ink); word-break: break-all; }
  #panel .meta { color: var(--ink-3); margin: 4px 0 10px; }
  #panel .mem {
    border: 1px solid var(--hair); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
  }
  #panel .mem .t { color: var(--ink); font-weight: 600; }
  #panel .mem .why { color: var(--ink-3); margin-top: 4px; }
  #panel .mem .flag { color: var(--warn); font-weight: 600; }
  #panel .sec { color: var(--ink-3); text-transform: uppercase; font-size: 11px;
    letter-spacing: .04em; margin: 12px 0 6px; }
  #panel .edge { padding: 2px 0; word-break: break-all; cursor: pointer; }
  #panel .edge:hover { color: var(--ink); }
  #panel .close { float: right; cursor: pointer; color: var(--ink-3); border: none;
    background: none; font-size: 15px; }
  footer { padding: 6px 14px; border-top: 1px solid var(--hair); color: var(--ink-3);
    background: var(--surface); }
  kbd { color: var(--ink-2); }
</style>
</head>
<body>
<header>
  <h1>🧭 Hải Đồ — __REPO_NAME__</h1>
  <span class="stats" id="stats"></span>
  <label><input type="checkbox" id="showImports" checked> import</label>
  <label><input type="checkbox" id="showCochange" checked> hay đổi cùng nhau</label>
  <label><input type="checkbox" id="allEdges"> hiện rõ mọi liên kết</label>
  <label><input type="checkbox" id="onlyMem"> chỉ file có ghi chú</label>
  <input type="search" id="search" placeholder="lọc theo đường dẫn…">
  <span id="legend"></span>
</header>
<main>
  <div id="map"><canvas id="canvas"></canvas><div id="tip"></div></div>
  <aside id="panel"></aside>
</main>
<footer><b style="color:var(--ink-2)">trỏ vào một node để soi liên kết của riêng nó</b> (mũi tên = chiều import) · click để ghim + xem ghi chú · kéo node/nền · lăn chuột zoom — sinh bởi <kbd>haido viz</kbd></footer>
<script type="application/json" id="haido-data">"__HAIDO_DATA__"</script>
<script>
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('haido-data').textContent);
  var PALETTE = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];
  var OTHER = '#52514e';
  var TYPE_ICON = { invariant: '⛔', gotcha: '🪤', decision: '📌', convention: '📐', todo: '📝' };

  // ---- model ----
  function topDir(p) { var i = p.indexOf('/'); return i === -1 ? '(gốc)' : p.slice(0, i) + '/'; }
  var memByPath = {};
  var staleByPath = {};
  (DATA.memories || []).forEach(function (m) {
    var seen = {};
    (m.anchors || []).forEach(function (a) {
      if (seen[a.path]) return;
      seen[a.path] = true;
      (memByPath[a.path] = memByPath[a.path] || []).push(m);
      if (m.status === 'needs_review') staleByPath[a.path] = true;
    });
  });

  var dirCount = {};
  DATA.files.forEach(function (f) { var d = topDir(f.path); dirCount[d] = (dirCount[d] || 0) + 1; });
  var dirs = Object.keys(dirCount).sort(function (a, b) { return dirCount[b] - dirCount[a]; });
  var dirColor = {};
  dirs.forEach(function (d, i) { dirColor[d] = i < PALETTE.length ? PALETTE[i] : OTHER; });

  var nodes = DATA.files.map(function (f, i) {
    var dir = topDir(f.path);
    return {
      id: f.path, dir: dir, symbols: f.symbols || 0,
      mems: memByPath[f.path] || [], stale: !!staleByPath[f.path],
      color: dirColor[dir],
      r: Math.min(18, 4 + Math.sqrt(f.symbols || 0) * 1.6),
      x: 0, y: 0, vx: 0, vy: 0, idx: i, pinned: false,
      nbr: {}, deg: 0
    };
  });
  var byId = {};
  nodes.forEach(function (n) { byId[n.id] = n; });
  var edges = (DATA.edges || []).filter(function (e) { return byId[e.src] && byId[e.dst]; })
    .map(function (e) { return { a: byId[e.src], b: byId[e.dst], kind: e.kind, w: e.weight || 1 }; });
  edges.forEach(function (e) {
    e.a.nbr[e.b.idx] = true; e.b.nbr[e.a.idx] = true;
    e.a.deg++; e.b.deg++;
  });

  // seed positions: cluster by directory around a circle
  var W = 1200, H = 800;
  dirs.forEach(function (d, i) {
    var ang = (i / Math.max(1, dirs.length)) * Math.PI * 2;
    var cx = Math.cos(ang) * 300, cy = Math.sin(ang) * 230;
    var k = 0;
    nodes.forEach(function (n) {
      if (n.dir !== d) return;
      var a2 = (k * 2.399963); k++;
      var rr = 26 + Math.sqrt(k) * 16;
      n.x = cx + Math.cos(a2) * rr; n.y = cy + Math.sin(a2) * rr;
    });
  });
  var centroids = {};

  // ---- header ----
  var memTotal = (DATA.memories || []).length;
  var staleTotal = (DATA.memories || []).filter(function (m) { return m.status === 'needs_review'; }).length;
  var symTotal = nodes.reduce(function (s, n) { return s + n.symbols; }, 0);
  document.getElementById('stats').textContent =
    nodes.length + ' file · ' + symTotal + ' symbol · ' + memTotal + ' ghi chú' +
    (staleTotal ? ' (⚠ ' + staleTotal + ' cần review)' : '');
  var legend = document.getElementById('legend');
  dirs.slice(0, PALETTE.length).forEach(function (d) {
    var s = document.createElement('span');
    s.className = 'chip';
    s.innerHTML = '<span class="dot" style="background:' + dirColor[d] + '"></span>' + d;
    legend.appendChild(s);
  });
  if (dirs.length > PALETTE.length) {
    var o = document.createElement('span');
    o.className = 'chip';
    o.innerHTML = '<span class="dot" style="background:' + OTHER + '"></span>khác';
    legend.appendChild(o);
  }
  var l1 = document.createElement('span');
  l1.className = 'chip';
  l1.innerHTML = '<span class="ring"></span>có ghi chú';
  legend.appendChild(l1);
  var l2 = document.createElement('span');
  l2.className = 'chip';
  l2.innerHTML = '<span class="ring warn"></span>⚠ cần review';
  legend.appendChild(l2);

  // ---- canvas & camera ----
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var cam = { x: 0, y: 0, k: 1 };
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  function resize() {
    var el = document.getElementById('map');
    W = el.clientWidth; H = el.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  window.addEventListener('resize', function () { resize(); });
  resize();

  function toScreen(x, y) { return [W / 2 + (x - cam.x) * cam.k, H / 2 + (y - cam.y) * cam.k]; }
  function toWorld(px, py) { return [(px - W / 2) / cam.k + cam.x, (py - H / 2) / cam.k + cam.y]; }

  // ---- filters ----
  var showImports = true, showCochange = true, onlyMem = false, allEdges = false, query = '';
  function visible(n) {
    if (onlyMem && n.mems.length === 0) return false;
    return true;
  }
  function matches(n) { return query === '' || n.id.toLowerCase().indexOf(query) !== -1; }

  // ---- simulation ----
  var alpha = 1;
  function tick() {
    var i, j, n, m, e;
    for (i = 0; i < dirs.length; i++) centroids[dirs[i]] = { x: 0, y: 0, c: 0 };
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]; var c = centroids[n.dir]; c.x += n.x; c.y += n.y; c.c++;
    }
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        m = nodes[j];
        var dx = n.x - m.x, dy = n.y - m.y;
        var d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 120000) continue;
        var f = (n.dir === m.dir ? 1500 : 2600) / d2; // cross-cluster pushes harder
        var dl = Math.sqrt(d2);
        dx /= dl; dy /= dl;
        n.vx += dx * f; n.vy += dy * f;
        m.vx -= dx * f; m.vy -= dy * f;
      }
      var ct = centroids[n.dir];
      if (ct.c > 0) { n.vx += (ct.x / ct.c - n.x) * 0.035; n.vy += (ct.y / ct.c - n.y) * 0.035; }
      n.vx += -n.x * 0.0025; n.vy += -n.y * 0.0025;
    }
    for (i = 0; i < edges.length; i++) {
      e = edges[i];
      var rest = e.kind === 'imports' ? 100 : 75;
      var k = e.kind === 'imports' ? 0.018 : 0.028;
      var ex = e.b.x - e.a.x, ey = e.b.y - e.a.y;
      var el = Math.sqrt(ex * ex + ey * ey) + 0.01;
      var s = k * (el - rest) / el;
      e.a.vx += ex * s; e.a.vy += ey * s;
      e.b.vx -= ex * s; e.b.vy -= ey * s;
    }
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx * alpha; n.y += n.vy * alpha;
    }
    if (alpha > 0.02) alpha *= 0.995;
  }

  // ---- territory hulls (soft region per directory) ----
  function hullOf(points) {
    if (points.length < 3) return points.slice();
    points = points.slice().sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    var cross = function (o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };
    var lower = [], upper = [], i;
    for (i = 0; i < points.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) lower.pop();
      lower.push(points[i]);
    }
    for (i = points.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) upper.pop();
      upper.push(points[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function drawTerritories() {
    dirs.forEach(function (d) {
      var pts = [];
      var topPt = null;
      nodes.forEach(function (n) {
        if (n.dir !== d || !visible(n)) return;
        var p = toScreen(n.x, n.y);
        pts.push(p);
        if (!topPt || p[1] < topPt[1]) topPt = p;
      });
      if (pts.length === 0) return;
      var hull = hullOf(pts);
      var pad = 26 * Math.min(1.4, Math.max(0.6, cam.k));
      ctx.beginPath();
      if (hull.length === 1) {
        ctx.arc(hull[0][0], hull[0][1], pad, 0, 7);
      } else {
        ctx.moveTo(hull[0][0], hull[0][1]);
        for (var i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
        ctx.closePath();
      }
      ctx.fillStyle = hexA(dirColor[d], 0.05);
      ctx.strokeStyle = hexA(dirColor[d], 0.16);
      ctx.lineWidth = pad * 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke(); ctx.fill();
      if (topPt && cam.k > 0.45) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = hexA(dirColor[d], 0.75);
        ctx.fillText(d, topPt[0] - 8, topPt[1] - pad - 8);
      }
    });
  }
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  // ---- drawing ----
  var hover = null, selected = null;
  function focusNode() { return hover || selected; }

  function drawArrow(p1, p2, rTarget, color) {
    var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    dx /= len; dy /= len;
    var tipX = p2[0] - dx * (rTarget + 4), tipY = p2[1] - dy * (rTarget + 4);
    var s = 6;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - dx * s - dy * s * 0.6, tipY - dy * s + dx * s * 0.6);
    ctx.lineTo(tipX - dx * s + dy * s * 0.6, tipY - dy * s - dx * s * 0.6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawTerritories();

    var i, e, n;
    var f = focusNode();

    for (i = 0; i < edges.length; i++) {
      e = edges[i];
      if (e.kind === 'imports' && !showImports) continue;
      if (e.kind === 'co_change' && !showCochange) continue;
      if (!visible(e.a) || !visible(e.b)) continue;
      var incident = f && (e.a === f || e.b === f);
      if (f && !incident) continue; // spotlight mode: chỉ vẽ liên kết của node đang soi
      var queryDim = query !== '' && !(matches(e.a) && matches(e.b));
      var p1 = toScreen(e.a.x, e.a.y), p2 = toScreen(e.b.x, e.b.y);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
      if (incident) {
        if (e.kind === 'co_change') {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = '#e8e6da';
          ctx.lineWidth = 1.6 + Math.min(2, e.w * 2);
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = '#c3c2b7';
          ctx.lineWidth = 1.6;
        }
        ctx.stroke();
        if (e.kind === 'imports') {
          drawArrow(p1, p2, e.b.r * cam.k, '#c3c2b7'); // a imports b: mũi tên chỉ vào b
        }
      } else {
        var base = allEdges ? 0.5 : 0.14;
        if (e.kind === 'co_change') {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = 'rgba(195,194,183,' + (queryDim ? 0.04 : base) + ')';
          ctx.lineWidth = 1 + Math.min(2, e.w * 1.5);
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(137,135,129,' + (queryDim ? 0.03 : base) + ')';
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (!visible(n)) continue;
      var p = toScreen(n.x, n.y);
      var r = n.r * cam.k;
      var isFocus = f && n === f;
      var isNbr = f && f.nbr[n.idx];
      var recede = f ? !(isFocus || isNbr) : false;
      var queryDim2 = query !== '' && !matches(n);
      ctx.globalAlpha = queryDim2 ? 0.08 : recede ? 0.14 : 1;
      if (n.stale) {
        ctx.beginPath(); ctx.arc(p[0], p[1], r + 5, 0, 7); ctx.strokeStyle = '#fab219';
        ctx.lineWidth = 2.5; ctx.stroke();
      }
      if (n.mems.length > 0) {
        ctx.beginPath(); ctx.arc(p[0], p[1], r + 2, 0, 7); ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7);
      ctx.fillStyle = n.color; ctx.fill();
      if (isFocus || n === selected) {
        ctx.beginPath(); ctx.arc(p[0], p[1], r + 8, 0, 7);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      var showLabel =
        isFocus || isNbr || n === selected ||
        (!f && (cam.k > 1.35 || n === hover || (n.mems.length > 0 && cam.k > 0.9)));
      if (showLabel && !queryDim2 && !recede) {
        var name = n.id.split('/').pop();
        ctx.font = (isFocus ? '600 ' : '') + '11px system-ui, sans-serif';
        ctx.fillStyle = isFocus || isNbr ? '#ffffff' : '#898781';
        ctx.fillText(name, p[0] + r + 6, p[1] + 4);
      }
      ctx.globalAlpha = 1;
    }
  }

  function loop() { tick(); draw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  // ---- interaction ----
  var tipEl = document.getElementById('tip');
  function pick(px, py) {
    var w = toWorld(px, py);
    var best = null, bd = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!visible(n)) continue;
      var dx = n.x - w[0], dy = n.y - w[1];
      var d = Math.sqrt(dx * dx + dy * dy);
      var hit = Math.max(12 / cam.k, n.r + 6 / cam.k);
      if (d < hit && d < bd) { best = n; bd = d; }
    }
    return best;
  }
  var dragNode = null, panning = false, lastX = 0, lastY = 0, moved = false;
  canvas.addEventListener('mousedown', function (ev) {
    var r = canvas.getBoundingClientRect();
    var px = ev.clientX - r.left, py = ev.clientY - r.top;
    dragNode = pick(px, py);
    panning = !dragNode;
    lastX = px; lastY = py; moved = false;
    canvas.classList.add('dragging');
    if (dragNode) { dragNode.pinned = true; alpha = Math.max(alpha, 0.3); }
  });
  window.addEventListener('mousemove', function (ev) {
    var r = canvas.getBoundingClientRect();
    var px = ev.clientX - r.left, py = ev.clientY - r.top;
    if (dragNode) {
      var w = toWorld(px, py);
      dragNode.x = w[0]; dragNode.y = w[1]; moved = true;
    } else if (panning) {
      cam.x -= (px - lastX) / cam.k; cam.y -= (py - lastY) / cam.k;
      lastX = px; lastY = py; moved = true;
    } else {
      var h = pick(px, py);
      hover = h;
      if (h) {
        tipEl.style.display = 'block';
        tipEl.style.left = (px + 14) + 'px'; tipEl.style.top = (py + 14) + 'px';
        var extra = h.mems.length ? ' · ' + h.mems.length + ' ghi chú' : '';
        var warn2 = h.stale ? ' · <span style="color:#fab219">⚠ cần review</span>' : '';
        tipEl.innerHTML = '<b>' + h.id + '</b><br>' + h.symbols + ' symbol · ' + h.deg +
          ' liên kết' + extra + warn2;
      } else tipEl.style.display = 'none';
    }
  });
  window.addEventListener('mouseup', function () {
    canvas.classList.remove('dragging');
    if (dragNode && !moved) select(dragNode);
    if (!dragNode && panning && !moved) select(null);
    if (dragNode) dragNode.pinned = false;
    dragNode = null; panning = false;
  });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = canvas.getBoundingClientRect();
    var px = ev.clientX - r.left, py = ev.clientY - r.top;
    var w = toWorld(px, py);
    var k2 = Math.min(6, Math.max(0.25, cam.k * (ev.deltaY < 0 ? 1.15 : 0.87)));
    cam.x = w[0] - (px - W / 2) / k2;
    cam.y = w[1] - (py - H / 2) / k2;
    cam.k = k2;
  }, { passive: false });

  // ---- panel ----
  var panel = document.getElementById('panel');
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function select(n) {
    selected = n;
    if (!n) { panel.className = ''; panel.innerHTML = ''; return; }
    var html = '<button class="close" title="đóng">✕</button>';
    html += '<h2>' + esc(n.id) + '</h2>';
    html += '<div class="meta"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + n.color + '"></span> ' +
      esc(n.dir) + ' · ' + n.symbols + ' symbol · ' + n.deg + ' liên kết</div>';
    if (n.mems.length > 0) {
      html += '<div class="sec">Ghi chú neo ở đây</div>';
      n.mems.forEach(function (m) {
        var icon = TYPE_ICON[m.type] || '•';
        var flag = m.status === 'needs_review' ? ' <span class="flag">⚠ cần review (code đã đổi)</span>' : '';
        html += '<div class="mem"><div class="t">' + icon + ' ' + esc(m.title) + flag + '</div>' +
          '<div class="why">' + esc(m.id) + '</div></div>';
      });
    } else {
      html += '<div class="sec">Chưa có ghi chú nào ở file này</div>';
    }
    var rel = { 'import →': [], '← được import bởi': [], 'hay đổi cùng nhau': [] };
    edges.forEach(function (e) {
      if (e.kind === 'imports') {
        if (e.a === n) rel['import →'].push(e.b.id);
        else if (e.b === n) rel['← được import bởi'].push(e.a.id);
      } else if (e.a === n || e.b === n) {
        rel['hay đổi cùng nhau'].push(e.a === n ? e.b.id : e.a.id);
      }
    });
    Object.keys(rel).forEach(function (k) {
      if (rel[k].length === 0) return;
      html += '<div class="sec">' + k + '</div>';
      rel[k].forEach(function (p) {
        html += '<div class="edge" data-path="' + esc(p) + '">' + esc(p) + '</div>';
      });
    });
    panel.innerHTML = html;
    panel.className = 'open';
    panel.querySelector('.close').addEventListener('click', function () { select(null); });
    panel.querySelectorAll('.edge').forEach(function (el) {
      el.addEventListener('click', function () {
        var target = byId[el.getAttribute('data-path')];
        if (target) { select(target); cam.x = target.x; cam.y = target.y; }
      });
    });
  }

  // ---- controls ----
  document.getElementById('showImports').addEventListener('change', function (e) { showImports = e.target.checked; });
  document.getElementById('showCochange').addEventListener('change', function (e) { showCochange = e.target.checked; });
  document.getElementById('allEdges').addEventListener('change', function (e) { allEdges = e.target.checked; });
  document.getElementById('onlyMem').addEventListener('change', function (e) { onlyMem = e.target.checked; alpha = Math.max(alpha, 0.2); });
  document.getElementById('search').addEventListener('input', function (e) { query = e.target.value.trim().toLowerCase(); });
})();
</script>
</body>
</html>
`;
