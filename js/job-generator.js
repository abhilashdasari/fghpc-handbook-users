// ============================================================
// Slurm job script generator — docs/jobs/generator.md
//
// Lives in an external file (NOT inline) on purpose:
//   * works when the site is served over plain HTTP (no inline
//     handler + no reliance on the async clipboard API),
//   * survives browser policies that block inline <script> /
//     inline event handlers (CSP, ad blockers, proxies),
//   * survives Material's "instant navigation" content swaps.
//
// All wiring is delegated on `document` and registered exactly
// once, so it works no matter when the generator form appears.
// ============================================================
(function () {
  'use strict';

  var FORM_ID = 'genform';

  function byId(id) { return document.getElementById(id); }

  function val(id, fallback) {
    var e = byId(id);
    if (!e) return fallback;
    var s = String(e.value == null ? '' : e.value).trim();
    return s === '' ? fallback : s;
  }

  // Decimal hours -> valid Slurm --time string.
  //   1.5 -> "01:30:00"   30 -> "1-06:00:00"   24 -> "24:00:00"
  function timeFromHours(hrs) {
    var h = Number(hrs);
    if (!isFinite(h) || h <= 0) h = 24;
    var totalMin = Math.max(1, Math.round(h * 60));
    var d = Math.floor(totalMin / 1440);
    var rest = totalMin % 1440;
    var core = String(Math.floor(rest / 60)).padStart(2, '0') + ':' +
               String(rest % 60).padStart(2, '0') + ':00';
    return d > 0 ? d + '-' + core : core;
  }

  function cleanJobName(name) {
    var s = String(name).trim().replace(/\s+/g, '_');
    return s === '' ? 'myjob' : s;
  }

  // Rebuild the script from the current form state. Returns the script text.
  function buildScript() {
    if (!byId(FORM_ID)) return null;
    var modsSel = byId('g_mods');
    var mods = modsSel
      ? Array.prototype.map.call(modsSel.selectedOptions, function (o) { return o.value; })
          .filter(function (m) { return m !== ''; })
      : [];
    var gpu = parseInt(val('g_gpu', '0'), 10) || 0;
    var part = val('g_part', 'compute');

    var lines = [];
    lines.push('#!/bin/bash');
    lines.push('#SBATCH --job-name=' + cleanJobName(val('g_name', 'my_analysis')));
    lines.push('#SBATCH --partition=' + part);
    lines.push('#SBATCH --cpus-per-task=' + (parseInt(val('g_cpus', '8'), 10) || 8));
    lines.push('#SBATCH --mem=' + (parseFloat(val('g_mem', '32')) || 32) + 'G');
    lines.push('#SBATCH --time=' + timeFromHours(val('g_hrs', '24')));
    if (gpu > 0) lines.push('#SBATCH --gres=gpu:' + gpu);
    lines.push('#SBATCH --output=logs/%x_%j.out');
    lines.push('#SBATCH --error=logs/%x_%j.err');
    lines.push('');
    lines.push('set -euo pipefail');
    lines.push('mkdir -p logs');
    if (mods.length > 0) {
      lines.push('');
      lines.push('module load ' + mods.join(' '));
    }
    if (gpu > 0) {
      lines.push('');
      lines.push('# No CUDA/PyTorch modules on the cluster — use conda or singularity --nv for GPU stacks.');
    }
    lines.push('');
    lines.push('cd "$SLURM_SUBMIT_DIR" || exit 1');
    lines.push('');
    lines.push('# ---- your commands ----');
    var cmdEl = byId('g_cmd');
    var cmd = cmdEl ? String(cmdEl.value || '').trim() : '';
    if (cmd === '') cmd = '# add your commands here';
    lines.push(cmd);

    var script = lines.join('\n') + '\n';

    var out = document.querySelector('#g_out code');
    if (out) out.textContent = script;

    var warn = [];
    var mem = parseFloat(val('g_mem', '32'));
    if (mem > 950) warn.push('memory > 950G: only node1-3 have 1 TB; gpunode1 has ~273G.');
    if (gpu > 0 && part !== 'gpu') warn.push('GPUs requested on compute partition — switch partition (after checking with admin).');
    if (part === 'gpu') warn.push('gpu partition is currently INACTIVE — coordinate with the admin before submitting.');
    var note = byId('g_note');
    if (note) {
      note.textContent = warn.join(' ');
      note.className = 'hpc-gen-note' + (warn.length > 0 ? ' warn' : '');
    }
    return script;
  }

  function currentScript() {
    var out = document.querySelector('#g_out code');
    if (out && out.textContent && out.textContent.length > 0) return out.textContent;
    return buildScript() || '';
  }

  function copyState(ok, text) {
    var c = byId('g_copy');
    if (!c) return;
    c.textContent = text || (ok ? 'Copied ✓' : 'Copy failed — select the script in the box and press ⌘C / Ctrl+C.');
    c.className = 'hpc-gen-copy' + (ok ? ' ok' : ' fail');
    if (ok) {
      window.setTimeout(function () {
        if (c.textContent === (text || 'Copied ✓')) { c.textContent = ''; }
      }, 4000);
    }
  }

  // execCommand fallback — works over plain HTTP where navigator.clipboard
  // does not exist.
  function legacyCopy(text, done) {
    var ta = null;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e2) { /* older Safari */ }
      var ok = document.execCommand('copy');
      done(!!ok);
    } catch (e) {
      done(false);
    } finally {
      if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    }
  }

  function doCopy() {
    var text = currentScript();
    if (!text) { copyState(false, 'Nothing to copy yet.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { copyState(true); },
        function () { legacyCopy(text, copyState); }
      );
    } else {
      legacyCopy(text, copyState);
    }
  }

  function doDownload() {
    var text = currentScript();
    if (!text) { copyState(false, 'Nothing to download yet.'); return; }
    var name = cleanJobName(val('g_name', 'job')) + '.sh';
    var blob, url, a;
    try {
      blob = new Blob([text], { type: 'text/x-shellscript;charset=utf-8' });
      url = URL.createObjectURL(blob);
      a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      copyState(false, 'Download failed — use the Copy button instead.');
      return;
    }
    copyState(true, 'Downloaded ' + name + ' ✓');
  }

  // ------------------------------------------------------------ wiring
  function inGenerator(node) {
    return !!(node && node.closest && node.closest('#' + FORM_ID));
  }

  function onInputOrChange(e) {
    if (inGenerator(e.target)) buildScript();
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#g_copybtn')) { e.preventDefault(); doCopy(); }
    else if (t.closest('#g_dlbtn')) { e.preventDefault(); doDownload(); }
  }

  var wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    document.addEventListener('input', onInputOrChange, true);
    document.addEventListener('change', onInputOrChange, true);
    document.addEventListener('click', onClick, true);
    // Initial render for the current page (if it has the generator).
    if (byId(FORM_ID)) buildScript();
  }

  // Instant navigation injects the form AFTER load: watch for it and render.
  function watchForm() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        var nodes = m.addedNodes;
        if (!nodes) continue;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.nodeType === 1 &&
              (n.id === FORM_ID || (n.querySelector && n.querySelector('#' + FORM_ID)))) {
            buildScript();
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    wire();
    watchForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
