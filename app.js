/* Local Notes — notes live in localStorage (S3.store) only. */
(function () {
  "use strict";
  var $ = S3.$, h = S3.h;
  var KEY = "notes.all", CUR = "notes.cur";
  var notes = [], cur = null, query = "";
  var text = $("#text"), list = $("#list");

  // ---------- pure helpers (tested) ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function titleOf(t) {
    var line = String(t || "").split(/\r?\n/).map(function (l) { return l.replace(/^\s*#+\s*/, "").trim(); }).filter(Boolean)[0] || "";
    return line.length > 80 ? line.slice(0, 79) + "…" : line || "Untitled";
  }
  function snippet(t) {
    var lines = String(t || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    return lines.slice(1).join(" ").slice(0, 90);
  }
  function words(t) { var s = String(t || "").trim(); return s ? s.split(/\s+/).length : 0; }
  function sorted(arr) {
    return arr.slice().sort(function (a, b) { return (b.pinned - a.pinned) || (b.updated - a.updated); });
  }
  function matches(n, q) {
    q = q.trim().toLowerCase();
    return !q || q.split(/\s+/).every(function (w) { return n.text.toLowerCase().indexOf(w) >= 0; });
  }
  function fileNames(arr) {
    var used = {};
    return arr.map(function (n) {
      var base = titleOf(n.text).replace(/…$/, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).replace(/[. ]+$/, "") || "Untitled";
      var name = base, i = 2;
      while (used[name.toLowerCase()]) name = base + " (" + i++ + ")";
      used[name.toLowerCase()] = 1;
      return name + ".txt";
    });
  }
  // Imported/stored data is untrusted: keep only well-formed notes.
  function clean(n) {
    n = n && typeof n === "object" ? n : {};
    var now = Date.now();
    var num = function (v) { return typeof v === "number" && isFinite(v) && v > 0 && v < 4e12 ? v : now; };
    return {
      id: typeof n.id === "string" && /^[a-z0-9]{1,24}$/i.test(n.id) ? n.id : uid(),
      text: typeof n.text === "string" ? n.text.slice(0, 500000) : "",
      created: num(n.created), updated: num(n.updated), pinned: n.pinned === true
    };
  }
  function fromJSON(data) {
    var arr = Array.isArray(data) ? data : data && Array.isArray(data.notes) ? data.notes : null;
    return arr ? arr.slice(0, 5000).map(clean) : null;
  }

  // ---------- storage ----------
  function persist() {
    var ok = S3.store(KEY, notes) !== undefined;
    S3.store(CUR, cur && cur.id);
    $("#saved").textContent = ok ? "Saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not saved — storage full or blocked";
    $("#saved").classList.toggle("bad", !ok);
    if (!ok) S3.toast("Couldn't save — export your notes to keep them safe", "error");
  }
  var saveSoon = S3.debounce(persist, 300);
  // Another tab changed the notes: reload so we never overwrite its edits with stale data.
  window.addEventListener("storage", function (e) {
    if (e.key !== "s3:" + KEY) return;
    var fresh = (S3.store(KEY) || []).map(clean), id = cur && cur.id;
    notes = fresh;
    cur = notes.filter(function (n) { return n.id === id; })[0] || sorted(notes)[0] || null;
    if (!cur) newNote(true); else show(cur, true);
  });

  // ---------- view ----------
  function fmtWhen(t) {
    var d = new Date(t), now = new Date();
    return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }
  function drawList() {
    list.textContent = "";
    var shown = sorted(notes).filter(function (n) { return matches(n, query); });
    if (!shown.length) list.appendChild(h("li", { "class": "empty" }, [h("b", { text: query ? "No matches" : "No notes" }), query ? "Try other words." : "Press + to start."]));
    shown.forEach(function (n) {
      list.appendChild(h("li", null, [h("button", { "class": "note" + (n === cur ? " on" : ""), "data-id": n.id, "aria-current": n === cur ? "true" : false }, [
        h("span", { "class": "n-top" }, [h("b", { dir: "auto", text: titleOf(n.text) }), n.pinned ? h("span", { "class": "n-pin", title: "Pinned", text: "📌" }) : null]),
        h("span", { "class": "n-sub" }, [h("span", { "class": "n-date", text: fmtWhen(n.updated) }), h("span", { "class": "n-snip", dir: "auto", text: snippet(n.text) })])
      ])]));
    });
    $("#count").textContent = notes.length + (notes.length === 1 ? " note" : " notes");
  }
  function stats() {
    var t = text.value, w = words(t);
    $("#wc").textContent = w.toLocaleString() + (w === 1 ? " word" : " words") + " · " + t.length.toLocaleString() + " characters" + (w > 200 ? " · " + Math.ceil(w / 220) + " min read" : "");
    $("#pin").setAttribute("aria-pressed", String(!!(cur && cur.pinned)));
    $("#pin").textContent = cur && cur.pinned ? "📌 Unpin" : "📌 Pin";
  }
  function show(n, keepFocus) {
    cur = n; text.value = n.text; drawList(); stats();
    if (!keepFocus) text.focus();
    S3.store(CUR, n.id);
  }
  function newNote(silent) {
    var empty = notes.filter(function (n) { return !n.text.trim(); })[0];
    var n = empty || clean({ text: "" });
    if (!empty) notes.push(n);
    n.updated = Date.now();
    query = ""; $("#q").value = "";
    show(n, silent); persist();
  }

  // ---------- events ----------
  text.addEventListener("input", function () {
    if (!cur) return;
    cur.text = text.value; cur.updated = Date.now();
    $("#saved").textContent = "Saving…";
    drawList(); stats(); saveSoon();
  });
  list.addEventListener("click", function (e) {
    var b = e.target.closest(".note"); if (!b) return;
    var n = notes.filter(function (x) { return x.id === b.dataset.id; })[0]; if (n) show(n);
  });
  $("#q").addEventListener("input", function (e) { query = e.target.value; drawList(); });
  $("#q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var first = $(".note", list); if (first) first.click(); }
    if (e.key === "Escape") { query = e.target.value = ""; drawList(); text.focus(); }
  });
  $("#new").addEventListener("click", function () { newNote(); });
  function togglePin() { if (!cur) return; cur.pinned = !cur.pinned; drawList(); stats(); persist(); }
  $("#pin").addEventListener("click", togglePin);
  $("#del").addEventListener("click", function () {
    if (!cur) return;
    var gone = cur, at = notes.indexOf(gone);
    notes.splice(at, 1);
    var next = sorted(notes)[0];
    if (next) show(next, true); else newNote(true);
    persist();
    if (!gone.text.trim()) return;
    var t = S3.toast("Deleted “" + titleOf(gone.text) + "” ");
    t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () { notes.push(gone); show(gone); persist(); t.remove(); } }));
  });
  $("#copy").addEventListener("click", function () { if (cur && cur.text) { S3.copy(cur.text, "Note copied"); S3.done(); } });
  $("#txt").addEventListener("click", function () {
    if (!cur || !cur.text) return;
    S3.download(cur.text, fileNames([cur])[0], "text/plain;charset=utf-8"); S3.done();
  });
  function live() { return notes.filter(function (n) { return n.text.trim(); }); }
  $("#zip").addEventListener("click", function () {
    var arr = sorted(live()); if (!arr.length) { S3.toast("No notes to export", "error"); return; }
    var names = fileNames(arr);
    S3.download(S3.zip(arr.map(function (n, i) { return { name: names[i], data: n.text }; })), "notes.zip"); S3.done();
  });
  $("#json").addEventListener("click", function () {
    S3.download(JSON.stringify({ app: "s3-local-notes", version: 1, exported: new Date().toISOString(), notes: live() }, null, 2), "notes-backup.json", "application/json"); S3.done();
  });
  $("#imp input").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (f.size > 50 * 1024 * 1024) { S3.toast("That file is too large", "error"); return; }
    S3.readFile(f, "text").then(function (t) {
      var data; try { data = JSON.parse(t); } catch (err) { S3.toast("Not valid JSON", "error"); return; }
      var arr = fromJSON(data);
      if (!arr) { S3.toast("That doesn't look like a notes backup", "error"); return; }
      var added = 0;
      arr.forEach(function (n) {
        if (!n.text.trim()) return;
        var same = notes.filter(function (x) { return x.id === n.id; })[0];
        if (same && same.text === n.text) return;
        if (same) n.id = uid();
        notes.push(n); added++;
      });
      drawList(); persist(); S3.toast("Imported " + added + " note" + (added === 1 ? "" : "s")); S3.done();
    });
  });
  document.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); $("#q").focus(); $("#q").select(); }
    else if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); persist(); S3.toast("Saved ✓"); }
    else if (e.altKey && k === "n") { e.preventDefault(); newNote(); }
    else if (e.altKey && k === "p") { e.preventDefault(); togglePin(); }
    else if (e.altKey && (k === "arrowup" || k === "arrowdown")) {
      e.preventDefault();
      var shown = sorted(notes).filter(function (n) { return matches(n, query); }), i = shown.indexOf(cur) + (k === "arrowup" ? -1 : 1);
      if (shown[i]) show(shown[i]);
    }
  });

  // ---------- boot ----------
  notes = (Array.isArray(S3.store(KEY)) ? S3.store(KEY) : []).map(clean);
  var savedId = S3.store(CUR);
  var start = notes.filter(function (n) { return n.id === savedId; })[0] || sorted(notes)[0];
  if (start) show(start, true); else newNote(true);
  $("#saved").textContent = "Saved";

  window.S3_DEMO = function () {
    var now = Date.now();
    notes = [
      clean({ text: "Weekend plan\n- Farmers market at 9\n- Call grandma\n- Finish reading “The Overstory”", updated: now - 36e5, pinned: true }),
      clean({ text: "Ideas for the blog\nWhy small tools beat big apps. Privacy by default. Shipping every week.", updated: now - 864e5 }),
      clean({ text: "Grocery list\nOlive oil, za'atar, lemons, labneh, bread, tomatoes", updated: now - 3 * 864e5 }),
      clean({ text: "Meeting notes — Q4 roadmap\nAttendees: Lina, Sam, Omar\nDecision: ship offline mode first.\nNext: draft spec by Thursday.", updated: now - 6e5 }),
      clean({ text: "أفكار للرحلة\nزيارة البتراء، وادي رم، والبحر الميت", updated: now - 9 * 864e5 })
    ];
    show(notes[3], true); persist();
  };

  window.S3_SELFTEST = function () {
    var okT = titleOf("\n\n  # Hello world  \nbody") === "Hello world" && titleOf("   ") === "Untitled" && titleOf("x".repeat(100)).length === 80;
    var okW = words("  one two\nthree  ") === 3 && words("") === 0 && words("مرحبا بالعالم") === 2;
    var a = clean({ text: "a", updated: 1, pinned: false }), b = clean({ text: "b", updated: 3 }), c = clean({ text: "c", updated: 2, pinned: true });
    var okS = sorted([a, b, c]).map(function (n) { return n.text; }).join("") === "cba";
    var okM = matches({ text: "Buy Milk and eggs" }, "milk EGGS") && !matches({ text: "Buy milk" }, "milk bread") && matches({ text: "x" }, "  ");
    var names = fileNames([{ text: "Plan: A/B?" }, { text: "plan  a b" }, { text: "" }, { text: "" }]);
    var okF = names.join("|") === "Plan A B.txt|plan a b (2).txt|Untitled.txt|Untitled (2).txt";
    var src = [clean({ text: "héllo\nworld ✓", pinned: true, created: 5, updated: 9 })];
    var okR = JSON.stringify(fromJSON(JSON.parse(JSON.stringify({ notes: src })))) === JSON.stringify(src);
    var bad = fromJSON({ notes: [{ text: { evil: 1 }, id: "<img>", pinned: "yes", updated: -4 }, 42] });
    var okB = bad.length === 2 && bad[0].text === "" && /^[a-z0-9]+$/.test(bad[0].id) && bad[0].pinned === false && bad[0].updated > 1e12 && fromJSON({ x: 1 }) === null;
    return okT && okW && okS && okM && okF && okR && okB;
  };
})();
