/* Interactive review shell (client-side). Enhances the rendered memo artifact with per-section
 * Approve / Edit controls, a sticky review bar, and a live cover summary — all in-artifact, no
 * round-trip. On "Export sign-offs" it emits the attestation map (the bridge back to the agent →
 * deterministic re-render + DocMan). Reviewer identity is injected by the builder (window.RV_REVIEWER);
 * in the live flow that comes from getUserInfo. */
(function () {
  var R = window.RV_REVIEWER || { name: "Reviewer", role: "", date: "Jun 1, 2026", iso: "2026-06-01" };
  var state = {}; // modId -> { status, editNote }
  // Prior sign-offs replayed by the agent across re-renders (the assembler injects them as
  // RV_ATTESTATION_IN) so a chart swap / narrative edit never wipes the checklist. Map the exported
  // status vocabulary ("ai-drafted") back to the internal one ("pending").
  var IN = window.RV_ATTESTATION_IN || {};
  function inStatus(mod) {
    var s = IN[mod];
    if (!s) return "pending";
    if (s.status === "approved") return "approved";
    if (s.status === "edited") return "edited";
    return "pending";
  }

  function badgeInner(status) {
    if (status === "approved") return '<span class="att-dot"></span><span><strong>AI-drafted</strong> · Reviewed by ' + R.name + ', ' + R.role + ' · ' + R.date + '</span>';
    if (status === "edited") return '<span class="att-dot"></span><span><strong>AI-drafted</strong> · Edited &amp; reviewed by ' + R.name + ', ' + R.role + ' · ' + R.date + '</span>';
    return '<span class="att-dot"></span><span><strong>AI-drafted</strong> · Pending reviewer verification</span>';
  }
  function setBadge(att, status) {
    att.className = "attestation att-" + (status === "pending" ? "pending" : status === "edited" ? "edited" : "approved");
    att.innerHTML = badgeInner(status === "pending" ? "pending" : status);
  }
  var sections = [].slice.call(document.querySelectorAll("section.page[data-mod]"));
  sections.forEach(function (sec) {
    var mod = sec.getAttribute("data-mod");
    var att = sec.querySelector(".attestation");
    if (!att) return;
    var ctrl = document.createElement("div");
    ctrl.className = "rv-ctrl";
    var st = inStatus(mod);
    if (st === "pending") {
      state[mod] = { status: "pending" };
      pending(ctrl, sec, mod, att);
    } else {
      // rehydrate a prior sign-off carried in from the agent
      state[mod] = { status: st, editNote: (IN[mod] && IN[mod].editNote) || undefined };
      setBadge(att, st);
      approvedView(ctrl, mod, st === "edited" ? "Edited & reviewed" : "Reviewed");
    }
    att.parentNode.insertBefore(ctrl, att.nextSibling);
  });

  // ONLY narrative prose is editable in the artifact. Data (tables, KPI tiles, charts, figures) traces to
  // a system of record and is changed by the agent re-rendering from source — never hand-edited here. The
  // renderer marks narrative with [data-editable]; everything else stays locked. (SR 11-7: System/
  // Experience tiers own the figures; the Agent/narrative tier is the human-attested layer.)
  function editableEls(sec) {
    return [].slice.call(sec.querySelectorAll("[data-editable]"));
  }

  function pending(ctrl, sec, mod, att) {
    var canEdit = editableEls(sec).length > 0;
    ctrl.innerHTML = '<button class="rv-approve">✓ Review as drafted</button>' +
      (canEdit ? '<button class="rv-edit">✎ Edit narrative</button>' : '');
    ctrl.querySelector(".rv-approve").onclick = function () { apply(mod, "approved"); };
    var eb = ctrl.querySelector(".rv-edit");
    if (eb) eb.onclick = function () { startEdit(sec, mod, att, ctrl); };
  }
  function approvedView(ctrl, mod, label) {
    ctrl.innerHTML = '<span class="rv-done">✓ ' + label + '</span><button class="rv-undo">Undo</button>';
    ctrl.querySelector(".rv-undo").onclick = function () { reset(mod); };
  }
  function startEdit(sec, mod, att, ctrl) {
    sec.classList.add("rv-editing");
    editableEls(sec).forEach(function (el) { el.setAttribute("contenteditable", "true"); el.classList.add("rv-narr-edit"); });
    ctrl.innerHTML = '<button class="rv-save">✓ Save edit</button><button class="rv-cancel">Cancel</button>';
    ctrl.querySelector(".rv-save").onclick = function () { stopEdit(sec); apply(mod, "edited", "Revised in review"); };
    ctrl.querySelector(".rv-cancel").onclick = function () { stopEdit(sec); pending(ctrl, sec, mod, att); };
  }
  function stopEdit(sec) {
    sec.classList.remove("rv-editing");
    editableEls(sec).forEach(function (el) { el.removeAttribute("contenteditable"); el.classList.remove("rv-narr-edit"); });
  }
  function apply(mod, status, note) {
    state[mod] = { status: status, editNote: note };
    var sec = document.querySelector('section[data-mod="' + mod + '"]');
    setBadge(sec.querySelector(".attestation"), status);
    approvedView(sec.querySelector(".rv-ctrl"), mod, status === "edited" ? "Edited & reviewed" : "Reviewed");
    recompute();
  }
  function reset(mod) {
    state[mod] = { status: "pending" };
    var sec = document.querySelector('section[data-mod="' + mod + '"]');
    var att = sec.querySelector(".attestation");
    setBadge(att, "pending");
    pending(sec.querySelector(".rv-ctrl"), sec, mod, att);
    recompute();
  }

  function counts() {
    var total = 0, reviewed = 0, edited = 0;
    Object.keys(state).forEach(function (k) {
      total++;
      if (state[k].status === "approved" || state[k].status === "edited") reviewed++;
      if (state[k].status === "edited") edited++;
    });
    return { total: total, reviewed: reviewed, edited: edited };
  }
  // Build the export map (the agent's source of truth) and publish it to window so the host/agent can
  // read the CURRENT sign-offs at any moment — and replay them via --attestation on the next re-render.
  function publish() {
    var out = {};
    Object.keys(state).forEach(function (k) {
      var s = state[k];
      out[k] = s.status === "pending"
        ? { status: "ai-drafted" }
        : { status: s.status, approvedBy: R.name, approvedRole: R.role, approvedDate: R.iso, editNote: s.editNote };
    });
    window.RV_ATTESTATION = out;
    var pre = document.getElementById("rv-export"); if (pre) pre.textContent = JSON.stringify(out, null, 2);
    return out;
  }

  function recompute() {
    if (window.__memoProgressSync) { try { window.__memoProgressSync(); } catch (e) {} } // sync the floating section-progress pill
    publish(); // keep RV_ATTESTATION current after every approve/edit/reset/rehydrate
    var c = counts();
    var prog = document.querySelector(".rv-prog");
    if (prog) prog.textContent = c.reviewed + " of " + c.total + " reviewed" + (c.edited ? " (" + c.edited + " edited)" : "");
    var sum = document.querySelector(".cover .attest-summary");
    if (sum) {
      var line = sum.querySelector("div"), bar = sum.querySelector(".bar > span");
      if (line) line.innerHTML = "<strong>Section review:</strong> " + c.reviewed + " of " + c.total + " sections reviewed" + (c.edited ? " (" + c.edited + " edited)" : "") + " · " + (c.total - c.reviewed) + " pending";
      if (bar) bar.style.width = (c.total ? Math.round(c.reviewed / c.total * 100) : 0) + "%";
    }
  }

  function exportSignoffs() {
    var out = publish();
    console.log("[review-shell] attestation export:\n" + JSON.stringify(out, null, 2));
    var c = counts();
    toast("Sign-offs exported — " + c.reviewed + "/" + c.total + " reviewed. Hand back to the agent to freeze the PDF + save to DocMan.");
  }
  function approveAll() {
    Object.keys(state).forEach(function (k) { if (state[k].status === "pending") apply(k, "approved"); });
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "rv-toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 4200);
  }

  // sticky review bar
  var bar = document.createElement("div");
  bar.className = "rv-bar";
  bar.innerHTML = '<span class="rv-id">Reviewing as <b>' + R.name + '</b>' + (R.role ? ", " + R.role : "") + '</span>' +
    '<button class="rv-all">Review all remaining</button>' +
    '<button class="rv-primary rv-export">Export sign-offs</button>' +
    '<span class="rv-prog"></span>';
  document.body.insertBefore(bar, document.body.firstChild);
  bar.querySelector(".rv-all").onclick = approveAll;
  bar.querySelector(".rv-export").onclick = exportSignoffs;
  var pre = document.createElement("pre"); pre.id = "rv-export"; document.body.appendChild(pre);

  recompute();
})();
