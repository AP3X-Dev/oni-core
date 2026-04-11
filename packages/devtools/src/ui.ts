// ============================================================
// @oni.bot/devtools — HTML UI
// ============================================================
// Single-file HTML served at GET /
// ============================================================

export const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ONI Devtools</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "SF Mono", "Fira Code", monospace; background: #0d1117; color: #c9d1d9; }
  header { padding: 12px 20px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 16px; color: #58a6ff; }
  header .status { font-size: 12px; color: #3fb950; }
  .panels { display: grid; grid-template-columns: 280px 1fr 320px; height: calc(100vh - 45px); }
  .panel { border-right: 1px solid #30363d; overflow-y: auto; padding: 12px; }
  .panel:last-child { border-right: none; }
  .panel h2 { font-size: 13px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
  .node { padding: 6px 10px; margin: 3px 0; background: #21262d; border-radius: 4px; font-size: 13px; }
  .node.start { border-left: 3px solid #3fb950; }
  .node.end { border-left: 3px solid #f85149; }
  .node.regular { border-left: 3px solid #58a6ff; }
  .edge { padding: 4px 10px; margin: 2px 0; font-size: 12px; color: #8b949e; }
  .edge .arrow { color: #484f58; }
  .edge .condition { color: #d2a8ff; font-style: italic; }
  .event { padding: 6px 10px; margin: 3px 0; background: #21262d; border-radius: 4px; font-size: 12px; }
  .event .ts { color: #484f58; margin-right: 8px; }
  .event .node-name { color: #58a6ff; }
  .event .duration { color: #3fb950; margin-left: 8px; }
  .event.tool-reg { border-left: 3px solid #3fb950; }
  .event.tool-unreg { border-left: 3px solid #f85149; }
  .tool { padding: 6px 10px; margin: 3px 0; background: #21262d; border-radius: 4px; font-size: 13px; }
  .tool .name { color: #f0883e; font-weight: bold; }
  .tool .desc { color: #8b949e; font-size: 11px; margin-top: 2px; }
  #event-log { display: flex; flex-direction: column; }
</style>
</head>
<body>
<header>
  <h1>ONI Devtools</h1>
  <span class="status" id="conn-status">connecting...</span>
</header>
<div class="panels">
  <div class="panel" id="graph-panel">
    <h2>Graph Topology</h2>
    <div id="nodes"></div>
    <h2 style="margin-top: 16px;">Edges</h2>
    <div id="edges"></div>
  </div>
  <div class="panel">
    <h2>Live Events</h2>
    <div id="event-log"></div>
  </div>
  <div class="panel" id="registry-panel">
    <h2>Registry (<span id="tool-count">0</span> tools)</h2>
    <div id="tools"></div>
  </div>
</div>
<script>
(function() {
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
  }

  // Load graph topology
  fetch("/graph").then(r => r.json()).then(data => {
    const nodesEl = document.getElementById("nodes");
    data.nodes.forEach(n => {
      const cls = n.id === "__start__" ? "start" : n.id === "__end__" ? "end" : "regular";
      nodesEl.innerHTML += '<div class="node ' + cls + '">' + n.id + '</div>';
    });
    const edgesEl = document.getElementById("edges");
    data.edges.forEach(e => {
      const label = e.label ? ' <span class="condition">[' + e.label + ']</span>' : "";
      edgesEl.innerHTML += '<div class="edge">' + e.from + ' <span class="arrow">&rarr;</span> ' + e.to + label + '</div>';
    });
  });

  // Load registry
  function loadRegistry() {
    fetch("/registry").then(r => r.json()).then(data => {
      const toolsEl = document.getElementById("tools");
      toolsEl.innerHTML = "";
      document.getElementById("tool-count").textContent = data.tools.length;
      data.tools.forEach(t => {
        toolsEl.innerHTML += '<div class="tool"><div class="name">' + t.name + '</div>'
          + (t.description ? '<div class="desc">' + t.description + '</div>' : '')
          + '</div>';
      });
    });
  }
  loadRegistry();

  // SSE stream
  const log = document.getElementById("event-log");
  const es = new EventSource("/stream");

  es.onopen = () => { document.getElementById("conn-status").textContent = "connected"; };
  es.onerror = () => { document.getElementById("conn-status").textContent = "disconnected"; };

  es.addEventListener("node_start", e => {
    const d = JSON.parse(e.data);
    log.insertAdjacentHTML("afterbegin",
      '<div class="event"><span class="ts">' + formatTime(d.ts) + '</span>'
      + '<span class="node-name">' + d.node + '</span> started</div>');
  });

  es.addEventListener("node_end", e => {
    const d = JSON.parse(e.data);
    const dur = d.duration_ms != null ? '<span class="duration">' + d.duration_ms + 'ms</span>' : "";
    log.insertAdjacentHTML("afterbegin",
      '<div class="event"><span class="ts">' + formatTime(d.ts) + '</span>'
      + '<span class="node-name">' + d.node + '</span> ended' + dur + '</div>');
  });

  es.addEventListener("tool_registered", e => {
    const d = JSON.parse(e.data);
    log.insertAdjacentHTML("afterbegin",
      '<div class="event tool-reg"><span class="ts">' + formatTime(Date.now()) + '</span>'
      + '+ ' + d.name + '</div>');
    loadRegistry();
  });

  es.addEventListener("tool_unregistered", e => {
    const d = JSON.parse(e.data);
    log.insertAdjacentHTML("afterbegin",
      '<div class="event tool-unreg"><span class="ts">' + formatTime(Date.now()) + '</span>'
      + '- ' + d.name + '</div>');
    loadRegistry();
  });
})();
</script>
</body>
</html>`;
